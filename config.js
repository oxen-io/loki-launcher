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
    console.log('getLokiDataDir is not ready for use!')
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
    console.log('getLokiDataDir is not ready for use!')
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

// some auto config is slow and needs to be done only if we're ready to activate that sub system
// so maybe a lazyLoad config function for each subsystem to keep it organized

// normalization is done here...?
// and how much when...
function precheckConfig(config) {
  if (config.launcher === undefined) config.launcher = { interface: false }
  if (config.blockchain === undefined) config.blockchain = {}
  // replace any trailing slash before use...
  if (config.launcher.prefix) {
    config.launcher.prefix = config.launcher.prefix.replace(/\/$/, '')
    if (config.launcher.var_path === undefined) config.launcher.var_path = config.launcher.prefix + '/var'
    if (config.blockchain.binary_path === undefined) config.blockchain.binary_path = config.launcher.prefix + '/bin/lokid'
  }
  // in case they have a config file with no launcher section but had a blockchain section with this missing
  if (config.blockchain.binary_path === undefined) config.blockchain.binary_path = '/opt/loki-launcher/bin/lokid'

  // we do need a var_path set for the all the PID stuff
  if (config.launcher.var_path === undefined) config.launcher.var_path = '/opt/loki-launcher/var'

  // if we're not specifying the data_dir
  if (!config.blockchain.data_dir) {
    const os = require('os')
    //console.log('using default data_dir, network', config.blockchain.network)
    config.blockchain.data_dir = os.homedir() + '/.loki'
    config.blockchain.data_dir_is_default = true
  }
  config.blockchain.data_dir = config.blockchain.data_dir.replace(/\/$/, '')
  // getLokiDataDir should only be called after this point
  blockchainDataDirReady = true
  storageDataDirReady = true
}

function checkLauncherConfig(config) {
}

// do we call this once per launcher start
// or on every daemon restart (not really applicable for launcher more for the other daemons...)
// i.e. storage/lokinet restarts, we need to know the current ip if in auto-config mode
// and then what about populating configs when we don't need too...
function setupLauncherConfig(config) {
//
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
  if (config.network === undefined) config.network = {}
}

function checkStorageConfig(config) {
  if (config.storage === undefined) config.storage = {}
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

function checkConfig(config) {
  precheckConfig(config)
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
  checkBlockchainConfig: checkBlockchainConfig,
  checkNetworkConfig: checkNetworkConfig,
  checkStorageConfig: checkStorageConfig,
  postcheckConfig: postcheckConfig,
  getLokiDataDir: getLokiDataDir,
  ensureDirectoriesExist: ensureDirectoriesExist,
}
