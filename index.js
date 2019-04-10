// no npm!
const fs        = require('fs')
const os        = require('os')
const net       = require('net')
const ini       = require('./ini')
const { spawn } = require('child_process')
const stdin     = process.openStdin()

const VERSION = 0.5
function hereDoc(f) {
  return f.toString().
      replace(/^[^\/]+\/\*!?/, '').
      replace(/\*\/[^\/]+$/, '')
}

var logo = hereDoc(function() {/*!
        .o0l.
       ;kNMNo.
     ;kNMMXd'
   ;kNMMXd'                 .ld:             ,ldxkkkdl,.     'dd;     ,odl.  ;dd
 ;kNMMXo.  'ol.             ,KMx.          :ONXkollokXN0c.   cNMo   .dNNx'   dMW
dNMMM0,   ;KMMXo.           ,KMx.        .oNNx'      .dNWx.  :NMo .cKWk;     dMW
'dXMMNk;  .;ONMMXo'         ,KMx.        :NMx.         oWWl  cNWd;ON0:.      oMW
  'dXMMNk;.  ;kNMMXd'       ,KMx.        lWWl          :NMd  cNMNNMWd.       dMW
    'dXMMNk;.  ;kNMMXd'     ,KMx.        :NMx.         oWWl  cNMKolKWO,      dMW
      .oXMMK;   ,0MMMNd.    ,KMx.        .dNNx'      .dNWx.  cNMo  .dNNd.    dMW
        .lo'  'dXMMNk;.     ,KMXxdddddl.   :ONNkollokXN0c.   cNMo    ;OWKl.  dMW
            'dXMMNk;        .lddddddddo.     ,ldxkkkdl,.     'od,     .cdo;  ;dd
          'dXMMNk;
         .oNMNk;             L A U N C H E R   v e r s i o n   v version
          .l0l.
*/});
console.log('loki SN launcher version', VERSION, 'registered')
const lokinet   = require('./lokinet')

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
var startOnly = stripArg('--start-only')
var connectOnly = stripArg('--connect-only')
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
if (config.blockchain.network.toLowerCase() == "staging" || config.blockchain.network.toLowerCase() == "stage") {
  config.blockchain.network = 'staging'
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
  if (blockchain_useDefaultDataDir) {
    if (config.blockchain.network == 'staging') {
      dir += '/stagenet'
    } else
    if (config.blockchain.network == 'test') {
      dir += '/testnet'
    }
  }
  // should have no trailing slash
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
// run all sanity checks before we may need to detach
//
if (!fs.existsSync(config.blockchain.binary_path)) {
  console.error('lokid is not at configured location', config.blockchain.binary_path)
  process.exit()
}
if (!fs.existsSync(config.storage.binary_path)) {
  console.error('storageServer is not at configured location', config.storage.binary_path)
  process.exit()
}
lokinet.checkConfig(config.network)
if (!fs.existsSync(config.network.binary_path)) {
  console.error('lokinet is not at configured location', config.network.binary_path)
  process.exit()
}

if (config.network.bootstrap_path && !fs.existsSync(config.network.bootstrap_path)) {
  console.error('lokinet bootstrap not found at location', config.network.binary_path)
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
// are we already running
//
var alreadyRunning = false
if (fs.existsSync('launcher.pid')) {
  // we are already running
  var pid = fs.readFileSync('launcher.pid', 'utf8')
  try {
    process.kill(pid, 0)
    alreadyRunning = true
  } catch(e) {
    console.log('stale launcher.pid, overwriting')
    pid = 0
  }
}

// what happens if we get different options than what we had before
// maybe prompt to confirm restart
// if already running just connect for now

if (!connectOnly) {
  if (!alreadyRunning) {
    const daemon = require('./daemon')
    // to debug
    // sudo __daemon=1 node index.js
    daemon(args, __filename, lokinet, config, getLokiDataDir)
    return
  }
} else {
  if (!alreadyRunning) {
    console.log("lokid isn't running, we were only supposed to connect")
    stdin.pause()
    return
  }
}

if (startOnly) {
  console.log('We were only supposed to start it')
  stdin.pause()
  return
}

if (pid) {
  console.log('already running at', pid)
} else {
  // we just started it up...
  // FIXME: probably should wait for socket to be created
}
console.log('trying to connect to test.socket')
const client = net.createConnection({ path: 'test.socket' }, () => {
  // 'connect' listener
  console.log('connected to server!')
  //client.write('world!\r\n')
})
//client.setEncoding('utf-8')
client.on('error', (err) => {
  console.error('error', err)
})
var lastcommand = ''
client.on('data', (data) => {
  //console.log('FROM SOCKETraw:', data.slice(data.length - 4, data.length))
  //console.log('lastcommand', lastcommand)
  var stripped = data.toString().replace(lastcommand, '').trim()
  //var buf = Buffer.from(stripped, 'utf8')
  //console.log(buf)
  /*
  if (stripped.match(/\r\n/)) console.log('has windows newline')
  else {
    if (stripped.match(/\n/)) console.log('has newline')
    if (stripped.match(/\r/)) console.log('has return')
  }
  */
  // remove terminal codes
  stripped = stripped.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').trim()
  if (!stripped) return // don't echo empty lines...

  // why does this work?
  /*
  if (stripped[stripped.length - 1] == 'm') {
    console.log('FROm SOCKET:', stripped.substr(0, stripped.length - 1))
  } else {
    //console.log('FROM SOCKET:', stripped, 'last', stripped[stripped.length - 1])
    */
  console.log('FROM SOCKET:', stripped)
  //}
  //client.end()
})
client.on('end', () => {
  console.log('disconnected from server')
  process.exit()
})


// hijack stdin
stdin.resume()
// i don't want binary, do you?
stdin.setEncoding( 'utf8' )

// on any data into stdin
var state = '', session = {}
stdin.on('data', function(str) {
  // confirm on exit?
  lastcommand = str
  if (lastcommand.trim() == "exit") {
    console.log("SHUTTING DOWN SERVICE NODE and this client, will end when SN is shutdown")
    // FIXME: prompt
  }
  client.write(str, 'utf8')
})
