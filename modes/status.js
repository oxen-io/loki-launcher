const lib     = require(__dirname + '/../lib')
const lokinet = require(__dirname + '/../lokinet')

let config
function start(pConfig) {
  config = pConfig
}

function status() {
  // calls areWeRunning && getPids
  var running = lib.getProcessState(config)
  var pids = lib.getPids(config)
  if (pids && !pids.err && running.launcher) {
    console.log('replacing disk config with running config')
    // too long sometimes, output elsewhere...
    // console.log('runningConfig', pids.runningConfig)
    config = pids.runningConfig
  }

  if (running.lokid === undefined) {
    //console.log('no pids...')
    var pid = lib.areWeRunning(config)
    // if no pids.json and somehow we're running? (pids.json got deleted)
    if (pids.err == 'noFile'  && pid) {
      console.log('Launcher is running with no', config.launcher.var_path + '/pids.json, giving it a little nudge, please run status again, current results maybe incorrect')
      process.kill(pid, 'SIGHUP')
    } else if (pids.err && pids.err != 'noFile') {
      console.error('error reading file', config.launcher.var_path + '/pids.json', pids.err)
    }

    // if no launcher, check for the port...
    if (!pid) {
      lokinet.portIsFree(config.blockchain.rpc_ip, config.blockchain.rpc_port, function(portFree) {
        if (!portFree) {
          console.log('')
          console.log('There\'s a lokid that we\'re not tracking using our configuration (rpc_port is already in use). You likely will want to confirm and manually stop it before start using the launcher again.');
          // Exiting...
          console.log('')
          if (pids.err == 'noFile') {
            // could attach and track...
          } else {
            // noFile explains why we know lokid isn't running...
          }
        }
      });
    }
    // if we have a launcher, then ofc the port SHOULD be in use...

  }
  //console.log('status pids', pids)
  //console.log('running', running)
  // if the launcher is running
  if (running.launcher) {
  } else {
    console.log('Launcher is not running')
    // FIXME: may want to check on child daemons to make sure they're not free floating?
  }
  // launcher will always be imperfect
  // show info IF we have it
  // processes may be broken/zombies
  if (pids.blockchain_startTime) {
    console.log('Last blockchain (re)start:', new Date(pids.blockchain_startTime))
  }
  if (pids.network_startTime) {
    console.log('Last network    (re)start:', new Date(pids.network_startTime))
  }
  if (pids.storage_startTime) {
    console.log('Last storage    (re)start:', new Date(pids.storage_startTime))
  }

  // "not running" but too easy to confuse with "running"
  lib.getLauncherStatus(config, lokinet, 'offline', function(running, checklist) {
    var nodeVer = Number(process.version.match(/^v(\d+\.\d+)/)[1])
    //console.log('nodeVer', nodeVer)
    if (nodeVer >= 10) {
      console.table(checklist)
    } else {
      console.log(checklist)
    }
  })

  if (running.lokid) {
    // read config, run it with status param...
    // spawn out and relay output...
    // could also use the socket to issue a print_sn_status
  }
}

function checkBlockchain() {
  var useIp = config.blockchain.rpc_ip
  if (useIp === '0.0.0.0') useIp = '127.0.0.1'
  const url = 'http://' + useIp + ':' + config.blockchain.rpc_port + '/json_rpc'
  const jsonPost = {
    jsonrpc: "2.0",
    id: "0",
    method: "get_info"
  }
  lib.httpPost(url, JSON.stringify(jsonPost), function(json) {
    var data = JSON.parse(json)
    console.log('result', data.result)
    // get_block_count
    // console.log('block count', data.result.count)
  })
}

function checkStorage() {
  lib.runStorageRPCTest(lokinet, config, function(data) {
    if (data === undefined) {
      console.log('failure')
    } else {
      console.log('looks good')
    }
  })
  /*
  var useIp = config.storage.ip
  if (useIp === '0.0.0.0') useIp = '127.0.0.1'
  const url = 'https://' + useIp + ':' + config.storage.port + '/get_stats/v1'
  var oldTLSValue = process.env["NODE_TLS_REJECT_UNAUTHORIZED"]
  process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0 // turn it off for now
  lokinet.httpGet(url, function(data) {
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = oldTLSValue
    console.log('result', data)
    // get_block_count
    // console.log('block count', data.result.count)
  })
  */
}

function checkNetwork() {
  var useIp = config.network.rpc_ip
  if (useIp === '0.0.0.0') useIp = '127.0.0.1'
  const url = 'http://' + useIp + ':' + config.network.rpc_port + '/'
  const jsonPost = {
    jsonrpc: "2.0",
    id: "0",
    method: "llarp.version"
  }
  lib.httpPost(url, JSON.stringify(jsonPost), function(json) {
    console.log('json', json)
    // 0.6.x support
    if (json === 'bad json object') {
      console.log('')
    }
    //var data = JSON.parse(json)
    //console.log('result', data.result)
    // get_block_count
    // console.log('block count', data.result.count)
  })
}

module.exports = {
  start: start,
  status: status,
  checkBlockchain: checkBlockchain,
  checkStorage: checkStorage,
  checkNetwork: checkNetwork,
}
