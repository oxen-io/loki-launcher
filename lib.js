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
  fs.writeFileSync('pids.json', JSON.stringify(obj))
}

function getPids() {
  if (!fs.existsSync('pids.json')) {
    return {}
  }
  // we are already running
  var json = fs.readFileSync('pids.json', 'utf8')
  var obj = {}
  try {
    obj = JSON.parse(json)
  } catch (e) {
    console.error("Can't parse JSON from launcher.pids", json)
  }
  return obj
}

function getProcessState() {
  // what happens if we get different options than what we had before
  // maybe prompt to confirm restart
  // if already running just connect for now
  var pids = getPids()
  var running = {}
  if (pids.lokid && lib.isPidRunning(pids.lokid)) {
    console.log("LAUNCHER: old lokid is still running", pids.lokid)
    running.lokid = pids.lokid
  }
  if (config.network.enabled) {
    if (pids.lokinet && lib.isPidRunning(pids.lokinet)) {
      console.log("LAUNCHER: old lokinet is still running", pids.lokinet)
      running.lokinet = pids.lokinet
    }
  }
  if (config.storage.enabled) {
    if (pids.storageServer && lib.isPidRunning(pids.storageServer)) {
      console.log("LAUNCHER: old storage server is still running", pids.storageServer)
      running.storageServer = pids.storageServer
    }
  }
  return running
}

module.exports = {
  getLogo: getLogo,
  //  args: args,
  //  stripArg: stripArg,
  isPidRunning: isPidRunning,
  getPids: getPids,
  savePids: savePids,
  falsish: falsish,
  getProcessState: getProcessState,
}
