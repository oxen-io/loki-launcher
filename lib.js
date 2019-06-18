// no npm!
const fs = require('fs')

//
// common functions for client and daemon
//

function hereDoc(f) {
  return f.toString().
    replace(/^[^\/]+\/\*!?/, '').
    replace(/\*\/[^\/]+$/, '')
}

var logo = hereDoc(function () {/*!
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
         .oNMNk;             __LABEL__
          .l0l.
*/});

function getLogo(str) {
  //'L A U N C H E R   v e r s i o n   v version'
  return logo.replace(/__LABEL__/, str)
}

function falsish(val) {
  if (val === undefined) return true
  if (val === null) return true
  if (val === false) return true
  if (val === 0) return true
  if (val === true) return false
  if (val === 1) return false
  if (val.toLowerCase() === 'false') return true
  if (val.toLowerCase() === 'no') return true
  return false
}

function isPidRunning(pid) {
  if (pid === undefined) {
    console.trace('isPidRunning was passed undefined, reporting not running')
    return false
  }
  try {
    process.kill(pid, 0)
    //console.log('able to kill', pid)
    return true
  } catch (e) {
    if (e.code == 'ERR_INVALID_ARG_TYPE') {
      // means pid was undefined
      return true
    }
    if (e.code == 'ESRCH') {
      // not running
      return false
    }
    if (e.code == 'EPERM') {
      // we're don't have enough permissions to signal this process
      return true
    }
    console.log(pid, 'isRunning', e.code)
    return false
  }
  return false
}

function clearStartupLock(config) {
  // clear our start up lock (if needed, will crash if not there)
  if (fs.existsSync(config.launcher.var_path + '/launcher.pid')) {
    fs.unlinkSync(config.launcher.var_path + '/launcher.pid')
  }
}

function areWeRunning(config) {
  var pid = 0 // default is not running
  if (fs.existsSync(config.launcher.var_path + '/launcher.pid')) {
    // we are already running
    pid = fs.readFileSync(config.launcher.var_path + '/launcher.pid', 'utf8')
    if (isPidRunning(pid)) {
      // pid is correct
    } else {
      console.log('stale ' + config.launcher.var_path + '/launcher.pid')
      pid = 0
    }
  }
  return pid
}

function setStartupLock(config) {
  fs.writeFileSync(config.launcher.var_path + '/launcher.pid', process.pid)
}

function clearPids(config) {
  if (fs.existsSync(config.launcher.var_path + '/pids.json')) {
    console.log('LAUNCHER: clearing ' + config.launcher.var_path + '/pids.json')
    fs.unlinkSync(config.launcher.var_path + '/pids.json')
  } else {
    console.log('LAUNCHER: NO ' + config.launcher.var_path + '/pids.json found, can\'t clear')
  }
}

function savePids(config, args, loki_daemon, lokinet, storageServer) {
  var obj = {
    runningConfig: config,
    arg: args,
    launcher: process.pid
  }
  if (loki_daemon && !loki_daemon.killed && loki_daemon.pid) {
    obj.lokid = loki_daemon.pid
  }
  if (storageServer && !storageServer.killed && storageServer.pid) {
    obj.storageServer = storageServer.pid
  }
  var lokinetPID = lokinet.getPID()
  if (lokinetPID) {
    obj.lokinet = lokinetPID
  }
  fs.writeFileSync(config.launcher.var_path + '/pids.json', JSON.stringify(obj))
}

function getPids(config) {
  if (!fs.existsSync(config.launcher.var_path + '/pids.json')) {
    return { err: "noFile" }
  }
  // we are already running
  var json
  try {
    json = fs.readFileSync(config.launcher.var_path + '/pids.json', 'utf8')
  } catch (e) {
    // we had one integration test say this file was deleted after the existence check
    console.warn(config.launcher.var_path + '/pids.json', 'had a problem', e)
    return { err: "noRead" }
  }
  var obj = { err: "noParse" }
  try {
    obj = JSON.parse(json)
  } catch (e) {
    console.error('Can not parse JSON from', config.launcher.var_path + '/pids.json', json)
  }
  return obj
}

// is this the stupidest function or what?
function getProcessState(config) {
  // what happens if we get different options than what we had before
  // maybe prompt to confirm restart
  // if already running just connect for now
  var running = {}
  var pid = areWeRunning(config)
  if (pid) {
    running.launcher = pid
  }
  var pids = getPids(config)
  if (pids.lokid && isPidRunning(pids.lokid)) {
    //console.log("LAUNCHER: old lokid is still running", pids.lokid)
    running.lokid = pids.lokid
  }
  if (config.network.enabled) {
    if (pids.lokinet && isPidRunning(pids.lokinet)) {
      //console.log("LAUNCHER: old lokinet is still running", pids.lokinet)
      running.lokinet = pids.lokinet
    }
  }
  if (config.storage.enabled) {
    if (pids.storageServer && isPidRunning(pids.storageServer)) {
      //console.log("LAUNCHER: old storage server is still running", pids.storageServer)
      running.storageServer = pids.storageServer
    }
  }
  return running
}

function getLauncherStatus(config, lokinet, offlineMessage, cb) {
  var checklist = {}
  var running = getProcessState(config)
  // pid...
  checklist.launcher = running.launcher ? ('running as ' + running.launcher) : offlineMessage
  checklist.blockchain = running.lokid ? ('running as ' + running.lokid) : offlineMessage
  if (config.network.enabled) {
    checklist.network = running.lokinet ? ('running as ' + running.lokinet) : offlineMessage
    // lokinet rpc check?
  }
  if (config.storage.enabled) {
    checklist.storageServer = running.storageServer ? ('running as ' + running.storageServer) : offlineMessage
  }

  // socket...
  var haveSocket = fs.existsSync(config.launcher.var_path + '/launcher.socket')
  //checklist.push('socket', pids.lokid?'running':offlineMessage)
  checklist.socket = haveSocket ? ('running in ' + config.launcher.var_path) : offlineMessage

  var pids = getPids(config) // need to get the config
  var need = {
  }
  function checkDone(task) {
    //console.log('checking done', task, need)
    need[task] = true
    for(var i in need) {
      if (need[i] === false) return
    }
    // all tasks complete
    cb(running, checklist)
  }

  if (pids.runningConfig && pids.runningConfig.blockchain) {
    need.blockchain_rpc = false
    lokinet.portIsFree(pids.runningConfig.blockchain.rpc_ip, pids.runningConfig.blockchain.rpc_port, function(portFree) {
      //console.log('rpc:', pids.runningConfig.blockchain.rpc_ip + ':' + pids.runningConfig.blockchain.rpc_port, 'status', portFree?'not running':'running')
      //console.log('')
      checklist.blockchain_rpc = portFree ? offlineMessage :('running on ' + pids.runningConfig.blockchain.rpc_ip + ':' + pids.runningConfig.blockchain.rpc_port)
      checkDone('blockchain_rpc')
    })
  }
  if (config.network.enabled) {
    // if lokinet rpc is enabled...
    //need.network_rpc = true
    // checkDone('network_rpc')
  }
  checkDone('')
}

function stopLauncher(config) {
  // locate launcher pid
  var pids = getPids(config)
  // request launcher shutdown...
}

module.exports = {
  getLogo: getLogo,
  //  args: args,
  //  stripArg: stripArg,
  clearStartupLock: clearStartupLock,
  areWeRunning: areWeRunning,
  setStartupLock: setStartupLock,

  isPidRunning: isPidRunning,
  getPids: getPids,
  savePids: savePids,
  clearPids: clearPids,

  falsish: falsish,
  getProcessState: getProcessState,
  getLauncherStatus: getLauncherStatus,
}
