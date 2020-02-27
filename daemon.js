// no npm!
const fs = require('fs')
//const os = require('os')
const net = require('net')
const dns = require('dns')
const path = require('path')
const lib = require(__dirname + '/lib')
const lokinet = require(__dirname + '/lokinet')
const configUtil = require(__dirname + '/config')
const networkTest = require(__dirname + '/lib.networkTest')
const { spawn } = require('child_process')
const stdin = process.openStdin()

//const longjohn = require('longjohn')

const VERSION = 0.2
//console.log('loki daemon library version', VERSION, 'registered')

let g_config = null
process.on('uncaughtException', function (err) {
  console.trace('Caught exception:', err)
  let var_path = ''
  if (g_config) var_path = g_config.launcher.var_path
  fs.appendFileSync(var_path + '/launcher_exception.log', JSON.stringify({
    err: err,
    code: err.code,
    msg: err.message,
    trace: err.stack.split("\n")
  }) + "\n")
  // if we're in cimode, throw up red flag
  if (savePidConfig.config && savePidConfig.config.launcher.cimode) {
    process.exit(1)
  }
})

let connections = []
function disconnectAllClients() {
  console.log('SOCKET: Disconnecting all', connections.length, 'clients.')
  for(let i in connections) {
    const conn = connections[i]
    if (!conn.destroyed) {
      //console.log('disconnecting client #'+i)
      conn.destroy()
    }
  }
  connections = [] // clear them
}

// lower permissions and run cb
// don't use this for lokinet on MacOS
function lowerPermissions(user, cb) {
  process.setuid(user)
}

function shutdown_storage() {
  if (storageServer && !storageServer.killed) {
    // FIXME: was killed not set?
    try {
      // if this pid isn't running we crash
      if (lib.isPidRunning(storageServer.pid)) {
        console.log('LAUNCHER: Requesting storageServer be shutdown.', storageServer.pid)
        process.kill(storageServer.pid, 'SIGINT')
      } else {
        console.log('LAUNCHER: ', storageServer.pid, 'is not running')
      }
    } catch(e) {
    }
    // mark that we've tried
    storageServer.killed = true
    // can't null it if we're using killed property
    //storageServer = null
  }
}

let shuttingDown = false
let shutDownTimer = null
let lokinetPidwatcher = false
function shutdown_everything() {
  //console.log('shutdown_everything()!')
  //console.trace('shutdown_everything()!')
  if (lokinetPidwatcher !== false) {
    clearInterval(lokinetPidwatcher)
    lokinetPidwatcher = false
  }
  shuttingDown = true
  stdin.pause()
  shutdown_storage()
  // even if not running, yet, stop any attempts at starting it too
  lokinet.stop()
  if (loki_daemon && !loki_daemon.killed) {
    console.log('LAUNCHER: Requesting lokid be shutdown.', loki_daemon.pid)
    try {
      process.kill(loki_daemon.pid, 'SIGINT')
    } catch(e) {
    }
    loki_daemon.killed = true
  }
  // clear our start up lock (if needed, will crash if not there)
  lib.clearStartupLock(module.exports.config)
  // FIXME: should we be savings pids as we shutdown? probably

  // only set this timer once... (and we'll shut ourselves down)
  if (shutDownTimer === null) {
    shutDownTimer = setInterval(function () {
      let stop = true
      if (storageServer && storageServer.pid && lib.isPidRunning(storageServer.pid)) {
        console.log('LAUNCHER: Storage server still running.')
        stop = false
      }
      if (loki_daemon) {
        if (loki_daemon.outputFlushTimer) {
          clearInterval(loki_daemon.outputFlushTimer)
          loki_daemon.outputFlushTimer = null
        }
      }
      if (loki_daemon && loki_daemon.pid && lib.isPidRunning(loki_daemon.pid)) {
        console.log('LAUNCHER: lokid still running.')
        // lokid on macos may need a kill -9 after a couple failed 15
        // lets say 50s of not stopping -15 then wait 30s if still run -9
        stop = false
      } else {
        if (server) {
          console.log('SOCKET: Closing socket server.')
          disconnectAllClients()
          server.close()
          server.unref()
          if (fs.existsSync(module.exports.config.launcher.var_path + '/launcher.socket')) {
            console.log('SOCKET: Cleaning socket.')
            fs.unlinkSync(module.exports.config.launcher.var_path + '/launcher.socket')
          }
          server = false
        }
      }
      let lokinetState = lokinet.isRunning()
      if (lokinetState && lokinetState.pid && lib.isPidRunning(lokinetState.pid)) {
        console.log('LAUNCHER: lokinet still running.')
        stop = false
      }
      if (stop) {
        console.log('All daemons down.')
        // deallocate
        // can't null these yet because lokid.onExit
        // race between the pid dying and registering of the exit
        storageServer = null
        loki_daemon = null
        lokinetState = null
        lib.clearPids(module.exports.config)
        /*
        if (fs.existsSync(config.launcher.var_path + '/pids.json')) {
          console.log('LAUNCHER: clearing pids.json')
          fs.unlinkSync(config.launcher.var_path + '/pids.json')
        } else {
          console.log('LAUNCHER: NO pids.json found, can\'t clear')
        }
        */
        clearInterval(shutDownTimer)
        // docker/node 10 on linux has issue with this
        // 10.15 on macos has a handle, probably best to release
        if (stdin.unref) {
          //console.log('unref stdin')
          stdin.unref()
        }
        // if lokinet wasn't started yet, due to slow net/dns stuff
        // then it'll take a long time for a timeout to happen
        // 2 writes, 1 read
        /*
        var handles = process._getActiveHandles()
        console.log('handles', handles.length)
        for(var i in handles) {
          var handle = handles[i]
          console.log(i, 'type', handle._type)
        }
        console.log('requests', process._getActiveRequests().length)
        */
      }
    }, 5000)
  }

  // don't think we need, seems to handle itself
  //console.log('should exit?')
  //process.exit()
}

let storageServer
var storageLogging = true
function launcherStorageServer(config, args, cb) {
  if (shuttingDown) {
    //if (cb) cb()
    console.log('STORAGE: Not going to start storageServer, shutting down.')
    return
  }
  // no longer true
  /*
  if (!config.storage.lokid_key) {
    console.error('storageServer requires lokid_key to be configured.')
    if (cb) cb(false)
    return
  }
  */
  // set storage port default
  if (!config.storage.port) {
    config.storage.port = 8080
  }
  // configure command line parameters
  let optionals = []
  if (config.storage.testnet) {
    optionals.push('--testnet')
  }
  // this was required
  if (config.storage.lokid_key) {
    optionals.push('--lokid-key', config.storage.lokid_key)
  }
  if (config.storage.log_level) {
    optionals.push('--log-level', config.storage.log_level)
  }
  if (config.storage.data_dir) {
    optionals.push('--data-dir', config.storage.data_dir)
  }
  if (config.storage.lokid_rpc_port) {
    optionals.push('--lokid-rpc-port', config.storage.lokid_rpc_port)
  }
  if (config.storage.force_start) {
    optionals.push('--force-start')
  }
  console.log('STORAGE: Launching', config.storage.binary_path, [config.storage.ip, config.storage.port, ...optionals].join(' '))
  // ip and port must be first
  storageServer = spawn(config.storage.binary_path, [config.storage.ip, config.storage.port, ...optionals])
  // , { stdio: 'inherit' })

  //console.log('storageServer', storageServer)
  if (!storageServer.stdout) {
    console.error('storageServer failed?')
    if (cb) cb(false)
    return
  }
  storageServer.killed = false
  storageServer.startTime = Date.now()
  storageServer.blockchainFailures = {}
  lib.savePids(config, args, loki_daemon, lokinet, storageServer)

  // copy the output to stdout
  let storageServer_version = 'unknown'
  let stdout = '', stderr = '', collectData = true
  storageServer.stdout
    .on('data', (data) => {
      var str = data.toString('utf8').trim()
      if (storageLogging) console.log(`STORAGE: ${str}`)
      if (collectData) {
        const lines = str.split(/\n/)
        for(let i in lines) {
          const tline = lines[i].trim()
          if (tline.match('Loki Storage Server v')) {
            const parts = tline.split('Loki Storage Server v')
            storageServer_version = parts[1]
          }
          if (tline.match('git commit hash: ')) {
            const parts = tline.split('git commit hash: ')
            fs.writeFileSync(config.launcher.var_path + '/storageServer.version', storageServer_version+"\n"+parts[1])
          }
        }
        stdout += data
      }
      // blockchain test
      if (str.match(/Could not send blockchain request to Lokid/)) {
        if (storageLogging) console.log(`STORAGE: blockchain test failure`)
        if (!storageServer) {
          console.log('storageServer is unset, yet getting output', str)
          return
        }
        storageServer.blockchainFailures.last_blockchain_test = Date.now()
        //communicate this out
        lib.savePids(config, args, loki_daemon, lokinet, storageServer)
      }
      // blockchain ping
      if (str.match(/Empty body on Lokid ping/) || str.match(/Could not ping Lokid. Status: {}/) ||
          str.match(/Could not ping Lokid: bad json in response/) || str.match(/Could not ping Lokid/)) {
        if (storageLogging) console.log(`STORAGE: blockchain ping failure`)
        if (!storageServer) {
          console.log('storageServer is unset, yet getting output:', str)
          return
        }
        storageServer.blockchainFailures.last_blockchain_ping = Date.now()
        //communicate this out
        lib.savePids(config, args, loki_daemon, lokinet, storageServer)
      }
      // swarm_tick communication error
      if (str.match(/Failed to contact local Lokid/) || str.match(/Exception caught on swarm update/)) {
        if (storageLogging) console.log(`STORAGE: blockchain tick failure`)
        if (!storageServer) {
          console.log('storageServer is unset, yet getting output', str)
          return
        }
        storageServer.blockchainFailures.last_blockchain_tick = Date.now()
        //communicate this out
        lib.savePids(config, args, loki_daemon, lokinet, storageServer)
      }
      // could be testing a remote node
      if (str.match(/Could not report node status: bad json in response/)) {
      } else if (str.match(/Could not report node status/)) {
      }
      if (str.match(/Empty body on Lokid report node status/)) {
      }
      // end remote node
    })
    .on('error', (err) => {
      console.error(`Storage Server stdout error: ${err.toString('utf8').trim()}`)
    })

  storageServer.stderr
    .on('data', (err) => {
      if (storageLogging) console.log(`Storage Server error: ${err.toString('utf8').trim()}`)
    })
    .on('error', (err) => {
      console.error(`Storage Server stderr error: ${err.toString('utf8').trim()}`)
    })


  // don't hold up the exit too much
  let memoryWatcher = setTimeout(function() {
    console.log('Turning off storage server start up watcher.')
    collectData = false
    stdout = ''
    stderr = ''
  }, 10 * 1000)
  function checkStorageServer() {
    lib.getLauncherStatus(config, lokinet, 'offline', function(running, checklist) {
      if (running.storage_rpc === 'offline') {
        console.log('STORAGE: RPC server not responding, restarting storage server')
        shutdown_storage()
      }
    })
  }
  let watchdog = setInterval(checkStorageServer, 60 * 60 * 1000)
  setTimeout(checkStorageServer, 10 * 1000)

  storageServer.on('error', (err) => {
    console.error('STORAGEP_ERR:', JSON.stringify(err))
  })

  storageServer.on('close', (code) => {
    clearTimeout(memoryWatcher)
    clearTimeout(watchdog)
    console.log(`StorageServer process exited with code ${code} after`, (Date.now() - storageServer.startTime)+'ms')
    storageServer.killed = true
    if (code == 1) {
      console.log(stdout, 'stderr', stderr)
      console.log('')
      console.warn('StorageServer bind port could be in use, please check to make sure.', config.binary_path, 'is not already running on port', config.port)
      // we could want to issue one kill just to make sure
      // however since we don't know the pid, we won't know if it's ours
      // or meant be running by another copy of the launcher
      // at least any launcher copies will be restarted
      //
      // we could exit, or prevent a restart
      storageServer = null // it's already dead
      shutdown_everything()
    }
    // code null means clean shutdown
    if (!shuttingDown) {
      // wait 30s
      setTimeout(function() {
        console.log('loki_daemon is still running, restarting storageServer.')
        launcherStorageServer(config, args)
      }, 30 * 1000)
    }
  })

  /*
  function flushOutput() {
    if (!storageServer || storageServer.killed) {
      console.log('storageServer flushOutput lost handle, stopping flushing')
      return
    }
    storageServer.stdin.write("\n")
    // schedule next flush
    storageServer.outputFlushTimer = setTimeout(flushOutput, 1000)
  }
  console.log('starting log flusher for storageServer')
  storageServer.outputFlushTimer = setTimeout(flushOutput, 1000)
  */

  if (cb) cb(true)
}

let waitForLokiKeyTimer = null
// as of 6.x storage and network not get their key via rpc call
function waitForLokiKey(config, timeout, start, cb) {
  if (start === undefined) start = Date.now()
  if (config.storage.lokid_key === undefined) {
    if (config.storage.enabled) {
      console.error('Storage lokid_key is not configured')
      process.exit(1)
    }
    cb(true)
    return
  }
  console.log('DAEMON: Checking on', config.storage.lokid_key)
  if (!fs.existsSync(config.storage.lokid_key)) {
    if (timeout && (Date.now - start > timeout)) {
      cb(false)
      return
    }
    waitForLokiKeyTimer = setTimeout(function() {
      waitForLokiKey(config, timeout, start, cb)
    }, 1000)
    return
  }
  waitForLokiKeyTimer = null
  cb(true)
}

// FIXME: make sure blockchain.rpc port is bound before starting...
let rpcUpTimer = null
function startStorageServer(config, args, cb) {
  //console.log('trying to get IP information about lokinet')
  // does this belong here?
  if (config.storage.enabled) {
    if (config.storage.data_dir !== undefined) {
      if (!fs.existsSync(config.storage.data_dir)) {
        lokinet.mkDirByPathSync(config.storage.data_dir)
      }
    }
  }

  function checkRpcUp(cb) {
    if (shuttingDown) {
      //if (cb) cb()
      console.log('STORAGE: Not going to start storageServer, shutting down.')
      return
    }
    lokinet.portIsFree(config.blockchain.rpc_ip, config.blockchain.rpc_port, function(portFree) {
      if (!portFree) {
        cb()
        return
      }
      rpcUpTimer = setTimeout(function() {
        checkRpcUp(cb)
      }, 5 * 1000)
    })
  }

  checkRpcUp(function() {
    config.storage.ip = '0.0.0.0';
    if (config.network.enabled) {
      lib.savePids(config, args, loki_daemon, lokinet, storageServer)
      launcherStorageServer(config, args, cb)
      /*
      lokinet.getLokiNetIP(function (ip) {
        // lokinet has started, save config and various process pid
        lib.savePids(config, args, loki_daemon, lokinet, storageServer)
        if (ip) {
          console.log('DAEMON: Starting storageServer on', ip)
          config.storage.ip = ip
          launcherStorageServer(config, args, cb)
        } else {
          console.error('DAEMON: Sorry cant detect our lokinet IP:', ip)
          if (cb) cb(false)
          //shutdown_everything()
        }
      })
      */
    } else if (config.storage.enabled) {
      /*
      lokinet.getNetworkIP(function(err, localIP) {
        console.log('DAEMON: Starting storageServer on', localIP)
        // we can only ever bind to the local IP
        config.storage.ip = localIP
        launcherStorageServer(config, args, cb)
      })
      */
      launcherStorageServer(config, args, cb)
    } else {
      console.log('StorageServer is not enabled.')
    }
  })
}

function startLokinet(config, args, cb) {
  // we no longer need to wait for LokiKey before starting network/storage
  // waitForLokiKey(config, timeout, start, cb)
  if (configUtil.isBlockchainBinary3X(config) || configUtil.isBlockchainBinary4Xor5X(config)) {
    // 3.x-5.x, we need the key
    if (config.storage.lokid_key === undefined) {
      if (config.storage.enabled) {
        console.error('Storage server enabled but no key location given.')
        process.exit(1)
      }
      if (config.network.enabled) {
        lokinet.startServiceNode(config, function () {
          startStorageServer(config, args, cb)
        })
      } else {
        //console.log('no storage key configured')
        if (cb) cb(true)
      }
      return
    }
    console.log('DAEMON: Waiting for loki key at', config.storage.lokid_key)
    waitForLokiKey(config, 30 * 1000, undefined, function(haveKey) {
      if (!haveKey) {
        console.error('DAEMON: Timeout waiting for loki key.')
        // FIXME: what do?
        return
      }
      console.log('DAEMON: Got Loki key!')
      if (config.network.enabled) {
        lokinet.startServiceNode(config, function () {
          startStorageServer(config, args, cb)
        })
      } else {
        if (config.storage.enabled) {
          startStorageServer(config, args, cb)
        } else {
          if (cb) cb(true)
        }
      }
    })
  } else {
    // 6.x, not key needed
    if (config.network.enabled) {
      lokinet.startServiceNode(config, function () {
        lokinetPidwatcher = setInterval(function() {
          // read pids.json
          var pids = lib.getPids(config)
          var lokinetProc = lokinet.isRunning()
          if (lokinetProc) {
            // console.log('lokinet pid is', lokinetProc.pid, 'json is', pids.lokinet)
            if (lokinetProc.pid != pids.lokinet) {
              console.warn('Lokinet pid got out of sync!')
            }
          } else {
            console.log('no lokinet pid', lokinet)
          }
        }, 30 * 1000)
        startStorageServer(config, args, cb)
      })
    } else {
      if (config.storage.enabled) {
        startStorageServer(config, args, cb)
      } else {
        if (cb) cb(true)
      }
    }
  }
}

function startLauncherDaemon(config, interactive, entryPoint, args, debug, cb) {
  /*
  try {
    process.seteuid('rtharp')
    console.log(`New uid: ${process.geteuid()}`)
  } catch(err) {
    console.log(`Failed to set uid: ${err}`)
  }
  */
  function doStart() {
    function startBackgroundCode() {
      // backgrounded or launched in interactive mode
      // strip any launcher-specific params we shouldn't need any more
      for(var i in args) {
        var arg = args[i]
        if (arg == '--skip-storage-server-port-check') {
          args.splice(i, 1) // remove this option
        } else
        if (arg == '--ignore-storage-server-port-check') {
          args.splice(i, 1) // remove this option
        }
      }
      //console.log('backgrounded or launched in interactive mode')
      g_config = config
      lib.setStartupLock(config)
      cb()
    }

    // see if we need to detach
    //console.log('interactive', interactive)
    if (!interactive) {
      //console.log('fork check', process.env.__daemon)
      if (!process.env.__daemon || config.launcher.cimode) {
        //console.log('cimode', config.launcher.cimode)
        let child
        if (!config.launcher.cimode) {
          // first run
          process.env.__daemon = true
          // spawn as child
          const cp_opt = {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
            cwd: process.cwd(),
            detached: true
          }
          // this doesn't work like this...
          //args.push('1>', 'log.out', '2>', 'err.out')
          console.log('Launching', process.execPath, entryPoint, 'daemon-start', args)
          child = spawn(process.execPath, [entryPoint, 'daemon-start', '--skip-storage-server-port-check'].concat(args), cp_opt)
          //console.log('child', child)
          if (!child) {
            console.error('Could not spawn detached process')
            process.exit(1)
          }
          // won't accumulate cause we're quitting...
          var stdout = '', stderr = ''
          child.stdout.on('data', (data) => {
            //if (debug) console.log(data.toString())
            stdout += data.toString()
          })
          child.stderr.on('data', (data) => {
            //if (debug) console.error(data.toString())
            stderr += data.toString()
          })
          //var launcherHasExited = false
          function crashHandler(code) {
            console.log('Background launcher died with', code, stdout, stderr)
            //launcherHasExited = true
            process.exit(1)
          }
          child.on('close', crashHandler)
        }
        // required so we can exit
        var startTime = Date.now()
        console.log('Waiting on start up confirmation...')
        function areWeRunningYet() {
          var diff = Date.now() - startTime
          // , process.pid
          console.log('Checking start up progress...')
          lib.getLauncherStatus(config, lokinet, 'waiting...', function(running, checklist) {
            var nodeVer = Number(process.version.match(/^v(\d+\.\d+)/)[1])
            if (nodeVer >= 10) {
              console.table(checklist)
            } else {
              console.log(checklist)
            }
            var pids = lib.getPids(config) // need to get the config
            // blockchain rpc is now required for SN

            var blockchainIsFine = pids.runningConfig && pids.runningConfig.blockchain && checklist.blockchain_rpc !== 'waiting...'
            var networkIsFine = (!pids.runningConfig) || (!pids.runningConfig.network) || (!pids.runningConfig.network.enabled) || (checklist.network !== 'waiting...')
            if (running.launcher && running.lokid && checklist.socketWorks !== 'waiting...' &&
                  pids.runningConfig && blockchainIsFine && networkIsFine &&
                  checklist.storageServer !== 'waiting...' && checklist.storage_rpc !== 'waiting...'
                ) {
              console.log('Start up successful!')
              if (child) child.removeListener('close', crashHandler)
              process.exit()
            }
            // if storage is enabled but not running, wait for it
            if (pids.runningConfig && pids.runningConfig.storage.enabled && checklist.storageServer === 'waiting...' && blockchainIsFine && networkIsFine) {
              // give it 30s more if everything else is fine... for what?
              if (diff > 1.5  * 60 * 1000) {
                console.log('Storage server start up timeout, likely failed.')
                process.exit(1)
              }
              setTimeout(areWeRunningYet, 5000)
              return
            }
            if (pids.runningConfig && pids.runningConfig.storage.enabled && checklist.storage_rpc === 'waiting...' && blockchainIsFine && networkIsFine) {
              // give it 15s more if everything else is fine... for it's DH generation
              if (diff > 1.75 * 60 * 1000) {
                console.log('Storage server rpc timeout, likely DH generation is taking long...')
                process.exit(0)
              }
              setTimeout(areWeRunningYet, 5000)
              return
            }
            if (diff > 1   * 60 * 1000) {
              console.log('Start up timeout, likely failed.')
              process.exit(1)
            }
            //if (!launcherHasExited) {
            setTimeout(areWeRunningYet, 5000)
            //}
          })
        }
        setTimeout(areWeRunningYet, 5000)
        if (child) child.unref()
        if (config.launcher.cimode) {
          console.log('continuing foreground startup')
          startBackgroundCode()
        }
        return
      }
      // no one sees these
      //console.log('backgrounded')
    }

    startBackgroundCode()
  }
  function testOpenPorts() {
    // move deterministic behavior than letting the OS decide
    console.log('Starting verification phase')
    console.log('Downloading test servers from testing.lokinet.org')
    dns.resolve4('testing.lokinet.org', function(err, addresses) {
      if (err) console.error('dnsLookup err', err)
      //console.log('addresses', addresses)
      function tryAndConnect() {
        var idx = parseInt(Math.random() * addresses.length)
        var server = addresses[idx]
        /*
        dns.resolvePtr(server, function(err, names) {
          if (err) console.error('dnsPtrLookup err', err)
          if (names.length) console.log('trying to connect to', names[0])
        })
        */
        console.log('Trying to connect to', server)
        addresses.splice(idx, 1) // remove it
        networkTest.createClient(server, 3000, function(client) {
          //console.log('client', client)
          if (debug) console.debug('got createClient cb')
          if (client === false) {
            if (!addresses.length) {
              console.warn('We could not connect to ANY testing server, you may want to check your internet connection and DNS settings')
              /*
              setTimeout(function() {
                testOpenPorts()
              }, 30 * 1000)
              */
              console.log('Verification phase complete')
              doStart()
            } else {
              // retry with a different server
              tryAndConnect()
            }
            return
          }
          // if 6.x+
          if (!configUtil.isBlockchainBinary3X(config) && !configUtil.isBlockchainBinary4Xor5X(config)) {
            console.log('Starting open port check on configured blockchain quorumnet server port:', config.blockchain.qun_port)
            client.startTestingServer(config.blockchain.qun_port, debug, function(results, port) {
              if (debug) console.debug('got startTestingServer qun cb')
              if (results != 'good') {
                if (results == 'inuse') {
                  console.error(config.blockchain.qun_port, 'is already in use, please make sure nothing is using the port before trying again')
                } else  {
                  console.error('WE COULD NOT VERIFY THAT YOU HAVE PORT ' + port +
                    ', OPEN ON YOUR FIREWALL/ROUTER, this is now required to run a service node')
                }
                for(var i in args) {
                  var arg = args[i]
                  if (arg == '--ignore-storage-server-port-check') {
                    client.disconnect()
                    console.log('verification phase complete (ignoring checks)')
                    args.splice(i, 1) // remove this option
                    doStart()
                    return
                  }
                }
                process.exit(1)
              } else {
                console.log('Starting open port check on configured storage server port:', config.storage.port)
                client.startTestingServer(config.storage.port, debug, function(results, port) {
                  if (debug) console.debug('got startTestingServer storage cb')
                  if (results != 'good') {
                    if (results == 'inuse') {
                      console.error(config.storage.port, 'is already in use, please make sure nothing is using the port before trying again')
                    } else  {
                      console.error('WE COULD NOT VERIFY THAT YOU HAVE PORT ' + port +
                        ', OPEN ON YOUR FIREWALL/ROUTER, this is now required to run a service node')
                    }
                    for(var i in args) {
                      var arg = args[i]
                      if (arg == '--ignore-storage-server-port-check') {
                        client.disconnect()
                        console.log('verification phase complete (ignoring checks)')
                        args.splice(i, 1) // remove this option
                        doStart()
                        return
                      }
                    }
                    process.exit(1)
                  } else {
                    if (config.network.enabled) {
                      console.log('Starting open port check on configured network server port:', config.network.public_port)
                      client.startUDPRecvTestingServer(config.network.public_port, debug, function(results, port) {
                        if (results != 'good') {
                          if (results == 'inuse') {
                            console.error(config.storage.port, 'is already in use, please make sure nothing is using the port before trying again')
                          } else  {
                            console.error('WE COULD NOT VERIFY THAT YOU HAVE PORT ' + port +
                              ', OPEN ON YOUR FIREWALL/ROUTER, this is now required to run a service node')
                          }
                          for(var i in args) {
                            var arg = args[i]
                            if (arg == '--ignore-storage-server-port-check') {
                              client.disconnect()
                              console.log('verification phase complete (ignoring checks)')
                              args.splice(i, 1) // remove this option
                              doStart()
                              return
                            }
                          }
                          process.exit(1)
                        } else {
                          console.log('Starting outgoing UDP port check on configured network server from UDP port:', config.network.public_port)
                          client.testUDPSendPort(config.network.public_port, 1090, function(results, port) {
                            if (results != 'good') {
                              if (results == 'inuse') {
                                console.error(config.storage.port, 'is already in use, please make sure nothing is using the port before trying again')
                              } else  {
                                console.error('WE COULD NOT VERIFY THAT YOU HAVE PORT ' + port +
                                  ', OPEN ON YOUR FIREWALL/ROUTER, this is now required to run a service node')
                              }
                              for(var i in args) {
                                var arg = args[i]
                                if (arg == '--ignore-storage-server-port-check') {
                                  client.disconnect()
                                  console.log('verification phase complete (ignoring checks)')
                                  args.splice(i, 1) // remove this option
                                  doStart()
                                  return
                                }
                              }
                              process.exit(1)
                            } else {
                              console.log('verification phase complete.')
                              client.disconnect()
                              doStart()
                            }
                          }) // end testUDPSendPort
                        }
                      }) // end startUDPRecvTestingServer
                    } else {
                      console.log('verification phase complete.')
                      client.disconnect()
                      doStart()
                    }
                  }
                }) // end startTestingServer (storage)
              }
            }) // end startTestingServer (qun)
          } else {
            // 3-5x lokid
            if (config.storage.enabled) {
              console.log('Starting open port check on configured storage server port:', config.storage.port)
              client.startTestingServer(config.storage.port, debug, function(results, port) {
                if (debug) console.debug('got startTestingServer storage cb')
                if (results != 'good') {
                  if (results == 'inuse') {
                    console.error(config.storage.port, 'is already in use, please make sure nothing is using the port before trying again')
                  } else  {
                    console.error('WE COULD NOT VERIFY THAT YOU HAVE PORT ' + port +
                      ', OPEN ON YOUR FIREWALL/ROUTER, this is now required to run a service node')
                  }
                  for(var i in args) {
                    var arg = args[i]
                    if (arg == '--ignore-storage-server-port-check') {
                      client.disconnect()
                      console.log('verification phase complete (ignoring checks)')
                      args.splice(i, 1) // remove this option
                      doStart()
                      return
                    }
                  }
                  process.exit(1)
                } else {
                  console.log('verification phase complete.')
                  client.disconnect()
                  doStart()
                }
              })
            } else {
              console.log('verification phase complete.')
              client.disconnect()
              doStart()
            }
          }
        }) // end createClient
      } // end func tryAndConnect
      tryAndConnect()
    }) // end resolve
  }
  if (config.storage.enabled || config.network.enabled) {
    for(var i in args) {
      var arg = args[i]
      if (arg == '--skip-storage-server-port-check') {
        args.splice(i, 1) // remove this option
        doStart()
        return
      }
    }
    testOpenPorts()
  } else {
    doStart()
  }
}

// compile config into CLI arguments
// only needs to be ran when config changes
function configureLokid(config, args) {
  var lokid_options = ['--service-node']

  // if ip is not localhost, pass it to lokid
  if (config.blockchain.rpc_ip && config.blockchain.rpc_ip != '127.0.0.1') {
    lokid_options.push('--rpc-bind-ip='+config.blockchain.rpc_ip, '--confirm-external-bind')
  }

  if (config.blockchain.rpc_pass) {
    lokid_options.push('--rpc-login='+config.blockchain.rpc_user+':'+config.blockchain.rpc_pass)
  }
  if (!config.launcher.interactive) {
    // we handle the detach, we don't need to detach lokid from us
    // we need this now to keep a console open
    //lokid_options.push('--non-interactive')
    // if we leave this disabled, we won't be able to see startup errors
    // only really good for debugging lokid stuffs
    //lokinet.disableLogging()
  }
  if (config.blockchain.zmq_port) {
    lokid_options.push('--zmq-rpc-bind-port=' + config.blockchain.zmq_port)
  }
  // FIXME: be nice to skip if it was the default...
  // can we turn it off?
  if (config.blockchain.rpc_port) {
    lokid_options.push('--rpc-bind-port=' + config.blockchain.rpc_port)
  }
  if (config.blockchain.p2p_port) {
    lokid_options.push('--p2p-bind-port=' + config.blockchain.p2p_port)
  }
  if (config.blockchain.data_dir) {
    lokid_options.push('--data-dir=' + config.blockchain.data_dir)
  }

  // net selection at the very end because we may need to override a lot of things
  // but not before the dedupe
  if (config.blockchain.network == "test") {
    lokid_options.push('--testnet')
  } else
  if (config.blockchain.network == "demo") {
    lokid_options.push('--testnet')
    lokid_options.push('--add-priority-node=116.203.126.14')
  } else
  if (config.blockchain.network == "staging") {
    lokid_options.push('--stagenet')
  }
  // not 3.x
  if (!configUtil.isBlockchainBinary3X(config)) {
    // 4.x+
    lokid_options.push('--storage-server-port', config.storage.port)
    lokid_options.push('--service-node-public-ip', config.launcher.publicIPv4)
  } else {
    console.log('3.x blockchain block binary detected')
  }
  // 6.x+
  if (!configUtil.isBlockchainBinary3X(config) && !configUtil.isBlockchainBinary4Xor5X(config) && config.blockchain.qun_port) {
    lokid_options.push('--quorumnet-port=' + config.blockchain.qun_port)
  }

  // copy CLI options to lokid
  for (var i in args) {
    // should we prevent --non-interactive?
    // probably not, if they want to run it that way, why not support it?
    // FIXME: we just need to adjust internal config
    var arg = args[i]
    if (arg.match(/=/)) {
      // assignment
      var parts = arg.split(/=/)
      var key = parts.shift()
      for(var j in lokid_options) {
        var option = lokid_options[j] + '' // have to convert to string because number become numbers
        if (option.match && option.match(/=/)) {
          var parts2 = option.split(/=/)
          var option_key = parts2.shift()
          if (option_key == key) {
            console.log('BLOCKCHAIN: Removing previous established option', option)
            lokid_options.splice(j, 1)
          }
        }
      }
    } else {
      for(var j in lokid_options) {
        var option = lokid_options[j]
        if (arg == option) {
          console.log('BLOCKCHAIN: Removing previous established option', option)
          lokid_options.splice(j, 1)
        }
      }
    }
    lokid_options.push(args[i])
  }

  return {
    lokid_options: lokid_options,
  }
}

var loki_daemon
var server
var savePidConfig = {}
function launchLokid(binary_path, lokid_options, interactive, config, args, cb) {
  if (shuttingDown) {
    //if (cb) cb()
    console.log('BLOCKCHAIN: Not going to start lokid, shutting down.')
    return
  }
  // hijack STDIN but not OUT/ERR
  //console.log('launchLokid - interactive?', interactive)
  if (interactive) {
    // don't hijack stdout, so prepare_registration works
    console.log('BLOCKCHAIN: (interactive mode) Launching', binary_path, lokid_options.join(' '))
    loki_daemon = spawn(binary_path, lokid_options, {
      stdio: ['pipe', 'inherit', 'inherit'],
      //shell: true
    })
  } else {
    // allow us to hijack stdout
    console.log('BLOCKCHAIN: Launching', binary_path, lokid_options.join(' '))
    loki_daemon = spawn(binary_path, lokid_options)
  }
  if (!loki_daemon) {
    console.error('BLOCKCHAIN: Failed to start lokid, exiting...')
    shutdown_everything()
    return
  }
  loki_daemon.on('error', (err) => {
    console.error('BLOCKCHAINP_ERR:', JSON.stringify(err))
  })

  loki_daemon.startTime = Date.now()
  savePidConfig = {
    config: config,
    args: args,
  }
  lib.savePids(config, args, loki_daemon, lokinet, storageServer)

  if (!interactive) {
    // why is the banner held back until we connect!?
    loki_daemon.stdout.on('data', (data) => {
      console.log(`blockchainRAW: ${data}`)
      //var parts = data.toString().split(/\n/)
      //parts.pop()
      //stripped = parts.join('\n')
      //console.log(`blockchain: ${stripped}`)
      // seems to be working...
      if (server) {
        // broadcast
        for (var i in connections) {
          var conn = connections[i]
          conn.write(data + "\n")
        }
      }
    })
    loki_daemon.stdout.on('error', (err) => {
      console.error('BLOCKCHAIN1_ERR:', JSON.stringify(err))
    })
    loki_daemon.stderr.on('data', (data) => {
      console.log(`blockchainErrRAW: ${data}`)
      //var parts = data.toString().split(/\n/)
      //parts.pop()
      //stripped = parts.join('\n')
      //console.log(`blockchain: ${stripped}`)
      // seems to be working...
      if (server) {
        // broadcast
        for (var i in connections) {
          var conn = connections[i]
          conn.write("ERR" + data + "\n")
        }
      }
    })
    loki_daemon.stderr.on('error', (err) => {
      console.error('BLOCKCHAIN1_ERR:', JSON.stringify(err))
    })
  }

  loki_daemon.on('close', (code) => {
    console.warn(`BLOCKCHAIN: loki_daemon process exited with code ${code} after`, (Date.now() - loki_daemon.startTime)+'ms')
    // invalid param gives a code 1
    // code 0 means clean shutdown
    if (code === 0) {
      // likely to mean it was requested
      if (config.blockchain.restart) {
        // we're just going to restart
        if (server) {
          // broadcast
          for (var i in connections) {
            var conn = connections[i]
            conn.write("Lokid has been exited but configured to restart. Disconnecting client and we'll be back shortly\n")
          }
        }
        // but lets disconnect any clients
        disconnectAllClients()
      }
    }

    // if we have a handle on who we were...
    if (loki_daemon) {
      loki_daemon.killed = true
      // clean up temporaries
      //killOutputFlushTimer()
      if (loki_daemon.outputFlushTimer) {
        clearTimeout(loki_daemon.outputFlushTimer)
        loki_daemon.outputFlushTimer = undefined
      }
    }
    if (!shuttingDown) {
      // if we need to restart
      if (config.blockchain.restart) {
        console.log('BLOCKCHAIN: lokid is configured to be restarted. Will do so in 30s.')
        // restart it in 30 seconds to avoid pegging the cpu
        setTimeout(function () {
          console.log('BLOCKCHAIN: Restarting lokid.')
          launchLokid(config.blockchain.binary_path, lokid_options, config.launcher.interactive, config, args)
        }, 30 * 1000)
      } else {
        if (waitForLokiKeyTimer !== null) clearTimeout(waitForLokiKeyTimer)
        shutdown_everything()
      }
    }
  })


  function flushOutput() {
    if (!loki_daemon) {
      console.log('BLOCKCHAIN: flushOutput lost handle, stopping flushing.')
      return
    }
    // FIXME turn off when in prepare status...
    loki_daemon.stdin.write("\n")
    // schedule next flush
    loki_daemon.outputFlushTimer = setTimeout(flushOutput, 1000)
  }
  // disable until we can detect prepare_reg
  // don't want to accidentally launch with prepare_reg broken
  //loki_daemon.outputFlushTimer = setTimeout(flushOutput, 1000)

  if (cb) cb()
}

function sendToClients(data) {
  if (server) {
    // broadcast
    for(var i in connections) {
      var conn = connections[i]
      conn.write(data + "\n")
    }
  }
}

function lokinet_onMessageSockerHandler(data) {
  if (lokinet.lokinetLogging) {
    console.log(`lokinet: ${data}`)
    sendToClients('NETWORK: ' + data + '\n')
  }
  const tline = data
  const lokinetProc = lokinet.isRunning()
  // blockchain ping
  if (tline.match(/invalid result from lokid ping, not an object/) || tline.match(/invalid result from lokid ping, no result/) ||
      tline.match(/invalid result from lokid ping, status not an string/) || tline.match(/lokid ping failed:/) ||
      tline.match(/Failed to ping lokid/)) {
    lokinetProc.blockchainFailures.last_blockchain_ping = Date.now()
    // communicate this out
    lib.savePids(savePidConfig.config, savePidConfig.args, loki_daemon, lokinet, storageServer)
  }
  // blockchain identity
  if (tline.match(/lokid gave no identity key/) || tline.match(/lokid gave invalid identity key/) ||
      tline.match(/lokid gave bogus identity key/) || tline.match(/Bad response from lokid:/) ||
      tline.match(/failed to get identity keys/) || tline.match(/failed to init curl/)) {
    lokinetProc.blockchainFailures.last_blockchain_identity = Date.now()
    // communicate this out
    lib.savePids(savePidConfig.config, savePidConfig.args, loki_daemon, lokinet, storageServer)
  }
  // blockchain get servide node
  if (tline.match(/Invalid result: not an object/) || tline.match(/Invalid result: no service_node_states member/) ||
      tline.match(/Invalid result: service_node_states is not an array/)) {
    lokinetProc.blockchainFailures.last_blockchain_snode = Date.now()
    // communicate this out
    lib.savePids(savePidConfig.config, savePidConfig.args, loki_daemon, lokinet, storageServer)
  }
}
function lokinet_onErrorSockerHandler(data) {
  console.log(`lokineterr: ${data}`)
  sendToClients('NETWORK ERR: ' + data + '\n')
}

function setUpLokinetHandlers() {
  lokinet.onMessage = lokinet_onMessageSockerHandler
  lokinet.onError   = lokinet_onErrorSockerHandler
}

function handleInput(line) {
  if (line.match(/^network/i)) {
    var remaining = line.replace(/^network\s*/i, '')
    if (remaining.match(/^log/i)) {
      var param = remaining.replace(/^log\s*/i, '')
      //console.log('lokinet log', param)
      if (param.match(/^off/i)) {
        lokinet.disableLogging()
      }
      if (param.match(/^on/i)) {
        lokinet.enableLogging()
      }
    }
    return true
  }
  if (line.match(/^storage/i)) {
    var remaining = line.replace(/^storage\s*/i, '')
    if (remaining.match(/^log/i)) {
      var param = remaining.replace(/^log\s*/i, '')
      //console.log('lokinet log', param)
      if (param.match(/^off/i)) {
        storageLogging = false
      }
      if (param.match(/^on/i)) {
        storageLogging = true
      }
    }
    return true
  }
  return false
}

// startLokid should generate a current config for launcherLokid
// but the launcherLokid config should be locked in and not changeable
// so startLokid is the last opportunity to update it
// and we'll recall this function if we need to update the config too...
// also implies we'd need a reload other than HUP, USR1?
function startLokid(config, args) {
  var parameters = configureLokid(config, args)
  var lokid_options = parameters.lokid_options
  //console.log('configured ', config.blockchain.binary_path, lokid_options.join(' '))

  launchLokid(config.blockchain.binary_path, lokid_options, config.launcher.interactive, config, args)

  // if we're interactive (and no docker grab) the console
  if (config.launcher.interactive && lib.falsish(config.launcher.docker)) {
    // resume stdin in the parent process (node app won't quit all by itself
    // unless an error or process.exit() happens)
    stdin.resume()

    // i don't want binary, do you?
    stdin.setEncoding('utf8')

    // on any data into stdin
    stdin.on('data', function (key) {
      // ctrl-c ( end of text )
      if (key === '\u0003') {
        shutdown_everything()
        return
      }
      if (handleInput(key)) return
      if (!shuttingDown) {
        // local echo, write the key to stdout all normal like
        // on ssh we don't need this
        //process.stdout.write(key)

        // only if lokid is running, send input
        if (loki_daemon) {
          loki_daemon.stdin.write(key)
        }
      }
    })
    stdin.on('error', function(err) {
      console.error('STDIN ERR:', JSON.stringify(err))
    })
  } else {
    // we're non-interactive, set up socket server
    console.log('SOCKET: Starting')
    server = net.createServer((c) => {
      console.log('SOCKET: Client connected.')
      connections.push(c)
      c.setEncoding('utf8')
      c.on('end', () => {
        console.log('SOCKET: Client disconnected.')
        var idx = connections.indexOf(c)
        if (idx != -1) {
          connections.splice(idx, 1)
        }
      })
      c.on('error', (err) => {
        if (c.connected) {
          c.write('SOCKETERR: ' + JSON.stringify(err))
        } else {
          console.log('Not connected, SOCKETERR:', JSON.stringify(err))
          if (err.code === 'ECONNRESET' || err.code === 'ERR_STREAM_DESTROYED') {
            // make sure we remove ourself from broadcasts (lokid stdout writes)...
            var idx = connections.indexOf(c)
            if (idx != -1) {
              connections.splice(idx, 1)
            }
            // leave it to the client to reconnect
          }
        }
      })
      c.on('data', (data) => {
        var parts = data.toString().split(/\n/)
        parts.pop()
        stripped = parts.join('\n')
        console.log('SOCKET: got', stripped)
        if (handleInput(stripped)) return
        if (loki_daemon && !loki_daemon.killed) {
          console.log('SOCKET: Sending to lokid.')
          loki_daemon.stdin.write(data + "\n")
        }
      })
      c.write('Connection successful\n')
      // confirmed error is already catch above
      c.pipe(c)/* .on('error', function(err) {
        console.error('SOCKETSRV_ERR:', JSON.stringify(err))
      }) */
    })
    setUpLokinetHandlers()

    server.on('error', (err) => {
      if (err.code == 'EADDRINUSE') {
        // either already running or we were killed
        // try to connect to it
        net.connect({ path: config.launcher.var_path + '/launcher.socket' }, function () {
          // successfully connected, then it's in use...
          throw e;
        }).on('error', function (e) {
          if (e.code !== 'ECONNREFUSED') throw e
          console.log('SOCKET: socket is stale, nuking')
          fs.unlinkSync(config.launcher.var_path + '/launcher.socket')
          server.listen(config.launcher.var_path + '/launcher.socket')
        })
        return
      }
      console.error('SOCKET ERROR:', err)
      // some errors we need to shutdown
      //shutdown_everything()
    })

    server.listen(config.launcher.var_path + '/launcher.socket', () => {
      console.log('SOCKET: bound')
    })
  }

  // only set up these handlers if we need to
  setupHandlers()
}

function getInterestingDaemonData() {
  var ts = Date.now()
  var lokinet_daemon = lokinet.getLokinetDaemonObj();
  var procInfo = {
    blockchain: {
      pid: loki_daemon?loki_daemon.pid:0,
      killed: loki_daemon?loki_daemon.killed:false,
      uptime: loki_daemon?(ts - loki_daemon.startTime):0,
      startTime: loki_daemon?loki_daemon.startTime:0,
      spawnfile: loki_daemon?loki_daemon.spawnfile:'',
      spawnargs: loki_daemon?loki_daemon.spawnargs:'',
    },
    network: {
      pid: lokinet?lokinet.pid:lokinet,
      killed: lokinet?lokinet.killed:false,
      uptime: lokinet?(ts - lokinet.startTime):0,
      startTime: lokinet?lokinet.startTime:0,
      spawnfile: lokinet?lokinet.spawnfile:'',
      spawnargs: lokinet?lokinet.spawnargs:'',
    },
    storage: {
      pid: storageServer?storageServer.pid:0,
      killed: storageServer?storageServer.killed:false,
      uptime: storageServer?(ts - storageServer.startTime):0,
      startTime: storageServer?storageServer.startTime:0,
      spawnfile: storageServer?storageServer.spawnfile:'',
      spawnargs: storageServer?storageServer.spawnargs:'',
    },
  }
  return procInfo;
}

var handlersSetup = false
function setupHandlers() {
  if (handlersSetup) return
  process.on('SIGHUP', () => {
    console.log('got SIGHUP!')
    if (savePidConfig.config) {
      console.log('updating pids file', savePidConfig.config.launcher.var_path + '/pids.json')
      lib.savePids(savePidConfig.config, savePidConfig.args, loki_daemon, lokinet, storageServer)
    }
    console.log('shuttingDown?', shuttingDown)
    const procInfo = getInterestingDaemonData()
    var nodeVer = Number(process.version.match(/^v(\d+\.\d+)/)[1])
    if (nodeVer >= 10) {
      console.table(procInfo)
    } else {
      console.log(procInfo)
    }
    console.log('lokinet status', lokinet.isRunning())
  })
  // ctrl-c
  process.on('SIGINT', function () {
    console.log('LAUNCHER daemon got SIGINT (ctrl-c)')
    shutdown_everything()
  })
  // -15
  process.on('SIGTERM', function () {
    console.log('LAUNCHER daemon got SIGTERM (kill -15)')
    shutdown_everything()
  })
  handlersSetup = true
}

module.exports = {
  startLauncherDaemon: startLauncherDaemon,
  startLokinet: startLokinet,
  startStorageServer: startStorageServer,
  startLokid: startLokid,
  waitForLokiKey: waitForLokiKey,
  setupHandlers: setupHandlers,
  shutdown_everything: shutdown_everything,
  config: {}
}
