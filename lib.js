// no npm!
const fs  = require('fs')
const cp  = require('child_process')
const net = require('net')
const execSync = cp.execSync
const spawnSync = cp.spawnSync

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
  if (val.toLowerCase() === 'off') return true
  return false
}

function pidUser(pid) {
  const ps = spawnSync('ps', ['-fp', pid])
  if (ps.status != '0') {
    // can't find pid
    //console.warn('ps and kill -0 disagree. ps.status:', ps.status, 'expected 0', ps.stdout.toString(), ps.stderr.toString())
    // usually a race, and has already quit...
    return 'unknown'
  }
  const lines = ps.output.toString().split(/\n/)
  if (lines.length != 3) {
    console.log('pidUser ps lines', lines.length, 'not 2')
    return 'unknown'
  }
  lines.shift() // bye bye first line
  const lastLines = lines[0].split(/\W+/)
  const user = lastLines[0]
  return user
}

function isPidRunning(pid) {
  if (pid === undefined) {
    console.trace('isPidRunning was passed undefined, reporting not running')
    return false
  }
  try {
    // trim any trailing whitespace (using echo > to create does this)
    if (pid.trim) pid = pid.trim()
    //console.log(`checking [${pid}]`)
    process.kill(pid, 0)
    // node 10.16.0 ignores kill 0 (maybe only in lxc but it does)
    // so we're try a SIGHUP
    // can't use SIGHUP lokid dies..
    //process.kill(pid, 'SIGHUP')
    const ps = spawnSync('ps', ['-p', pid])
    //console.log('output', ps.output.toString())
    //console.log('status', ps.status)
    if (ps.status != '0') {
      // can't find pid
      //console.warn('ps and kill -0 disagree. ps.status:', ps.status, 'expected 0', ps.stdout.toString(), ps.stderr.toString())
      // usually a race, and has already quit...
      return false
    }
    //console.log('able to kill', pid)
    return true
  } catch (e) {
    //console.log(pid, 'isRunning', e.code)
    if (e.code === undefined) {
      console.error('ps err', e)
    }
    if (e.code == 'ERR_INVALID_ARG_TYPE') {
      // means pid was undefined
      return false
    }
    if (e.code == 'ESRCH') {
      // not running
      return false
    }
    if (e.code == 'EPERM') {
      // we're don't have enough permissions to signal this process
      return true
    }
    console.log(pid, 'isRunning', e.code, e.message)
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

const TO_MB = 1024 * 1024

function areWeRunning(config) {
  var pid = 0 // default is not running
  if (fs.existsSync(config.launcher.var_path + '/launcher.pid')) {
    // we are already running
    // can be deleted between these two points...
    try {
      pid = fs.readFileSync(config.launcher.var_path + '/launcher.pid', 'utf8')
      // trim any trailing whitespace (using echo > to create does this)
      if (pid.trim) pid = pid.trim()
    } catch(e) {
      return 0
    }
    //console.log('pid is', pid)
    if (pid && isPidRunning(pid)) {
      // pid is correct, syslog could take this spot, verify the name
      //console.log('our process name', process.title)
      try {
        var stdout = execSync('ps -p ' + pid + ' -ww -o pid,ppid,uid,gid,args', {
          maxBuffer: 2 * TO_MB,
          windowsHide: true
        })
      } catch(e) {
        console.log('Can not check process name')
        return 0
      }
      //console.log('stdout', typeof(stdout), stdout)
      var lines = stdout.toString().split(/\n/)
      var labels = lines.shift().trim().split(/( |\t)+/)
      //console.log(0, labels)
      // 0PID, 2PPID, 4UID, 6GID, 8ARGS
      var verifiedPid = false
      var foundPid = false
      for(var i in lines) {
        var tLine = lines[i].trim().split(/( |\t)+/)
        //console.log(i, tLine)
        var firsts = tLine.splice(0, 8)
        var thisPid = firsts[0]
        var cmd = tLine.join(' ')
        if (thisPid == pid) {
          foundPid = true
          // /usr/local/bin/node   /Users/admin/Sites/loki-daemon-launcher/index.js ...
          //console.log(thisPid, 'cmd', cmd)
          if (cmd.match(/node/) || cmd.match(/index\.js/) || cmd.match(/loki-launcher/)) {
            verifiedPid = true
          }
        }
      }
      // detect incorrectly parsed ps
      if (!foundPid) {
        console.warn('Could not read your process-list to determine if pid', pid, 'is really launcher or not', stdout)
      } else
      if (!verifiedPid) {
        // what's worse?
        // 1. running a 2nd copy of launcher
        // 2. or not starting at all...
        // how would one clean up this mess?
        // check the socket...
        // well clear the pid file
        // is it just the launcher running?
        console.warn('Could not verify that pid', pid, 'is actually the launcher by process title')
        var pids = getPids(config)
        var blockchainIsRunning = pids.lokid && isPidRunning(pids.lokid)
        var networkIsRunning = config.network.enabled && pids.lokinet && isPidRunning(pids.lokinet)
        var storageIsRunning = config.storage.enabled && pids.storageServer && isPidRunning(pids.storageServer)
        if (!blockchainIsRunning && !networkIsRunning && !storageIsRunning) {
          console.log('Subprocess are not found, will request fresh start')
          //clearStartupLock(config)
          pid = 0
        }
      }
    } else {
      // so many calls
      // do we need to say this everytime?
      console.log('stale ' + config.launcher.var_path + '/launcher.pid, removing...')
      // should we nuke this proven incorrect file? yes
      fs.unlinkSync(config.launcher.var_path + '/launcher.pid')
      // FIXME: maybe have a lastrun file for debugging
      pid = 0
    }
  }
  return pid
}

function setStartupLock(config) {
  //console.log('SETTING STARTUP LOCK')
  fs.writeFileSync(config.launcher.var_path + '/launcher.pid', process.pid)
}

function clearPids(config) {
  //console.log('CLEARING STARTUP LOCK')
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
    obj.blockchain_startTime = loki_daemon.startTime
    obj.blockchain_spawn_file = loki_daemon.spawnfile
    obj.blockchain_spawn_args = loki_daemon.spawnargs
  }
  if (storageServer && !storageServer.killed && storageServer.pid) {
    obj.storageServer = storageServer.pid
    obj.storage_startTime = storageServer.startTime
    obj.storage_spawn_file = storageServer.spawnfile
    obj.storage_spawn_args = storageServer.spawnargs
    obj.storage_blockchain_failures = storageServer.blockchainFailures
  }
  var lokinetPID = lokinet.getPID()
  if (lokinetPID) {
    var lokinet_daemon = lokinet.getLokinetDaemonObj()
    obj.lokinet = lokinetPID
    obj.network_startTime = lokinet_daemon.startTime
    obj.network_spawn_file = lokinet_daemon.spawnfile
    obj.network_spawn_args = lokinet_daemon.spawnargs
    obj.network_blockchain_failures = lokinet_daemon.blockchainFailures
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
  //console.log('getProcessState pids', pids)
  if (pids.lokid && isPidRunning(pids.lokid)) {
    //console.log("LAUNCHER: old lokid is still running", pids.lokid)
    running.lokid = pids.lokid
  }
  // console.log('network', config.network.enabled, 'lokinet', pids.lokinet)
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

// won't take longer than 5s
// offlineMessage is waiting... or offline
function getLauncherStatus(config, lokinet, offlineMessage, cb) {
  var checklist = {}
  var running = getProcessState(config)
  //console.log('getLauncherStatus running', running)
  // pid...
  checklist.launcher = running.launcher ? ('running as ' + running.launcher) : offlineMessage
  checklist.blockchain = running.lokid ? ('running as ' + running.lokid) : offlineMessage

  var pids = getPids(config) // need to get the active config
  // if not running, just use our current config
  if (!pids.runningConfig) {
    pids.runningConfig = config
  }
  var need = {
  }
  function checkDone(task) {
    //console.log('checking done', task, need)
    need[task] = true
    for(var i in need) {
      // if still need something
      if (need[i] === false) return
    }
    // all tasks complete
    cb(running, checklist)
  }

  if (pids.runningConfig.network.enabled || pids.runningConfig.storage.enabled) {
    if (running.lokid) {
      //console.log('lokid_key', config.storage.lokid_key)
      checklist.lokiKey = fs.existsSync(pids.runningConfig.blockchain.lokid_key) ? ('found at ' + pids.runningConfig.blockchain.lokid_key) : offlineMessage
      //checklist.lokiEdKey = fs.existsSync(pids.runningConfig.blockchain.lokid_edkey) ? ('found at ' + pids.runningConfig.blockchain.lokid_edkey) : offlineMessage
    }
  }

  if (pids.runningConfig.network.enabled) {
    checklist.network = running.lokinet ? ('running as ' + running.lokinet) : offlineMessage
    // lokinet rpc check?
  }
  if (pids.runningConfig.storage.enabled) {
    checklist.storageServer = running.storageServer ? ('running as ' + running.storageServer) : offlineMessage
  }

  // socket...
  let socketExists = fs.existsSync(pids.runningConfig.launcher.var_path + '/launcher.socket')
  if (running.lokid) {
    need.blockchain_rpc = false
    checklist.blockchain_rpc = 'Checking...'
    var url = 'http://' + pids.runningConfig.blockchain.rpc_ip + ':' + pids.runningConfig.blockchain.rpc_port + '/json_rpc'
    //console.log('Lokid is running, checking to make sure it\'s responding')
    //console.log('blockchain', config.blockchain)
    var responded = false
    var blockchain_rpc_timer = setTimeout(function() {
      if (responded) return
      responded = true
      ref.abort()
      checklist.blockchain_rpc = offlineMessage
      checkDone('blockchain_rpc')
    }, 5000)
    var ref = lokinet.httpGet(url, function(data) {
      if (responded) return
      responded = true
      clearTimeout(blockchain_rpc_timer)
      if (data === undefined) {
        checklist.blockchain_rpc = offlineMessage
      } else {
        checklist.blockchain_rpc = 'running on ' + pids.runningConfig.blockchain.rpc_ip + ':' + pids.runningConfig.blockchain.rpc_port
      }
      checkDone('blockchain_rpc')
    })
  }
  /*
  if (pids.runningConfig && pids.runningConfig.blockchain) {
    need.blockchain_rpc = false
    lokinet.portIsFree(pids.runningConfig.blockchain.rpc_ip, pids.runningConfig.blockchain.rpc_port, function(portFree) {
      //console.log('rpc:', pids.runningConfig.blockchain.rpc_ip + ':' + pids.runningConfig.blockchain.rpc_port, 'status', portFree?'not running':'running')
      //console.log('')
      checklist.blockchain_rpc = portFree ? offlineMessage :('running on ' + pids.runningConfig.blockchain.rpc_ip + ':' + pids.runningConfig.blockchain.rpc_port)
      checkDone('blockchain_rpc')
    })
  }
  */

  if (pids.runningConfig.storage.enabled && running.storageServer) {
    need.storage_rpc = false
    if (pids.storage_blockchain_failures && pids.storage_blockchain_failures.last_blockchain_test) {
      checklist.storage_last_failure_blockchain_test = new Date(pids.storage_blockchain_failures.last_blockchain_test)+''
    }
    if (pids.storage_blockchain_failures && pids.storage_blockchain_failures.last_blockchain_ping) {
      checklist.storage_last_failure_blockchain_ping = new Date(pids.storage_blockchain_failures.last_blockchain_ping)+''
    }
    if (pids.storage_blockchain_failures && pids.storage_blockchain_failures.last_blockchain_tick) {
      checklist.storage_last_failure_blockchain_tick = new Date(pids.storage_blockchain_failures.last_blockchain_tick)+''
    }
    checklist.storage_rpc = 'Checking...'
    function runTest() {
      var url = 'https://' + pids.runningConfig.storage.ip + ':' + pids.runningConfig.storage.port + '/get_stats/v1'
      //console.log('Storage server is running, checking to make sure it\'s responding')
      //console.log('storage', config.storage)
      //console.log('asking', url)
      var oldTLSValue = process.env["NODE_TLS_REJECT_UNAUTHORIZED"]
      process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0 // turn it off for now
      var responded = false
      var storage_rpc_timer = setTimeout(function() {
        if (responded) return
        responded = true
        ref.abort()
        checklist.storage_rpc = offlineMessage
        checkDone('storage_rpc')
      }, 5000)
      var ref = lokinet.httpGet(url, function(data) {
        process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = oldTLSValue
        if (responded) return
        responded = true
        clearTimeout(storage_rpc_timer)
        if (data === undefined) {
          checklist.storage_rpc = offlineMessage
        } else {
          //console.log('data', data)
          checklist.storage_rpc = 'running on ' + pids.runningConfig.storage.ip + ':' + pids.runningConfig.storage.port
        }
        checkDone('storage_rpc')
      })
    }
    if (pids.runningConfig.storage.ip === undefined) {
      // well can't use 0.0.0.0
      // don't lokinet running to use the lokinet interface
      // just need a list of interfaces...
      if (pids.runningConfig.launcher.publicIPv4) {
        pids.runningConfig.storage.ip = pids.runningConfig.launcher.publicIPv4
        return runTest()
      }
      lokinet.checkConfig() // set up test config for getNetworkIP
      lokinet.getNetworkIP(function(err, localIP) {
        if (err) console.error('lib::getLauncherStatus - lokinet.getNetworkIP', err)
        pids.runningConfig.storage.ip = localIP
        runTest()
      })
    } else {
      runTest()
    }
  }

  if (socketExists) {
    need.socketWorks = false
    let socketClientTest = net.connect({ path: pids.runningConfig.launcher.var_path + '/launcher.socket' }, function () {
      // successfully connected, then it's in use...
      checklist.socketWorks = 'running at ' + pids.runningConfig.launcher.var_path
      socketClientTest.end()
      socketClientTest.destroy()
      checkDone('socketWorks')
    }).on('error', function (e) {
      if (e.code === 'ECONNREFUSED') {
        console.log('SOCKET: socket is stale, nuking')
        fs.unlinkSync(pids.runningConfig.launcher.var_path + '/launcher.socket')
      }
      checklist.socketWorks = offlineMessage
      checkDone('socketWorks')
    })
  }
  // don't want to say everything is stopped but this is running if it's stale
  //checklist.push('socket', pids.lokid?'running':offlineMessage)


  if (pids.runningConfig.network.enabled) {
    if (pids.network_blockchain_failures && pids.network_blockchain_failures.last_blockchain_ping) {
      checklist.network_last_failure_blockchain_ping = new Date(pids.network_blockchain_failures.last_blockchain_ping)+''
    }
    if (pids.network_blockchain_failures && pids.network_blockchain_failures.last_blockchain_identity) {
      checklist.network_last_failure_blockchain_test = new Date(pids.network_blockchain_failures.last_blockchain_identity)+''
    }
    if (pids.network_blockchain_failures && pids.network_blockchain_failures.last_blockchain_snode) {
      checklist.network_last_failure_blockchain_snode = new Date(pids.network_blockchain_failures.last_blockchain_snode)+''
    }

    // if lokinet rpc is enabled...
    //need.network_rpc = true
    // checkDone('network_rpc')
  }
  checkDone('')
}

// only stop lokid, which should stop any launcher
// FIXME: put into stopLauncher
function stopLokid(config) {
  var running = getProcessState(config)
  if (running.lokid) {
    var pids = getPids(config)
    console.log('blockchain is running, requesting shutdown')
    process.kill(pids.lokid, 15)
    return 1
  }
  return 0
}

function stopLauncher(config) {
  // locate launcher pid
  var pid = areWeRunning(config)
  // FIXME: add try/catch in case of EPERM
  // request launcher shutdown...
  var count = 0
  if (pid) {
    // request launcher stop
    console.log('requesting launcher('+pid+') to stop')
    console.warn('we may hang if launcher was set up with systemd, and you will need to')
    console.warn('"systemctl stop lokid.service" before running this')
    count++
    // hrm 15 doesn't always kill it... (lxc308)
    process.kill(pid, 'SIGTERM') // 15
    // we quit too fast
    //require(__dirname + '/client')(config)
  } else {
    var running = getProcessState(config)
    var pids = getPids(config)
    count += stopLokid(config)
    if (config.storage.enabled && running.storageServer) {
      console.log('storage is running, requesting shutdown')
      process.kill(pids.storageServer, 'SIGTERM') // 15
      count++
    }
    if (config.network.enabled && running.lokinet) {
      console.log('network is running, requesting shutdown')
      process.kill(pids.lokinet, 'SIGTERM') // 15
      count++
    }
  }
  return count
}

function waitForLauncherStop(config, cb) {
  var running = getProcessState(config)
  if (running.lokid || running.lokinet || running.storageServer) {
    var wait = 500
    if (running.lokid) wait += 4500
    setTimeout(function() {
      waitForLauncherStop(config, cb)
    }, wait)
    return
  }
  cb()
}

// from https://github.com/yibn2008/find-process/blob/master/lib/find_pid.js (MIT)
const UNIT_MB = 1024 * 1024
const utils = {
  /**
   * exec command with maxBuffer size
   */
  exec (cmd, callback) {
    cp.exec(cmd, {
      maxBuffer: 2 * UNIT_MB,
      windowsHide: true
    }, callback)
  },
  /**
   * spawn command
   */
  spawn (cmd, args, options) {
    return cp.spawn(cmd, args, options)
  },
  /**
   * Strip top lines of text
   *
   * @param  {String} text
   * @param  {Number} num
   * @return {String}
   */
  stripLine (text, num) {
    let idx = 0

    while (num-- > 0) {
      let nIdx = text.indexOf('\n', idx)
      if (nIdx >= 0) {
        idx = nIdx + 1
      }
    }

    return idx > 0 ? text.substring(idx) : text
  },

  /**
   * Split string and stop at max parts
   *
   * @param  {Number} line
   * @param  {Number} max
   * @return {Array}
   */
  split (line, max) {
    let cols = line.trim().split(/\s+/)

    if (cols.length > max) {
      cols[max - 1] = cols.slice(max - 1).join(' ')
    }

    return cols
  },

  /**
   * Extract columns from table text
   *
   * Example:
   *
   * ```
   * extractColumns(text, [0, 2], 3)
   * ```
   *
   * From:
   * ```
   * foo       bar        bar2
   * valx      valy       valz
   * ```
   *
   * To:
   * ```
   * [ ['foo', 'bar2'], ['valx', 'valz'] ]
   * ```
   *
   * @param  {String} text  raw table text
   * @param  {Array} idxes  the column index list to extract
   * @param  {Number} max   max column number of table
   * @return {Array}
   */
  extractColumns (text, idxes, max) {
    let lines = text.split(/(\r\n|\n|\r)/)
    let columns = []

    if (!max) {
      max = Math.max.apply(null, idxes) + 1
    }

    lines.forEach(line => {
      let cols = utils.split(line, max)
      let column = []

      idxes.forEach(idx => {
        column.push(cols[idx] || '')
      })

      columns.push(column)
    })

    return columns
  },

  /**
   * parse table text to array
   *
   * From:
   * ```
   * Header1   Header2    Header3
   * foo       bar        bar2
   * valx      valy       valz
   * ```
   *
   * To:
   * ```
   * [{ Header1: 'foo', Header2: 'bar', Header3: 'bar2' }, ...]
   * ```
   *
   * @param  {String} data raw table data
   * @return {Array}
   */
  parseTable (data) {
    let lines = data.split(/(\r\n|\n|\r)/).filter(line => {
      return line.trim().length > 0
    })

    let matches = lines.shift().trim().match(/(\w+\s*)/g)
    if (!matches) {
      return []
    }
    let ranges = []
    let headers = matches.map((col, i) => {
      let range = []

      if (i === 0) {
        range[0] = 0
        range[1] = col.length
      } else {
        range[0] = ranges[i - 1][1]
        range[1] = range[0] + col.length
      }

      ranges.push(range)

      return col.trim()
    })
    ranges[ranges.length - 1][1] = Infinity

    return lines.map(line => {
      let row = {}
      ranges.forEach((r, i) => {
        let key = headers[i]
        let value = line.substring(r[0], r[1]).trim()

        row[key] = value
      })

      return row
    })
  }
}

const finders = {
  darwin (port) {
    return new Promise((resolve, reject) => {
      utils.exec('netstat -anv -p TCP && netstat -anv -p UDP', function (err, stdout, stderr) {
        if (err) {
          reject(err)
        } else {
          err = stderr.toString().trim()
          if (err) {
            reject(err)
            return
          }

          // replace header
          let data = utils.stripLine(stdout.toString(), 2)
          let found = utils.extractColumns(data, [0, 3, 8], 10)
            .filter(row => {
              return !!String(row[0]).match(/^(udp|tcp)/)
            })
            .find(row => {
              let matches = String(row[1]).match(/\.(\d+)$/)
              if (matches && matches[1] === String(port)) {
                return true
              }
            })

          if (found && found[2].length) {
            resolve(parseInt(found[2], 10))
          } else {
            reject(new Error(`pid of port (${port}) not found`))
          }
        }
      })
    })
  },
  freebsd: 'darwin',
  sunos: 'darwin',
  linux (port) {
    return new Promise((resolve, reject) => {
      let cmd = 'netstat -tunlp'

      utils.exec(cmd, function (err, stdout, stderr) {
        if (err) {
          reject(err)
        } else {
          const warn = stderr.toString().trim()
          if (warn) {
            // netstat -p ouputs warning if user is no-root
            console.warn(warn)
          }

          // replace header
          let data = utils.stripLine(stdout.toString(), 2)
          let columns = utils.extractColumns(data, [3, 6], 7).find(column => {
            let matches = String(column[0]).match(/:(\d+)$/)
            if (matches && matches[1] === String(port)) {
              return true
            }
          })

          if (columns && columns[1]) {
            let pid = columns[1].split('/', 1)[0]

            if (pid.length) {
              resolve(parseInt(pid, 10))
            } else {
              reject(new Error(`pid of port (${port}) not found`))
            }
          } else {
            reject(new Error(`pid of port (${port}) not found`))
          }
        }
      })
    })
  },
  win32 (port) {
    return new Promise((resolve, reject) => {
      utils.exec('netstat -ano', function (err, stdout, stderr) {
        if (err) {
          reject(err)
        } else {
          err = stderr.toString().trim()
          if (err) {
            reject(err)
            return
          }

          // replace header
          let data = utils.stripLine(stdout.toString(), 4)
          let columns = utils.extractColumns(data, [1, 4], 5).find(column => {
            let matches = String(column[0]).match(/:(\d+)$/)
            if (matches && matches[1] === String(port)) {
              return true
            }
          })

          if (columns && columns[1].length && parseInt(columns[1], 10) > 0) {
            resolve(parseInt(columns[1], 10))
          } else {
            reject(new Error(`pid of port (${port}) not found`))
          }
        }
      })
    })
  },
}

function findPidByPort(port) {
  let platform = process.platform

  return new Promise((resolve, reject) => {
    if (!(platform in finders)) {
      return reject(new Error(`platform ${platform} is unsupported`))
    }

    let findPid = finders[platform]
    if (typeof findPid === 'string') {
      findPid = finders[findPid]
    }

    findPid(port).then(resolve, reject)
  })
}

module.exports = {
  getLogo: getLogo,
  //  args: args,
  //  stripArg: stripArg,
  clearStartupLock: clearStartupLock,
  areWeRunning: areWeRunning,
  setStartupLock: setStartupLock,

  isPidRunning: isPidRunning,
  pidUser: pidUser,
  getPids: getPids,
  savePids: savePids,
  clearPids: clearPids,
  findPidByPort: findPidByPort,

  falsish: falsish,
  getProcessState: getProcessState,
  getLauncherStatus: getLauncherStatus,

  stopLauncher: stopLauncher,
  waitForLauncherStop: waitForLauncherStop,
}
