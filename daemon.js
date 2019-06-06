// no npm!
const fs = require('fs')
//const os = require('os')
const net = require('net')
const path = require('path')
const lib = require(__dirname + '/lib')
const lokinet = require(__dirname + '/lokinet')
const { spawn } = require('child_process')
const stdin = process.openStdin()

const VERSION = 0.1
console.log('loki daemon library version', VERSION, 'registered')

var connections = []
function disconnectAllClients() {
  console.log('SOCKET: disconnecting all', connections.length, 'clients')
  for(var i in connections) {
    var conn = connections[i]
    if (!conn.destroyed) {
      //console.log('disconnecting client #'+i)
      conn.destroy()
    }
  }
  connections = [] // clear them
}

var shuttingDown = false
function shutdown_everything() {
  shuttingDown = true
  stdin.pause()
  if (storageServer && !storageServer.killed) {
    console.log('LAUNCHER: requesting storageServer be shutdown', storageServer.pid)
    // FIXME: if this pid isn't running we crash
    // FIXME: was killed not set?
    try {
      process.kill(storageServer.pid, 'SIGINT')
    } catch(e) {
    }
    storageServer.killed = true
    //storageServer = null
  }
  // even if not running, yet, stop any attempts at starting it too
  lokinet.stop()
  if (loki_daemon && !loki_daemon.killed) {
    console.log('LAUNCHER: requesting lokid be shutdown', loki_daemon.pid)
    try {
      process.kill(loki_daemon.pid, 'SIGINT')
    } catch(e) {
    }
    loki_daemon.killed = true
  }
  // clear our start up lock (if needed, will crash if not there)
  if (fs.existsSync('launcher.pid')) {
    fs.unlinkSync('launcher.pid')
  }
  // FIXME: should we be savings pids as we shutdown? probably
  var shutDownTimer = setInterval(function () {
    var stop = true
    if (storageServer && storageServer.pid && lib.isPidRunning(storageServer.pid)) {
      console.log('LAUNCHER: storage server still running')
      stop = false
    }
    if (loki_daemon) {
      if (loki_daemon.outputFlushTimer) {
        clearInterval(loki_daemon.outputFlushTimer)
      }
    }
    if (loki_daemon && loki_daemon.pid && lib.isPidRunning(loki_daemon.pid)) {
      console.log('LAUNCHER: lokid still running')
      // lokid on macos may need a kill -9 after a couple failed 15
      // lets say 50s of not stopping -15 then wait 30s if still run -9
      stop = false
    }
    var lokinetState = lokinet.isRunning()
    if (lokinetState && lokinetState.pid && lib.isPidRunning(lokinetState.pid)) {
      console.log('LAUNCHER: lokinet still running')
      stop = false
    }
    if (stop) {
      console.log('all daemons down')
      // deallocate
      // can't null these yet because lokid.onExit
      // race between the pid dying and registering of the exit
      storageServer = null
      loki_daemon = null
      lokinetState = null
      if (fs.existsSync('pids.json')) {
        console.log('LAUNCHER: clearing pids.json')
        fs.unlinkSync('pids.json')
      } else {
        console.log('LAUNCHER: NO pids.json found, can\'t clear')
      }
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
  }, 1000)

  if (server) {
    console.log('SOCKET: closing socket server')
    disconnectAllClients()
    server.close()
    server.unref()
  }
  if (fs.existsSync('launcher.socket')) {
    console.log('SOCKET: cleaning socket')
    fs.unlinkSync('launcher.socket')
  }
  // don't think we need, seems to handle itself
  //console.log('should exit?')
  //process.exit()
}

var storageServer
function launcherStorageServer(config, args, cb) {
  if (shuttingDown) {
    //if (cb) cb()
    console.log('STORAGE: not going to start storageServer, shutting down')
    return
  }
  if (!config.storage.lokid_key) {
    console.error('storageServer requires lokid_key to be configured')
    if (cb) cb(false)
    return
  }
  // set storage port default
  if (!config.storage.port) {
    config.storage.port = 8080
  }
  // configure command line parameters
  let optionals = ['--lokid-key', config.storage.lokid_key]
  if (config.storage.log_level) {
    optionals.push('--log-level', config.storage.log_level)
  }
  // FIXME: make launcher handle all logging
  if (config.storage.output_log) {
    optionals.push('--output-log', config.storage.output_log)
  }
  if (config.storage.db_location) {
    optionals.push('--db-location', config.storage.db_location)
  }
  if (config.storage.lokid_rpc_port) {
    optionals.push('--lokid-rpc-port', config.storage.lokid_rpc_port)
  }
  console.log('STORAGE: launching', config.storage.binary_path, [config.storage.ip, config.storage.port, ...optionals].join(' '))
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
  lib.savePids(config, args, loki_daemon, lokinet, storageServer)

  storageServer.stdout.pipe(process.stdout)
  var storageServer_version = 'unknown'
  storageServer.stdout.on('data', (data) => {
    var lines = data.toString().split(/\n/)
    for(var i in lines) {
      var tline = lines[i].trim()
      //Loki Storage Server v0.1
      if (tline.match('Loki Storage Server v')) {
        var parts = tline.split('Loki Storage Server v')
        storageServer_version = parts[1]
      }
      // git commit hash: 94c835f
      if (tline.match('git commit hash: ')) {
        var parts = tline.split('git commit hash: ')
        //lokinet_version = parts[1]
        fs.writeFileSync('storageServer.version', storageServer_version+"\n"+parts[1])
      }
    }
    lines.pop()
    data = lines.join('\n')
    // we're already piping to stdout
    //console.log(`STORAGE: ${data}`)
  })

  storageServer.stderr.on('STORAGE:', (data) => {
    console.log(`STORAGE ERR: ${data}`)
  })

  storageServer.on('close', (code) => {
    console.log(`storageServer process exited with code ${code} after`, (Date.now() - storageServer.startTime)+'ms')
    storageServer.killed = true
    if (code == 1) {
      console.warn('storageServer bind port could be in use, please check to make sure', config.binary_path, 'is not already running on port', config.port)
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
        console.log('loki_daemon is still running, restarting storageServer')
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

function startStorageServer(config, args, cb) {
  //console.log('trying to get IP information about lokinet')
  if (config.network.enabled) {
    lokinet.getLokiNetIP(function (ip) {
      // lokinet has started, save config and various process pid
      lib.savePids(config, args, loki_daemon, lokinet, storageServer)
      if (ip) {
        console.log('DAEMON: starting storageServer on', ip)
        config.storage.ip = ip
        if (config.storage.db_location !== undefined) {
          if (!fs.existsSync(config.storage.db_location)) {
            lokinet.mkDirByPathSync(config.storage.db_location)
          }
        }
        launcherStorageServer(config, args, cb)
      } else {
        console.error('DAEMON: Sorry cant detect our lokinet IP:', ip)
        if (cb) cb(false)
        //shutdown_everything()
      }
    })
  } else if (config.storage.enabled) {
    lokinet.getNetworkIP(function(err, localIP) {
      console.log('DAEMON: starting storageServer on', localIP)
      // we can only ever bind to the local IP
      config.storage.ip = localIP
      if (config.storage.db_location !== undefined) {
        if (!fs.existsSync(config.storage.db_location)) {
          lokinet.mkDirByPathSync(config.storage.db_location)
        }
      }
      launcherStorageServer(config, args, cb)
    })
  } else {
    console.log('storageServer is not enabled')
  }
}

function startLokinet(config, args, cb) {
  if (config.network.enabled) {
    lokinet.startServiceNode(config.network, function () {
      startStorageServer(config, args, cb)
    })
  } else {
    if (config.storage.enabled) {
      startStorageServer(config, args, cb)
    }
  }
}

function startLauncherDaemon(interactive, entryPoint, args, cb) {
  /*
  try {
    process.seteuid('rtharp')
    console.log(`New uid: ${process.geteuid()}`)
  } catch(err) {
    console.log(`Failed to set uid: ${err}`)
  }
  */

  // see if we need to detach
  //console.log('interactive', interactive)
  if (!interactive) {
    //console.log('fork check', process.env.__daemon)
    if (!process.env.__daemon) {
      // first run
      process.env.__daemon = true
      // spawn as child
      var cp_opt = {
        stdio: 'ignore',
        env: process.env,
        cwd: process.cwd(),
        detached: true
      }
      console.log('launching', process.execPath, entryPoint, args)
      var child = spawn(process.execPath, [entryPoint, 'daemon-start'].concat(args), cp_opt)
      //console.log('child', child)
      if (!child) {
        console.error('Could not spawn detached process')
        process.exit()
      }
      // required so we can exit
      child.unref()
      process.exit()
    }
    // no one sees these
    //console.log('backgrounded')
  }
  // backgrounded or launched in interactive mode
  //console.log('backgrounded or launched in interactive mode')
  fs.writeFileSync('launcher.pid', process.pid)
  cb()
}

// compile config into CLI arguments
// only needs to be ran when config changes
function configureLokid(config, args) {
  // FIXME: launcher.ini blockchain option to disable restricted-rpc-listen
  var lokid_options = ['--service-node', '--restricted-rpc']

  // if ip is not localhost, pass it to lokid
  if (config.blockchain.rpc_ip && config.blockchain.rpc_ip != '127.0.0.1') {
    lokid_options.push('--rpc-bind-ip='+config.blockchain.rpc_ip, '--confirm-external-bind')
  }

  if (config.blockchain.rpc_pass) {
    lokid_options.push('--rpc-login='+config.blockchain.rpc_user+':'+config.blockchain.rpc_pass)
  }
  // net selection
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
  // copy CLI options to lokid
  for (var i in args) {
    lokid_options.push(args[i])
  }

  return {
    lokid_options: lokid_options,
  }
}

var loki_daemon
var server
function launchLokid(binary_path, lokid_options, interactive, config, args, cb) {
  if (shuttingDown) {
    //if (cb) cb()
    console.log('BLOCKCHAIN: not going to start lokid, shutting down')
    return
  }
  // hijack STDIN but not OUT/ERR
  //console.log('launchLokid - interactive?', interactive)
  if (interactive) {
    // don't hijack stdout, so prepare_registration works
    console.log('BLOCKCHAIN: launchLokid - interactive mode')
    loki_daemon = spawn(binary_path, lokid_options, {
      stdio: ['pipe', 'inherit', 'inherit'],
      //shell: true
    })
  } else {
    // allow us to hijack stdout
    console.log('BLOCKCHAIN: launching', binary_path, lokid_options.join(' '))
    loki_daemon = spawn(binary_path, lokid_options)
  }
  if (!loki_daemon) {
    console.error('BLOCKCHAIN: failed to start lokied, exiting...')
    shutdown_everything()
  }
  loki_daemon.startTime = Date.now()
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
        console.log('BLOCKCHAIN: lokid is configured to be restarted. Will do so in 30s')
        // restart it in 30 seconds to avoid pegging the cpu
        setTimeout(function () {
          console.log('BLOCKCHAIN: restarting lokid')
          launchLokid(config.blockchain.binary_path, lokid_options, config.launcher.interactive, config, args)
        }, 30 * 1000)
      } else {
        shutdown_everything()
      }
    }
  })


  function flushOutput() {
    if (!loki_daemon) {
      console.log('BLOCKCHAIN: flushOutput lost handle, stopping flushing')
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
  if (line.match(/^lokinet/i)) {
    var remaining = line.replace(/^lokinet\s*/i, '')
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
  return false
}

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
      if (handleInput(line)) return
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
  } else {
    // we're non-interactive, set up socket server
    console.log('SOCKET: Starting')
    server = net.createServer((c) => {
      console.log('SOCKET: client connected')
      connections.push(c)
      c.setEncoding('utf8')
      c.on('end', () => {
        console.log('SOCKET: client disconnected')
        var idx = connections.indexOf(c)
        if (idx != -1) {
          connections.splice(idx, 1)
        }
      })
      c.on('data', (data) => {
        var parts = data.toString().split(/\n/)
        parts.pop()
        stripped = parts.join('\n')
        console.log('SOCKET: got', stripped)
        if (handleInput(stripped)) return
        if (loki_daemon && !loki_daemon.killed) {
          console.log('SOCKET:sending to lokid')
          loki_daemon.stdin.write(data + "\n")
        }
      })
      c.write('connection successful\n')
      c.pipe(c)
    })
    setUpLokinetHandlers()

    server.on('error', (err) => {
      if (err.code == 'EADDRINUSE') {
        // either already running or we were killed
        // try to connect to it
        net.connect({ path: "launcher.socket" }, function () {
          // successfully connected, then it's in use...
          throw e;
        }).on('error', function (e) {
          if (e.code !== 'ECONNREFUSED') throw e
          console.log('SOCKET: socket is stale, nuking')
          fs.unlinkSync('launcher.socket')
          server.listen('launcher.socket')
        })
        return
      }
      console.error('SOCKET ERROR:', err)
      // some errors we need to shutdown
      //shutdown_everything()
    })

    server.listen('launcher.socket', () => {
      console.log('SOCKET: bound')
    })
  }

  // only set up these handlers if we need to
  setupHandlers()
}

var handlersSetup = false
function setupHandlers() {
  if (handlersSetup) return
  process.on('SIGHUP', () => {
    console.log('shuttingDown?', shuttingDown)
    var ts = Date.now()
    var procInfo = {
      blockchain: {
        pid: loki_daemon.pid,
        uptime: ts - loki_daemon.startTime
      },
      network: {
        pid: lokinet.pid,
        uptime: ts - lokinet.startTime
      },
      storage: {
        pid: storageServer.pid,
        uptime: ts - storageServer.startTime
      },
    }
    console.table(procInfo)
    console.log('loki_daemon status', loki_daemon)
    console.log('lokinet status', lokinet.isRunning())
    console.log('storageServer status', storageServer)
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
  setupHandlers: setupHandlers,
  shutdown_everything: shutdown_everything,
}
