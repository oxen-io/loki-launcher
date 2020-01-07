const fs = require('fs')
const os = require('os')
const ini = require(__dirname + '/ini')
const lib = require(__dirname + '/lib')
const { execFileSync } = require('child_process')

// only defaults we can save to disk
// disk config is loaded over this...
function getDefaultConfig(entrypoint) {
  const config = {
    launcher: {
      prefix: '/opt/loki-launcher',
      //var_path: '/opt/loki-launcher/var',
    },
    blockchain: {
      //binary_path: '/opt/loki-launcher/bin/lokid',
    },
  }

  // how do we detect installed by apt vs npm?
  // only npm can install to /usr/local/bin
  // apt would be in /usr/bin
  // but what if we had both? we need to know which loki-launcher is called
  if (entrypoint.match('/usr/bin')) {
    // apt install
    delete config.launcher.prefix // remove prefix
    config.blockchain.binary_path = '/usr/sbin/lokid'
    config.launcher.var_path = '/var/lib/loki-launcher'
  }
  return config
}

// FIXME: convert getLokiDataDir to internal config value
// something like estimated/calculated loki_data_dir
// also this will change behavior if we actually set the CLI option to lokid
var blockchainDataDirReady = false
function getLokiDataDir(config) {
  if (!blockchainDataDirReady) {
    console.trace('getLokiDataDir is not ready for use!')
    process.exit(1)
  }
  // has no trailing slash
  var dir = config.blockchain.data_dir
  // enforce: no trailing slash
  if (dir[dir.length - 1] == '/') {
    dir = dir.slice(0, -1)
  }
  // I think Jason was wrong about this
  //if (blockchain_useDefaultDataDir) {
  if (config.blockchain.network == 'staging') {
    dir += '/stagenet'
  } else
    if (config.blockchain.network == 'demo') {
      dir += '/testnet'
    } else
      if (config.blockchain.network == 'test') {
        dir += '/testnet'
      }
  //}
  return dir
}


// only works after precheckConfig
var storageDataDirReady = false
// what calls this?!?
function getStorageServerDataDir(config) {
  if (!storageDataDirReady) {
    console.log('getStorageServerDataDir is not ready for use!')
    process.exit(1)
  }
  // has no trailing slash
  var dir = config.storage.data_dir
  // enforce: no trailing slash
  if (dir[dir.length - 1] == '/') {
    dir = dir.slice(0, -1)
  }
  // I think Jason was wrong about this
  //if (blockchain_useDefaultDataDir) {
  if (config.blockchain.network == 'staging') {
    dir += '/stagenet'
  } else
    if (config.blockchain.network == 'demo') {
      dir += '/testnet'
    } else
      if (config.blockchain.network == 'test') {
        dir += '/testnet'
      }
  //}
  return dir
}

function normalizeNetworkString(configAsk) {
  var net = 'main'
  // normalize inputs (allow for more options but clamping it down internally)
  var lConfigAsk = configAsk.toLowerCase()
  if (lConfigAsk == "test" || lConfigAsk == "testnet" || lConfigAsk == "test-net") {
    net = 'test'
  } else
    if (lConfigAsk == "consensusnet" || lConfigAsk == "consensus" || lConfigAsk == "demo") {
      // it's called demo in the launcher because I feel strong this is the best label
      // we can reuse this for future demos as an isolated network
      net = 'demo'
    } else
      if (lConfigAsk == "staging" || lConfigAsk == "stage") {
        net = 'staging'
      }
  return net
}

// XMR options have to be loaded before this
function configureNetworks(config) {
  if (config.launcher.network) {
    config.launcher.network = normalizeNetworkString(config.launcher.network)
    if (config.blockchain.network === undefined) {
      // FIXME: what about xmr options?
      config.blockchain.network = config.launcher.network
    }
  } else if (config.blockchain.network) {
    // launcher network is not set
    config.blockchain.network = normalizeNetworkString(config.blockchain.network)
    config.launcher.network = config.blockchain.network
  }
}

// has to be done after cli params
// and after data_dir slash is stripped
// needs blockchainDataDirReady to be ready too
// FIXME: merge with parseXmrOptions, so it's already finalize the xmrOptions variable
// might need setupInitialBlockchainOptions?
function loadBlockchainConfigFile(xmrOptions, config, output) {
  // data dir has to be set but should be before everything else
  if (xmrOptions['config-file']) {
    // read file in lokidata dir
    // FIXME: is it relative or absolute
    var filePath = xmrOptions['config-file']
    if (!fs.existsSync(filePath)) {
      var filePath2 = getLokiDataDir(config) + '/' + xmrOptions['config-file']
      if (!fs.existsSync(filePath2)) {
        console.warn('Can\'t read config-file command line argument, files does not exist: ', [filePath, filePath2])
      } else {
        const moneroDiskConfig = fs.readFileSync(filePath2)
        const moneroDiskOptions = ini.iniToJSON(moneroDiskConfig.toString())
        if (output) console.log('parsed loki config', moneroDiskOptions.unknown, 'from', filePath2)
        for (var k in moneroDiskOptions.unknown) {
          var v = moneroDiskOptions.unknown[k]
          xmrOptions[k] = v
        }
        // reprocess data-dir and network setings
        setupInitialBlockchainOptions(xmrOptions, config)
      }
    } else {
      const moneroDiskConfig = fs.readFileSync(filePath)
      const moneroDiskOptions = ini.iniToJSON(moneroDiskConfig.toString())
      if (output) console.log('parsed loki config', moneroDiskOptions.unknown, 'from', filePath)
      for (var k in moneroDiskOptions.unknown) {
        var v = moneroDiskOptions.unknown[k]
        xmrOptions[k] = v
      }
      // reprocess data-dir and network setings
      setupInitialBlockchainOptions(xmrOptions, config)
    }
  } else {
    // no config-file param but is there a config file...
    var defaultLokidConfigPath = getLokiDataDir(config) + '/loki.conf'
    if (fs.existsSync(defaultLokidConfigPath)) {
      const moneroDiskConfig = fs.readFileSync(defaultLokidConfigPath)
      const moneroDiskOptions = ini.iniToJSON(moneroDiskConfig.toString())
      if (output) console.log('parsed loki config', moneroDiskOptions.unknown, 'from', defaultLokidConfigPath)
      for (var k in moneroDiskOptions.unknown) {
        var v = moneroDiskOptions.unknown[k]
        xmrOptions[k] = v
      }
      // reprocess data-dir and network setings
      setupInitialBlockchainOptions(xmrOptions, config)
    }
  }

  // our ini loaded by this point
  // network and data_dir handled in setupInitialBlockchainOptions() earlier

  // convert .conf to ini options
  if (xmrOptions['p2p-bind-port']) {
    config.blockchain.p2p_port = xmrOptions['p2p-bind-port']
  }
  if (xmrOptions['rpc-bind-port']) {
    config.blockchain.rpc_port = xmrOptions['rpc-bind-port']
  }
  if (xmrOptions['zmq-rpc-bind-port']) {
    config.blockchain.zmq_port = xmrOptions['zmq-rpc-bind-port']
  }
  if (xmrOptions['quorumnet-port']) {
    config.blockchain.qun_port = xmrOptions['quorumnet-port']
  }

  if (xmrOptions['p2p-bind-ip']) {
    config.blockchain.p2p_ip = xmrOptions['p2p-bind-ip']
  }
  if (xmrOptions['zmq-rpc-bind-ip']) {
    config.blockchain.zmq_ip = xmrOptions['zmq-rpc-bind-ip']
  }

  if (xmrOptions['rpc-bind-ip']) {
    config.blockchain.rpc_ip = xmrOptions['rpc-bind-ip']
  }
  if (xmrOptions['rpc-login']) {
    if (xmrOptions['rpc-login'].match(/:/)) {
      var parts = xmrOptions['rpc-login'].split(/:/)
      config.blockchain.rpc_user = parts[0]
      config.blockchain.rpc_pass = parts[1]
    } else {
      config.blockchain.rpc_user = xmrOptions['rpc-login']
    }
  }

}

// some auto config is slow and needs to be done only if we're ready to activate that sub system
// so maybe a lazyLoad config function for each subsystem to keep it organized

// normalization is done here...?
// and how much when...

// PUBLIC
// we are assuming data_dir is set up
// and blockchainDataDirReady is true
function getOldBlockchainOptions(args, config, output) {
  // testnet we need diskConfig, xmrOptions
  var xmrOptions = parseXmrOptions(args)
  setupInitialBlockchainOptions(xmrOptions, config)
  // loadBlockchainConfigFile needs blockchainDataDirReady to be ready
  // and ofc the lokid.conf can override it all
  loadBlockchainConfigFile(xmrOptions, config, output)
  // what do we need to renormalize?
  return xmrOptions
}

// ran after disk config is loaded
function precheckConfig(config, args, debug) {
  if (config.launcher === undefined) config.launcher = { interface: false }
  if (config.blockchain === undefined) config.blockchain = {}
  if (config.network === undefined) config.network = {}
  if (config.storage === undefined) config.storage = {}
  // replace any trailing slash before use...
  if (config.launcher.prefix) {
    config.launcher.prefix = config.launcher.prefix.replace(/\/$/, '')
    if (config.launcher.var_path === undefined) config.launcher.var_path = config.launcher.prefix + '/var'
    if (config.blockchain.binary_path === undefined) config.blockchain.binary_path = config.launcher.prefix + '/bin/lokid'
    if (config.storage.binary_path === undefined) config.storage.binary_path = config.launcher.prefix + '/bin/loki-storage'
    if (config.network.binary_path === undefined) config.network.binary_path = config.launcher.prefix + '/bin/lokinet'
  }

  // we do need a var_path set for the all the PID stuff
  if (config.launcher.var_path === undefined) config.launcher.var_path = '/opt/loki-launcher/var'

  // we need data_dir and testnet
  // if we're not specifying the data_dir
  if (!config.blockchain.data_dir) {
    //console.log('using default data_dir, network', config.blockchain.network)
    // FIXME: really should be left alone and we should have a getter
    config.blockchain.data_dir = os.homedir() + '/.loki'
    config.blockchain.data_dir_is_default = true
  }

  // now that data_dir is potentially overrid
  config.blockchain.data_dir = config.blockchain.data_dir.replace(/\/$/, '')

  // getLokiDataDir should only be called after this point
  blockchainDataDirReady = true

  // testnet we need diskConfig, xmrOptions
  getOldBlockchainOptions(args, config, debug)

  // restrip data_dir as it's potentially overrid again
  config.blockchain.data_dir = config.blockchain.data_dir.replace(/\/$/, '')

  // now normalize network (has to be after xmr options loaded)
  configureNetworks(config)

  storageDataDirReady = true
}

var binary3xCache = null
var binary4Xor5XCache = null

function getLokidVersion(config) {
  if (config.blockchain.binary_path && fs.existsSync(config.blockchain.binary_path)) {
    try {
      var stdout = execFileSync(config.blockchain.binary_path, ['--version'])
      var lokid_version = stdout.toString().trim()
      //console.log('lokid_version', lokid_version)
      binary3xCache = lokid_version.match(/v3\.0/)?true:false
      binary4Xor5XCache = lokid_version.match(/v[54]\./)?true:false
      return binary3xCache
    } catch(e) {
      console.error('Cant detect lokid version', e)
      // can't hurt to retry I guess, maybe it is a temp problem
      //binary3xCache = null
    }
  } else {
    binary3xCache = undefined
    binary4Xor5XCache = undefined
  }
}

function isBlockchainBinary3X(config) {
  if (binary3xCache !== null) return binary3xCache
  getLokidVersion(config)
  return binary3xCache
}

function isBlockchainBinary4Xor5X(config) {
  if (binary4Xor5XCache !== null) return binary4Xor5XCache
  getLokidVersion(config)
  return binary4Xor5XCache
}


function checkLauncherConfig(config) {
  if (config.network === undefined) config.network = {}
  if (config.storage === undefined) config.storage = {}
  // launcher defaults

  // in case they have a config file with no launcher section but had a blockchain section with this missing
  // had to move this from blockchain to launcher, so we can do the version check
  if (config.blockchain.binary_path === undefined) config.blockchain.binary_path = '/opt/loki-launcher/bin/lokid'

  // only thing you can't turn off is blockchain (lokid)
  // if you have storage without lokinet, it will use the public IP to serve on
  // we will internally change these defaults over time
  // users are not encourage (currently) to put these in their INI (only loki devs)
  if (config.network.enabled === undefined) {
    if (isBlockchainBinary3X(config) || isBlockchainBinary4Xor5X(config)) {
      console.log('3-5 series blockchain binary detected, disabling lokinet by default')
      config.network.enabled = false
    } else {
      config.network.enabled = true
    }
    //console.log('lokinet should be running?', config.network.enabled)
  }
  if (config.storage.enabled === undefined) {
    config.storage.enabled = true

    var is3x = isBlockchainBinary3X(config)
    //console.log('is3x', is3x)
    // only disable if on 3.x
    if (is3x === true) {
      console.log('3.x series blockchain binary detected, disabling storage server by default')
      config.storage.enabled = false
    }
    // I don't think we need this, 3.x users will be in the minority
     /* else
    if (is3x === undefined) {
      console.log('Could not detect your lokid version, leaving storage server enabled')
    } */
  }
}

// do we call this once per launcher start
// or on every daemon restart (not really applicable for launcher more for the other daemons...)
// i.e. storage/lokinet restarts, we need to know the current ip if in auto-config mode
// and then what about populating configs when we don't need too...
function setupLauncherConfig(config) {
//
}

// load enough config to be able to stop the launcher
function enoughToStop() {
  // ??
}

// preprocess command line arguments
function parseXmrOptions(args) {
  var configSet = {}
  function setConfig(key, value) {
    if (configSet[key] !== undefined) {
      if (configSet[key].constructor.name == 'String') {
        if (configSet[key] != value) {
          configSet[key] = [configSet[key], value]
          //} else {
          // if just setting the same thing again then nothing to do
        }
      } else
      if (configSet[key].constructor.name == 'Boolean') {
        // likely a key without a value
        configSet[key] = value
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
  var last = null
  for (var i in args) {
    var arg = args[i]
    //console.log('arg', arg)
    if (arg.match(/^--/)) {
      var removeDashes = arg.replace(/^--/, '')
      if (arg.match(/=/)) {
        // key/value pairs
        var parts = removeDashes.split(/=/)
        var key = parts.shift()
        var value = parts.join('=')
        setConfig(key, value)
        last = null
      } else {
        // --stagenet
        setConfig(removeDashes, true)
        last = removeDashes
      }
    } else {
      // hack to allow equal to be optional..
      if (last != null) {
        console.log('should stitch together key', last, 'and value', arg, '?')
        setConfig(last, arg)
      }
      last = null
    }
  }
  return configSet
}

// pre reqs:
// we need the disk config loaded by this point
// we need the CLI options loaded
// output/needs to figure out:
// data-dir and
// network
function setupInitialBlockchainOptions(xmrOptions, config) {
  // Merge in command line options
  if (xmrOptions['data-dir']) {
    var dir = xmrOptions['data-dir']
    config.blockchain.data_dir = dir
    // does this directory exist?
    if (!fs.existsSync(dir)) {
      console.warn('Configured data-dir [' + dir + '] does not exist, lokid will create it')
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

function checkBlockchainConfig(config) {
  // set default
  // set network so we can run toLowerCase on it
  if (config.blockchain.network === undefined) {
    config.blockchain.network = 'main'
  }
  // fix up rpc_port for prequal
  if (config.blockchain.rpc_port === undefined) {
    config.blockchain.rpc_port = '0'
  }
  if (config.blockchain.rpc_port == '0') {
    if (config.blockchain.network == 'test') {
      config.blockchain.rpc_port = 38157
    } else
    if (config.blockchain.network == 'demo') {
      config.blockchain.rpc_port = 38160
    } else
    if (config.blockchain.network == 'staging') {
      config.blockchain.rpc_port = 38057
    } else {
      // main
      config.blockchain.rpc_port = 22023
    }
  }

  // we know to know about these ports for the port check on start mode
  if (config.blockchain.qun_port === undefined || config.blockchain.qun_port === '0') {
    if (config.blockchain.network == 'test') {
      config.blockchain.qun_port = 38159
    } else
    if (config.blockchain.network == 'staging') {
      config.blockchain.qun_port = 38059
    } else {
      config.blockchain.qun_port = 22025
    }
  }

  // actualize rpc_ip so we can pass it around to other daemons
  if (config.blockchain.rpc_ip === undefined) {
    config.blockchain.rpc_ip = '127.0.0.1'
  }

  config.blockchain.lokid_key = getLokiDataDir(config) + '/key'
  config.blockchain.lokid_edkey = getLokiDataDir(config) + '/key_ed25519'
}

// should require blockchain to be configured
function checkNetworkConfig(config) {
  // configure this even if not enabled, for prequal
  if (config.network.public_port === undefined) {
    config.network.public_port = config.network.testnet ? 1666 : 1090
  }
  if (!config.network.enabled) return
  if (config.network.binary_path === undefined) config.network.binary_path = '/opt/loki-launcher/bin/lokinet'
  if (config.network.testnet === undefined) {
    config.network.testnet = config.blockchain.network == "test" || config.blockchain.network == "demo"
  }
  if (config.network.testnet && config.network.netid === undefined) {
    if (config.blockchain.network == "demo") {
      config.network.netid = "demonet"
    } else {
      config.network.netid = "gamma"
    }
  }
  // putting all files required for migration into ~/.loki/network
  if (config.network.data_dir === undefined) {
    // FIXME: really should be left alone and we should have a getter
    //console.log('default network server path, blockchain is', config.blockchain.data_dir)
    //config.network.data_dir = getLokiDataDir(config) + '/network'
    config.network.data_dir = os.homedir() + '/.loki/network'
    if (config.network.testnet) {
      config.network.data_dir += '_testnet'
    }
    config.network.data_dir_is_default = true
  }

  // if no bootstrap, set default (can't leave this blank for lokinet)
  if (config.network.bootstrap_path === undefined && config.network.connects === undefined &&
     config.network.bootstrap_url === undefined) {
    if (config.network.testnet) {
      config.network.bootstrap_url = 'https://seed.lokinet.org/testnet.signed'
    } else {
      config.network.bootstrap_url = 'https://seed.lokinet.org/lokinet.signed'
    }
  }

  if (config.network.rpc_port === undefined) {
    config.network.rpc_port = 1190
  }
  /*
    mkdir -p /dev/net
    mknod /dev/net/tun c 10 200
  */
}

// requires blockchain to be configured
// we need lokid_key configured for status mode
function checkStorageConfig(config) {
  if (!config.storage.enabled) return
  if (config.storage.binary_path === undefined) config.storage.binary_path = '/opt/loki-launcher/bin/loki-storage'

  if (config.storage.testnet === undefined) {
    config.storage.testnet = config.blockchain.network == "test" || config.blockchain.network == "demo"
  }

  if (config.storage.data_dir === undefined) {
    // FIXME: really should be left alone and we should have a getter
    //console.log('default storage server path, blockchain is', config.blockchain.data_dir)
    //config.storage.data_dir = getLokiDataDir(config) + '/storage'
    // launcher can use the same storage path for testnet and mainnet
    config.storage.data_dir = os.homedir() + '/.loki/storage'
    if (config.storage.testnet) {
      config.storage.data_dir += '_testnet'
    }
    config.storage.data_dir_is_default = true
  }
  // append /testnet if needed
  //config.storage.data_dir = getStorageServerDataDir(config)
  // set default port
  if (!config.storage.port) {
    config.storage.port = config.storage.testnet ? 38155 : 22021
  }
  // storage server auto config
  if (config.storage.lokid_key === undefined) {
    config.storage.lokid_key = getLokiDataDir(config) + '/key'
  }
  config.storage.lokid_rpc_port = config.blockchain.rpc_port
}

function postcheckConfig(config) {
  // replace any trailing slash
  if (config.launcher.var_path instanceof String) {
    config.launcher.var_path = config.launcher.var_path.replace(/\/$/, '')
  }
}

// doesn't work because of the ip bind scope...
function isPortUsed(port, skip) {

  if (skip !== 'blockchain.rpc_port' && config.blockchain.rpc_port == port) return true
  if (skip !== 'blockchain.p2p_port' && config.blockchain.p2p_port == port) return true
  if (skip !== 'blockchain.zmq_port' && config.blockchain.zmq_port == port) return true
  if (skip !== 'blockchain.qun_port' && config.blockchain.qun_port == port) return true

  if (skip !== 'network.rpc_port' && config.network.rpc_port == port) return true
  if (skip !== 'network.dns_port' && config.network.dns_port == port) return true

  if (skip !== 'storage.port' && config.storage.port == port) return true

  return false
}

function portChecks(config) {
  // only sets p2p port
  prequal(config) // set up all the ports
  // track by localhost, all_zeros
  const localhosts = []
  const alls = []
  const ips = []

  function addPort(ip, port, type) {
    // if the port isn't set, don't check the conflicts on it
    if (port === undefined) {
      console.trace(type, 'was passed as undefined')
      return
    }
    const obj = {
      type: type,
      ip: ip,
      port: port
    }
    if (ip === '127.0.0.1') {
      localhosts.push(obj)
    } else if (ip === '0.0.0.0') {
      alls.push(obj)
    } else {
      // not fully thought out...
      ips.push(obj)
    }
  }

  if (config.blockchain.p2p_ip === undefined) {
    config.blockchain.p2p_ip = '0.0.0.0'
  }
  // rpc_ip can be configured
  if (config.blockchain.rpc_ip === undefined) {
    config.blockchain.rpc_ip = '127.0.0.1'
  }
  if (config.blockchain.zmq_ip === undefined) {
    config.blockchain.zmq_ip = '127.0.0.1'
  }
  if (config.blockchain.qun_ip === undefined) {
    config.blockchain.qun_ip = '' // your public ip
  }

  addPort(config.blockchain.p2p_ip, config.blockchain.p2p_port, 'blockchain.p2p')
  addPort(config.blockchain.rpc_ip, config.blockchain.rpc_port, 'blockchain.rpc')
  if (config.blockchain.zmq_port) {
    addPort(config.blockchain.zmq_ip, config.blockchain.zmq_port, 'blockchain.zmq')
  }
  addPort(config.blockchain.qun_ip, config.blockchain.qun_port, 'blockchain.qun')

  if (config.network.enabled) {
    if (config.network.rpc_ip === undefined) {
      config.network.rpc_ip = '127.0.0.1'
    }
    if (config.network.dns_ip === undefined) {
      config.network.dns_ip = '127.3.2.1' // your public ip
    }
    addPort(config.network.rpc_ip, config.network.rpc_port, 'network.rpc')
    if (config.network.dns_port) {
      addPort(config.network.dns_ip, config.network.dns_port, 'network.dns')
    }
  }

  if (config.storage.enabled) {
    if (config.storage.ip === undefined) {
      config.storage.ip = '0.0.0.0'
    }
    addPort(config.storage.ip, config.storage.port, 'storage.port')
  }

  const conflicts = []

  localhosts.forEach(obj => {
    if (alls.some(test => test.port == obj.port && test.type != obj.type)) {
      // localhosts.filter(test => test.port == obj.port)
      //console.log('found conflict with', obj)
      if (conflicts.indexOf(obj) === -1) conflicts.push(obj)
    }
    if (localhosts.some(test => test.port == obj.port && test.type != obj.type)) {
      // localhosts.filter(test => test.port == obj.port)
      //console.log('found conflict with', obj)
      if (conflicts.indexOf(obj) === -1) conflicts.push(obj)
    }
  })

  ips.forEach(obj => {
    if (alls.some(test => test.port == obj.port && test.type != obj.type)) {
      // localhosts.filter(test => test.port == obj.port)
      //console.log('found conflict with', obj)
      if (conflicts.indexOf(obj) === -1) conflicts.push(obj)
    }
    if (ips.some(test => test.port == obj.port && test.type != obj.type)) {
      // localhosts.filter(test => test.port == obj.port)
      //console.log('found conflict with', obj)
      if (conflicts.indexOf(obj) === -1) conflicts.push(obj)
    }
  })

  alls.forEach(obj => {
    if (alls.some(test => test.port == obj.port && test.type != obj.type)) {
      // localhosts.filter(test => test.port == obj.port)
      //console.log('found conflict with', obj)
      if (conflicts.indexOf(obj) === -1) conflicts.push(obj)
    }
    if (localhosts.some(test => test.port == obj.port && test.type != obj.type)) {
      // localhosts.filter(test => test.port == obj.port)
      //console.log('found conflict with', obj)
      if (conflicts.indexOf(obj) === -1) conflicts.push(obj)
    }
    if (ips.some(test => test.port == obj.port && test.type != obj.type)) {
      // localhosts.filter(test => test.port == obj.port)
      //console.log('found conflict with', obj)
      if (conflicts.indexOf(obj) === -1) conflicts.push(obj)
    }
  })

  if (conflicts.length) {
    console.log('configuration port conflicts:')
    conflicts.forEach(con => {
      console.log('configuration item', con.type, 'uses port', con.port, 'on', con.ip)
    })
    console.log('please make sure they are all unique values')
    process.exit(1)
  }
}

/*
function changeHomedir(config, homedir) {
  if (config.blockchain.data_dir_is_default) {
    config.blockchain.data_dir = homedir + '/.loki'
  }
  if (config.network.data_dir_is_default) {
    config.network.data_dir = homedir + '/.loki/network'
    if (config.network.testnet) {
      config.network.data_dir += '_testnet'
    }
  }
  if (config.storage.data_dir_is_default) {
    config.storage.data_dir = homedir + '/.loki/storage'
    if (config.storage.testnet) {
      config.storage.data_dir += '_testnet'
    }
  }
}
*/

// the desired user matters
// hopefully running as the right user
// we only make dirs as current user if they don't exit
// won't affect perms on the dir after
// so fix-perms can right everything
function ensureDirectoriesExist(config, uid) {
  // from start... (also potentially fix-perms...)
  if (!fs.existsSync(config.launcher.var_path)) {
    // just make sure this directory exists
    // FIXME: maybe skip if root...
    console.log('making', config.launcher.var_path)
    lokinet.mkDirByPathSync(config.launcher.var_path)
    fs.chownSync(config.launcher.var_path, uid, 0)
  }
  // from daemon...
  if (config.storage.data_dir !== undefined) {
    if (!fs.existsSync(config.storage.data_dir)) {
      consoel.log('making', config.storage.data_dir)
      lokinet.mkDirByPathSync(config.storage.data_dir)
      fs.chownSync(config.launcher.var_path, uid, 0)
    }
  }
  // from prequal.js
  if (!fs.existsSync(config.blockchain.data_dir)) {
    lokinet.mkDirByPathSync(config.blockchain.data_dir)
    fs.chownSync(config.launcher.var_path, uid, 0)
  }
  // from lokinet.js
  if (config.network.data_dir && !fs.existsSync(config.network.data_dir)) {
    consoel.log('making', config.data_dir)
    mkDirByPathSync(config.data_dir)
    fs.chownSync(config.launcher.var_path, uid, 0)
  }
  if (config.network.lokinet_nodedb && !fs.existsSync(config.network.lokinet_nodedb)) {
    console.log('making', config.network.lokinet_nodedb)
    mkDirByPathSync(config.network.lokinet_nodedb)
    fs.chownSync(config.launcher.var_path, uid, 0)
  }
}

// ran after disk config is loaded
// for everything (index.js)
function checkConfig(config, args, debug) {
  precheckConfig(config, args, debug)
  checkLauncherConfig(config)
  checkBlockchainConfig(config)
  checkNetworkConfig(config)
  checkStorageConfig(config)
  postcheckConfig(config)
  // this means no prequal, fix-perm, etc...
  portChecks(config) // will exit if not ok
  // also check ifname
  if (config.network.ifname && config.network.ifname.length > 16) {
    console.error('Your network.ifname "' + config.network.ifname + '" is too long, is', config.network.ifname.length, 'characters long, need to be 16 or less.')
    process.exit(1)
  }
}

// need blockchain.p2pport, blockchain.qun_port, network.public_port
function prequal(config) {
  // this port is set by default in lokid
  // and it's not a required port, just a prequal suggestion check
  if (config.blockchain.p2p_port === undefined || config.blockchain.p2p_port === '0') {
    // configure based on network
    // only do this here
    // p2p_port if deafult should be left for undefined...
    if (config.blockchain.network == 'test') {
      config.blockchain.p2p_port = 38156
    } else
    if (config.blockchain.network == 'demo') {
      config.blockchain.p2p_port = 38159
    } else
    if (config.blockchain.network == 'staging') {
      config.blockchain.p2p_port = 38056
    } else {
      config.blockchain.p2p_port = 22022
    }
  }
}

// should only be used to advise non-advanced users
function isSystemdInUse(config) {
  // use lib to figure out if running is
  var pids = lib.getPids(config)
  if (pids && pids.runningConfig) {
    if (pids.runningConfig.launcher && pids.runningConfig.launcher.docker) {
      // 75% sure this is systemd
      // but the remaining 25% are advanced users
      return true
    } else {
      return false
    }
  }

  // check for service file
  if (fs.existsSync('/etc/systemd/system/lokid.service')) {
    // even if there's a service doesn't mean it's what they use...
    if (process.getuid() == 0) {
      // we should run some commands to check...
    }
    // going to need a config option
    return 'unsure'
  }
  return false
}

module.exports = {
  check: checkConfig,
  getDefaultConfig: getDefaultConfig,
  precheckConfig: precheckConfig,
  checkLauncherConfig: checkLauncherConfig,
  getOldBlockchainOptions: getOldBlockchainOptions,
  checkBlockchainConfig: checkBlockchainConfig,
  checkNetworkConfig: checkNetworkConfig,
  checkStorageConfig: checkStorageConfig,
  postcheckConfig: postcheckConfig,
  getLokiDataDir: getLokiDataDir,
  prequal: prequal,
  setupInitialBlockchainOptions: setupInitialBlockchainOptions,
  ensureDirectoriesExist: ensureDirectoriesExist,
  isBlockchainBinary3X: isBlockchainBinary3X,
  isBlockchainBinary4Xor5X: isBlockchainBinary4Xor5X,
}
