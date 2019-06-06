
// only defaults we can save to disk
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
    config.launcher.run_path = '/var/lib/loki-launcher'
  }
  return config
}

function precheckConfig(config) {
  // replace any trailing slash before use...
  config.launcher.prefix = config.launcher.prefix.replace(/\/$/, '')
  if (config.launcher.prefix) {
    if (config.launcher.var_path === undefined) config.launcher.var_path = config.launcher.prefix + '/var'
    if (config.blockchain.binary_path === undefined) config.blockchain.binary_path = config.launcher.prefix + '/bin/lokid'
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
      config.blockchain.rpc_port = 38154
    } else {
      // main
      config.blockchain.rpc_port = 22023
    }
  }
}

function checkNetworkConfig(config) {
  if (config.network === undefined) config.network = {}
}

function checkStorageConfig(config) {
  if (config.storage === undefined) config.storage = {}
}

function postcheckConfig(config) {
  // replace any trailing slash
  config.launcher.var_path = config.launcher.var_path.replace(/\/$/, '')

}

function checkConfig(config) {
  precheckConfig(config)
  checkBlockchainConfig(config)
  checkNetworkConfig(config)
  checkStorageConfig(config)
  postcheckConfig(config)
}

module.exports = {
  check: checkConfig,
  getDefaultConfig: getDefaultConfig,
  precheckConfig: precheckConfig,
  checkBlockchainConfig: checkBlockchainConfig,
  checkNetworkConfig: checkNetworkConfig,
  checkStorageConfig: checkStorageConfig,
  postcheckConfig: postcheckConfig,
}
