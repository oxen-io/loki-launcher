// no npm!
const fs        = require('fs')
const os        = require('os')
const net       = require('net')
const ini       = require('./ini')
const lib       = require('./lib')
const { spawn } = require('child_process')
//const stdin     = process.openStdin()

const VERSION = 0.6

var logo = lib.getLogo('L A U N C H E R   v e r s i o n   v version')
console.log('loki SN launcher version', VERSION, 'registered')
const lokinet   = require('./lokinet') // needed for checkConfig

// preprocess command line arguments
var args = process.argv
function stripArg(match) {
  var found = false
  for(var i in args) {
    var arg = args[i]
    if (arg.match(match)) {
      args.splice(i, 1)
      found = true
    }
  }
  return found
}
stripArg('node')
stripArg('index')
//console.log('Launcher arguments:', args)

function parseXmrOptions() {
  var configSet = {}
  function setConfig(key, value) {
    if (configSet[key] !== undefined) {
      if (configSet[key].constructor.name == 'String') {
        if (configSet[key] != value) {
          configSet[key] = [ configSet[key], value ]
        //} else {
          // if just setting the same thing again then nothing to do
        }
      } else
      if (configSet[key].constructor.name == 'Array') {
        // FIXME: most array options should be unique...
        configSet[key].push(value)
      } else {
        console.warn('parseXmrOptions::setConfig - Unknown type', configSet[key].constructor.name)
      }
    } else {
      configSet[key] = value
    }
  }
  for(var i in args) {
    var arg = args[i]
    //console.log('arg', arg)
    if (arg.match(/^--/)) {
      var removeDashes = arg.replace(/^--/, '')
      if (arg.match(/=/)) {
        // key/value pairs
        var parts = removeDashes.split(/=/)
        var key   = parts.shift()
        var value = parts.join('=')
        setConfig(key, value)
      } else {
        // --stagenet
        setConfig(removeDashes, true)
      }
    }
  }
  return configSet
}

var xmrOptions = parseXmrOptions()
//console.log('xmrOptions', xmrOptions)

// load config from disk
const ini_bytes = fs.readFileSync('launcher.ini')
var disk_config = ini.iniToJSON(ini_bytes.toString())
running_config   = {}
requested_config = disk_config

config = requested_config

var dataDirReady = false

// defaults
if (config.network.testnet === undefined) {
  config.network.testnet = config.blockchain.network == "test"
}

// normalize inputs (allow for more options but clamping it down internally)
if (config.blockchain.network.toLowerCase() == "test" || config.blockchain.network.toLowerCase() == "testnet" || config.blockchain.network.toLowerCase() == "test-net") {
  config.blockchain.network = 'test'
} else
if (config.blockchain.network.toLowerCase() == "consensusnet" || config.blockchain.network.toLowerCase() == "consensus" || config.blockchain.network.toLowerCase() == "demo") {
  config.blockchain.network = 'demo'
} else
if (config.blockchain.network.toLowerCase() == "staging" || config.blockchain.network.toLowerCase() == "stage") {
  config.blockchain.network = 'staging'
}
if (config.launcher === undefined) {
  // set launcher defaults
  config.launcher = {
    interface: false,
  }
}

// autoconfig
/*
--zmq-rpc-bind-port arg (=22024, 38158 if 'testnet', 38155 if 'stagenet')
--rpc-bind-port arg (=22023, 38157 if 'testnet', 38154 if 'stagenet')
--p2p-bind-port arg (=22022, 38156 if 'testnet', 38153 if 'stagenet')
--p2p-bind-port-ipv6 arg (=22022, 38156 if 'testnet', 38153 if 'stagenet')
*/
// FIXME: map?
if (config.blockchain.zmq_port == '0') {
  // only really need this one set for lokinet
  config.blockchain.zmq_port = undefined
  /*
  if (config.blockchain.network == 'test') {
    config.blockchain.zmq_port = 38158
  } else
  if (config.blockchain.network == "staging") {
    config.blockchain.zmq_port = 38155
  } else {
    config.blockchain.zmq_port = 22024
  }
  */
}
if (config.blockchain.rpc_port == '0') {
  if (config.blockchain.network == 'test') {
    config.blockchain.rpc_port = 38157
  } else
  if (config.blockchain.network == 'demo') {
    config.blockchain.rpc_port = 38160
  } else
  if (config.blockchain.network == 'staging') {
    config.blockchain.rpc_port = 38154
  } else {
    // main
    config.blockchain.rpc_port = 22023
  }
}
if (config.blockchain.p2p_port == '0') {
  // only really need this one set for lokinet
  config.blockchain.p2p_port = undefined
  /*
  if (config.blockchain.network == 'test') {
    config.blockchain.p2p_port = 38156
  } else
  if (config.blockchain.network == 'staging') {
    config.blockchain.p2p_port = 38153
  } else {
    config.blockchain.p2p_port = 22022
  }
  */
}

//
// Disk Config needs to be locked by this point
//

// make sure data_dir has no trailing slash
var blockchain_useDefaultDataDir = false

function setupInitialBlockchainOptions() {
  // Merge in command line options
  if (xmrOptions['data-dir']) {
    if (blockchain_useDefaultDataDir) {
      // was default to load config and now it's set
      blockchain_useDefaultDataDir = false
    }
    var dir = xmrOptions['data-dir']
    config.blockchain.data_dir = dir
    // does this directory exist?
    if (!fs.existsSync(dir)) {
      console.warn('Configured data-dir ['+dir+'] does not exist, lokid will create it')
    }
  }
  // need these to set default directory
  if (xmrOptions['stagenet']) {
    config.blockchain.network = 'staging'
  } else
  if (xmrOptions['testnet']) {
    config.blockchain.network = 'test'
  }
}

setupInitialBlockchainOptions()

// FIXME: convert getLokiDataDir to internal config value
// something like estimated/calculated loki_data_dir
// also this will change behavior if we actually set the CLI option to lokid
if (!config.blockchain.data_dir) {
  console.log('using default data_dir, network', config.blockchain.network)
  config.blockchain.data_dir = '~/.loki'
  blockchain_useDefaultDataDir = true
}
config.blockchain.data_dir = config.blockchain.data_dir.replace(/\/$/, '')
dataDirReady = true

// should only be called after this point
function getLokiDataDir() {
  if (!dataDirReady) {
    console.log('getLokiDataDir is not ready for use!')
    process.exit()
  }
  // has no trailing slash
  var dir = config.blockchain.data_dir
  // enforce: no trailing slash
  if (dir[dir.length - 1] == '/') {
    dir = dir.slice(0, -1)
  }
  if (blockchain_useDefaultDataDir) {
    if (config.blockchain.network == 'staging') {
      dir += '/stagenet'
    } else
    if (config.blockchain.network == 'demo') {
      dir += '/testnet'
    } else
    if (config.blockchain.network == 'test') {
      dir += '/testnet'
    }
  }
  return dir
}

// data dir has to be set but should be before everything else
if (xmrOptions['config-file']) {
  // read file in lokidata dir
  var filePath = getLokiDataDir() + '/' + xmrOptions['config-file']
  if (!fs.existsSync(filePath)) {
    console.warn('Can\'t read config-file command line argument, file does not exist: ', filePath)
  } else {
    const moneroDiskConfig = fs.readFileSync(filePath)
    const moneroDiskOptions = ini.iniToJSON(moneroDiskConfig.toString())
    console.log('parsed loki config', moneroDiskOptions.unknown)
    for(var k in moneroDiskOptions.unknown) {
      var v = moneroDiskOptions.unknown[k]
      xmrOptions[k] = v
    }
    // reprocess data-dir and network setings
    setupInitialBlockchainOptions()
  }
}
// handle merging remaining launcher options
if (xmrOptions['rpc-login']) {
  if (xmrOptions['rpc-login'].match(/:/)) {
    var parts = xmrOptions['rpc-login'].split(/:/)
    var user = parts.shift()
    var pass = parts.join(':')
    config.blockchain.rpc_user = user
    config.blockchain.rpc_pass = pass
  } else {
    console.warn('Can\'t read rpc-login command line argument', xmrOptions['rpc-login'])
  }
}
// rpc_ip
if (xmrOptions['rpc-bind-ip']) {
  // any way to validate this string?
  config.blockchain.rpc_ip = xmrOptions['rpc-bind-ip']
}
function setPort(cliKey, configKey, subsystem) {
  if (subsystem === undefined) subsystem = 'blockchain'
  if (xmrOptions[cliKey]) {
    var test = parseInt(xmrOptions[cliKey])
    if (test) {
      config[subsystem][configKey] = xmrOptions[cliKey]
    } else {
      console.warn('Can\'t read', cliKey, 'command line argument', xmrOptions[cliKey])
    }
  }
}
setPort('zmq-rpc-bind-port', 'zmq_port')
setPort('rpc-bind-port', 'rpc_port')
setPort('p2p-bind-port', 'p2p_port')

if (config.storage.lokid_key === undefined) {
  config.storage.lokid_key = getLokiDataDir() + '/key'
}

lokinet.checkConfig(config.network) // can auto-configure network.binary_path

// lokid config and most other configs should be locked into stone by this point
// (except for lokinet, since we need to copy lokid over to it)

console.log('Launcher running config:', config)
/*
var col1 = []
var col2 = []
for(var k in config.blockchain) {
  col1.push(k)
  col2.push(config.blockchain[k])
}
var col3 = []
var col4 = []
for(var k in config.network) {
  col3.push(k)
  col4.push(config.network[k])
}
var maxRows = Math.max(col1.length, col3.length)
for(var i = 0; i < maxRows; ++i) {
  var c1 = '', c2 = '', c3 = '', c4 = ''
  if (col1[i] !== undefined) c1 = col1[i]
  if (col2[i] !== undefined) c2 = col2[i]
  if (col3[i] !== undefined) c3 = col3[i]
  if (col4[i] !== undefined) c4 = col4[i]
  var c2chars = 21
  if (c4.length > c2chars) {
    var diff = c4.length - 29 + 4 // not sure why we need + 4 here...
    var remaining = c2chars - c2.length
    //console.log('diff', diff, 'remaining', remaining)
    if (remaining > 0) {
      if (remaining >= diff) {
        c2chars -= diff
        //console.log('padding 2 to', c2chars)
      }
    }
  }
  console.log(c1.padStart(11, ' '), c2.padStart(c2chars, ' '), c3.padStart(11, ' '), c4.padStart(27, ' '))
}
console.log('storage config', config.storage)
*/

// upload final lokid to lokinet
config.network.lokid = config.blockchain

//
// Config is now set in stone
//

console.log(logo.replace(/version/, VERSION.toString().split('').join(' ')))


//
// run all sanity checks
//

if (!fs.existsSync(config.blockchain.binary_path)) {
  console.error('lokid is not at configured location', config.blockchain.binary_path)
  process.exit()
}
if (!fs.existsSync(config.storage.binary_path)) {
  console.error('storageServer is not at configured location', config.storage.binary_path)
  process.exit()
}
if (!fs.existsSync(config.network.binary_path)) {
  console.error('lokinet is not at configured location', config.network.binary_path)
  process.exit()
}

if (config.network.bootstrap_path && !fs.existsSync(config.network.bootstrap_path)) {
  console.error('lokinet bootstrap not found at location', config.network.binary_path)
  process.exit()
}

// isn't create until lokid runs
/*
if (!fs.existsSync(config.storage.lokid_key)) {
  console.error('lokid key not found at location', config.storage.lokid_key)
  process.exit()
}
*/

// make sure the binary_path that exists are not a directory
if (fs.lstatSync(config.blockchain.binary_path).isDirectory()) {
  console.error('lokid configured location is a directory', config.blockchain.binary_path)
  process.exit()
}
if (fs.lstatSync(config.storage.binary_path).isDirectory()) {
  console.error('storageServer configured location is a directory', config.storage.binary_path)
  process.exit()
}
if (fs.lstatSync(config.network.binary_path).isDirectory()) {
  console.error('lokinet configured location is a directory', config.network.binary_path)
  process.exit()
}

if (config.network.bootstrap_path && fs.lstatSync(config.network.bootstrap_path).isDirectory()) {
  console.error('lokinet bootstrap configured location is a directory', config.network.binary_path)
  process.exit()
}

if (fs.existsSync(config.storage.lokid_key) && fs.lstatSync(config.storage.lokid_key).isDirectory()) {
  console.error('lokid key location is a directory', config.storage.lokid_key)
  process.exit()
}

//console.log('userInfo', os.userInfo('utf8'))
//console.log('started as', process.getuid(), process.geteuid())
if (os.platform() == 'darwin') {
  if (process.getuid() != 0) {
    console.error('MacOS requires you start this with sudo')
    process.exit()
  }
} else {
  if (process.getuid() == 0) {
    console.error('Its not recommended you run this as root')
  }
}

//
// get processes state
//

// are we already running
var alreadyRunning = false
var pid = 0
if (fs.existsSync('launcher.pid')) {
  // we are already running
  pid = fs.readFileSync('launcher.pid', 'utf8')
  if (pid && lib.isPidRunning(pid)) {
    alreadyRunning = true
    console.log('loki launcher already active under', pid)
    process.exit()
  } else {
    console.log('stale launcher.pid, overwriting')
    pid = 0
  }
}

var pids = {}
function getProcessState() {
  pids = lib.getPids()

  // what happens if we get different options than what we had before
  // maybe prompt to confirm restart
  // if already running just connect for now

  var running = {}
  if (pids.lokid && lib.isPidRunning(pids.lokid)) {
    console.log("old lokid is still running", pids.lokid)
    running.lokid = pids.lokid
  }
  if (pids.lokinet && lib.isPidRunning(pids.lokinet)) {
    console.log("old lokinet is still running", pids.lokinet)
    running.lokinet = pids.lokinet
  }
  if (pids.storageServer && lib.isPidRunning(pids.storageServer)) {
    console.log("old storage server is still running", pids.storageServer)
    running.storageServer = pids.storageServer
  }
  return running
}
var running = getProcessState()

function isNothingRunning(running) {
  return !(running.lokid || running.lokinet || running.storageServer)
}

// progress to 2nd phase where we might need to start something
const daemon = require('./daemon')

function startEverything(config, args) {
  // to debug
  // sudo __daemon=1 node index.js
  //daemon(args, __filename, lokinet, config, getLokiDataDir)
  daemon.startLauncherDaemon(config.launcher.interactive, __filename, args, function() {
    daemon.startLokinet(config, args, function(started) {
      //console.log('StorageServer now running', started)
      if (!started) {
        daemon.shutdown_everything()
      }
    })
    daemon.startLokid(config, args)
  })
}

//
// normalize state
//

// kill what needs to be killed

// storage needs it's lokinet, kill any strays
if (!running.lokinet && running.storageServer) {
  console.log('we have storage server with no lokinet, killing it', pids.storageServer)
  process.kill(pids.storageServer, 'SIGINT')
  running.storageServer = 0
}

function killStorageServer(running, pids) {
  if (running.storageServer) {
    console.log('killing storage on', pids.storageServer)
    process.kill(pids.storageServer, 'SIGINT')
    running.storageServer = 0
  }
}

function killLokinetAndStorageServer(running, pids) {
  killStorageServer(running, pids)
  // FIXME: only need to restart if the key changed
  if (running.lokinet) {
    console.log('killing lokinet on', pids.lokinet)
    process.kill(pids.lokinet, 'SIGINT')
    running.lokinet = 0
  }
}

if (!running.lokid) {
  // no lokid, kill remaining
  console.log('lokid is down, kill idlers')
  killLokinetAndStorageServer(running, pids)
}

if (isNothingRunning(running)) {
  console.log("Starting fresh copy of Loki Suite")
  startEverything(config, args)
  return
}

//
// go into recovery mode
//

// ignore any configuration of current
config = pids.config
args = pids.args

// adopt responsibility of watching the existing suite
function launcherRecoveryMonitor() {
  if (!lib.isPidRunning(pids.lokid)) {
    console.log('lokid just died', pids.lokid)
    // no launcher, so we may need to do someclean up
    // lokid needs no clean up
    // kill storageServer and lokinet?
    // FIXME: only need to if key changes...
    //
    // if existed previous / if we started them
    // we can't make a pids into the started style
    // so we'll have to just update from disk
    running = getProcessState()   // update locations of lokinet/storageServer
    killLokinetAndStorageServer(running, pids) // kill them
    // and restart it all?
    if (config.blockchain.restart) {
      startEverything(config, args)
    }
  } else
  if (!lib.isPidRunning(pids.lokinet)) {
    // kill storage server
    killStorageServer(running, pids)
    // well assuming old lokid is still running
    daemon.startLokinet(config, shutdownIfNotStarted)
  } else
  if (!lib.isPidRunning(pids.storageServer)) {
    daemon.startStorageServer(config, args, shutdownIfNotStarted)
  }
  setTimeout(launcherRecoveryMonitor, 15 * 1000)
}

function shutdownIfNotStarted(started) {
  if (!started) {
    daemon.shutdown_everything()
  }
}

// figure out how to recover state with a running lokid
if (!running.lokinet) {
  // start lokinet
  // therefore starting storageServer
  daemon.startLokinet(config, shutdownIfNotStarted)
} else
if (!running.storageServer) {
  // start storageServer
  daemon.startStorageServer(config, args, shutdownIfNotStarted)
}

// we need start watching everything all over again
launcherRecoveryMonitor()

// well now register ourselves as the proper guardian of the suite
fs.writeFileSync('launcher.pid', process.pid)

// handle handlers...
daemon.setupHandlers()

// so we won't have a console for the socket to connect to
// should we run an empty server and let them know?
// well we can only send a message and we can do that on the client side
