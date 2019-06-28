const fs = require('fs')

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

var storageDataDirReady = false
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
function loadBlockchainConfigFile(xmrOptions, config) {
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
        console.log('parsed loki config', moneroDiskOptions.unknown)
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
      console.log('parsed loki config', moneroDiskOptions.unknown)
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
      console.log('parsed loki config', moneroDiskOptions.unknown)
      for (var k in moneroDiskOptions.unknown) {
        var v = moneroDiskOptions.unknown[k]
        xmrOptions[k] = v
      }
      // reprocess data-dir and network setings
      setupInitialBlockchainOptions(xmrOptions, config)
    }
  }
}

// some auto config is slow and needs to be done only if we're ready to activate that sub system
// so maybe a lazyLoad config function for each subsystem to keep it organized

// normalization is done here...?
// and how much when...
function precheckConfig(config, args) {
  if (config.launcher === undefined) config.launcher = { interface: false }
  if (config.blockchain === undefined) config.blockchain = {}
  // replace any trailing slash before use...
  if (config.launcher.prefix) {
    config.launcher.prefix = config.launcher.prefix.replace(/\/$/, '')
    if (config.launcher.var_path === undefined) config.launcher.var_path = config.launcher.prefix + '/var'
    if (config.blockchain.binary_path === undefined) config.blockchain.binary_path = config.launcher.prefix + '/bin/lokid'
  }

  // we do need a var_path set for the all the PID stuff
  if (config.launcher.var_path === undefined) config.launcher.var_path = '/opt/loki-launcher/var'

  // we need data_dir and testnet
  // if we're not specifying the data_dir
  if (!config.blockchain.data_dir) {
    const os = require('os')
    //console.log('using default data_dir, network', config.blockchain.network)
    config.blockchain.data_dir = os.homedir() + '/.loki'
    config.blockchain.data_dir_is_default = true
  }
  // testnet we need diskConfig, xmrOptions
  var xmrOptions = parseXmrOptions(args)
  setupInitialBlockchainOptions(xmrOptions, config)

  // now that data_dir is potentially overrid
  config.blockchain.data_dir = config.blockchain.data_dir.replace(/\/$/, '')

  // getLokiDataDir should only be called after this point
  blockchainDataDirReady = true
  // loadBlockchainConfigFile needs blockchainDataDirReady to be ready

  // and ofc the lokid.conf can override it all
  loadBlockchainConfigFile(xmrOptions, config)

  // restrip data_dir as it's potentially overrid again
  config.blockchain.data_dir = config.blockchain.data_dir.replace(/\/$/, '')

  // now normalize network
  configureNetworks(config)

  storageDataDirReady = true
}

function checkLauncherConfig(config) {
  if (config.network === undefined) config.network = {}
  if (config.storage === undefined) config.storage = {}
  // launcher defaults

  // only thing you can't turn off is blockchain (lokid)
  // if you have storage without lokinet, it will use the public IP to serve on
  // we will internally change these defaults over time
  // users are not encourage (currently) to put these in their INI (only loki devs)
  if (config.network.enabled === undefined) {
    config.network.enabled = false
  }
  if (config.storage.enabled === undefined) {
    // only auto-enable for testnet for now
    //console.log('network', config.blockchain.network)
    if (config.blockchain.network == 'test') {
      config.storage.enabled = true
    } else {
      config.storage.enabled = false
    }
  }
}

// do we call this once per launcher start
// or on every daemon restart (not really applicable for launcher more for the other daemons...)
// i.e. storage/lokinet restarts, we need to know the current ip if in auto-config mode
// and then what about populating configs when we don't need too...
function setupLauncherConfig(config) {
//
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
  // in case they have a config file with no launcher section but had a blockchain section with this missing
  if (config.blockchain.binary_path === undefined) config.blockchain.binary_path = '/opt/loki-launcher/bin/lokid'
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
      config.blockchain.rpc_port = 38154
    } else {
      // main
      config.blockchain.rpc_port = 22023
    }
  }
  // actualize rpc_ip so we can pass it around to other daemons
  if (config.blockchain.rpc_ip === undefined) {
    config.blockchain.rpc_ip = '127.0.0.1'
  }
}

function checkNetworkConfig(config) {
  if (!config.network.enabled) return
  if (config.network.testnet === undefined) {
    config.network.testnet = config.blockchain.network == "test" || config.blockchain.network == "demo"
  }
  if (config.network.testnet && config.network.netid === undefined) {
    if (config.blockchain.network == "demo") {
      config.network.netid = "demonet"
    }
  }
}

function checkStorageConfig(config) {
  if (!config.storage.enabled) return
  if (config.storage.binary_path === undefined) config.storage.binary_path = '/opt/loki-launcher/bin/httpserver'
  if (config.storage.data_dir === undefined) {
    const os = require('os')
    config.storage.data_dir = os.homedir() + '/.loki/storage'
    config.storage.data_dir_is_default = true
  }
  // set default port
  if (!config.storage.port) {
    config.storage.port = 8080
  }
}

function postcheckConfig(config) {
  // replace any trailing slash
  if (config.launcher.var_path instanceof String) {
    config.launcher.var_path = config.launcher.var_path.replace(/\/$/, '')
  }
}

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
      lokinet.mkDirByPathSync(config.storage.data_dir)
      fs.chownSync(config.launcher.var_path, uid, 0)
    }
  }
  // from prequal.js
  // FIXME: but the desired user matters
  if (!fs.existsSync(config.blockchain.data_dir)) {
    // FIXME: hopefully running as the right user
    lokinet.mkDirByPathSync(config.blockchain.data_dir)
    fs.chownSync(config.launcher.var_path, uid, 0)
  }
  // from lokinet.js
  /*
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
  */
}

function checkConfig(config, args) {
  precheckConfig(config, args)
  checkLauncherConfig(config)
  checkBlockchainConfig(config)
  checkNetworkConfig(config)
  checkStorageConfig(config)
  postcheckConfig(config)
}

module.exports = {
  check: checkConfig,
  getDefaultConfig: getDefaultConfig,
  precheckConfig: precheckConfig,
  checkLauncherConfig: checkLauncherConfig,
  parseXmrOptions: parseXmrOptions,
  checkBlockchainConfig: checkBlockchainConfig,
  checkNetworkConfig: checkNetworkConfig,
  checkStorageConfig: checkStorageConfig,
  postcheckConfig: postcheckConfig,
  getLokiDataDir: getLokiDataDir,
  setupInitialBlockchainOptions: setupInitialBlockchainOptions,
  ensureDirectoriesExist: ensureDirectoriesExist,
}
