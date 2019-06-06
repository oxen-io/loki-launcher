
// only defaults we can save to disk
function getDefaultConfig(entrypoint) {
  const config = {
    launcher: {
    },
    blockchain: {
      binary_path: '/opt/loki-launcher/bin/lokid',
    },
  }

  // how do we detect installed by apt vs npm?
  // only npm can install to /usr/local/bin
  // apt would be in /usr/bin
  // but what if we had both? we need to know which loki-launcher is called
  if (entrypoint.match('/usr/bin')) {
    // apt install
    config.blockchain.binary_path = '/usr/sbin/lokid'
  }
  return config
}

function precheckConfig(config) {
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
