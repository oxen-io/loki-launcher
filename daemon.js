// no npm!
const fs        = require('fs')
const os        = require('os')
const net       = require('net')
const lib       = require('./lib')
const lokinet   = require('./lokinet')
const { spawn } = require('child_process')
const stdin     = process.openStdin()

// ugly hack for Ryan's mac box & storageServer
if (os.platform() == 'darwin') {
  process.env.DYLD_LIBRARY_PATH = 'depbuild/boost_1_69_0/stage/lib'
}

var connections = []
function disconnectAllClients() {
  console.log('disconnecting all', connections.length, 'clients')
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
    console.log('requesting storageServer be shutdown', storageServer.pid)
    process.kill(storageServer.pid, 'SIGINT')
    storageServer.killed = true
    //storageServer = null
  }
  // even if not running, yet, stop any attempts at starting it too
  lokinet.stop()
  if (loki_daemon && !loki_daemon.killed) {
    console.log('requesting lokid be shutdown', loki_daemon.pid)
    process.kill(loki_daemon.pid, 'SIGINT')
    loki_daemon.killed = true
  }
  // clear our start up lock (if needed, will crash if not there)
  if (fs.existsSync('launcher.pid')) {
    fs.unlinkSync('launcher.pid')
  }
  // FIXME: should we be savings pids as we shutdown? probably
  var shutDownTimer = setInterval(function() {
    var stop = true
    if (storageServer && storageServer.pid && lib.isPidRunning(storageServer.pid)) {
      console.log('storage server still running')
      stop = false
    }
    if (loki_daemon) {
      if (loki_daemon.outputFlushTimer) {
        clearInterval(loki_daemon.outputFlushTimer)
      }
    }
    if (loki_daemon && loki_daemon.pid && lib.isPidRunning(loki_daemon.pid)) {
      console.log('lokid still running')
      // lokid on macos may need a kill -9 after a couple failed 15
      // lets say 50s of not stopping -15 then wait 30s if still run -9
      stop = false
    }
    var lokinetState = lokinet.isRunning()
    if (lokinetState && lokinetState.pid && lib.isPidRunning(lokinetState.pid)) {
      console.log('lokinet still running')
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
        console.log('clearing pids.json')
        fs.unlinkSync('pids.json')
      } else {
        console.log('NO pids.json found, can\'t clear')
      }
      clearInterval(shutDownTimer)
      // docker/node 10 on linux has issue with this
      // 10.15 on macos has a handle, probably best to release
      if (stdin.unref) {
        //console.log('unref stdin')
        stdin.unref()
      }
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
    console.log('closing socket server')
    disconnectAllClients()
    server.close()
    server.unref()
  }
  if (fs.existsSync('launcher.socket')) {
    console.log('cleaning socket')
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
    console.log('not going to start storageServer, shutting down')
    return
  }
  if (!config.lokid_key) {
    console.log('storageServer requires lokid_key to be configured')
    if (cb) cb(false)
    return
  }
  // set storage port default
  if (!config.port) {
    config.port = 8080
  }
  // configure command line parameters
  let optionals = ['--lokid-key', config.lokid_key]
  if (config.log_level) {
    optionals.push('--log-level', config.log_level)
  }
  // FIXME: make launcher handle all logging
  if (config.output_log) {
    optionals.push('--output-log', config.output_log)
  }
  if (config.db_location) {
    optionals.push('--db-location', config.db_location)
  }
  console.log('starting storager server with', [config.ip, config.port, ...optionals])
  // ip and port must be first
  storageServer = spawn(config.binary_path, [config.ip, config.port, ...optionals])
  // , { stdio: 'inherit' })

  //console.log('storageServer', storageServer)
  if (!storageServer.stdout) {
    console.error('storageServer failed?')
    if (cb) cb(false)
    return
  }
  lib.savePids(config, args, loki_daemon, lokinet, storageServer)

  storageServer.stdout.pipe(process.stdout)
  storageServer.stdout.on('data', (data) => {
    var parts = data.toString().split(/\n/)
    parts.pop()
    data = parts.join('\n')
    console.log(`storageServer: ${data}`)
  })

  storageServer.stderr.on('data', (data) => {
    console.log(`storageServerErr: ${data}`)
  })

  storageServer.on('close', (code) => {
    console.log(`storageServer process exited with code ${code}`)
    if (code == 1) {
      console.log('storageServer bind port could be in use, please check to make sure', config.binary_path, 'is not already running on port', config.port)
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
      console.log('loki_daemon is still running, restarting storageServer')
      launcherStorageServer(config, args)
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
  lokinet.getLokiNetIP(function(ip) {
    lib.savePids(config, args, loki_daemon, lokinet, storageServer)
    if (ip) {
      console.log('starting storageServer on', ip)
      config.storage.ip = ip
      launcherStorageServer(config.storage, args, cb)
    } else {
      console.log('Sorry cant detect our lokinet IP:', ip)
      if (cb) cb(false)
      //shutdown_everything()
    }
  })
}

function startLokinet(config, args, cb) {
  lokinet.startServiceNode(config.network, function() {
    startStorageServer(config, args, cb)
  })
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
      var child = spawn(process.execPath, [entryPoint].concat(args), cp_opt)
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
  var lokid_options = ['--service-node']
  lokid_options.push('--rpc-login='+config.blockchain.rpc_user+':'+config.blockchain.rpc_pass+'')
  if (config.blockchain.network == "test") {
    lokid_options.push('--testnet')
  } else
  if (config.blockchain.network == "staging") {
    lokid_options.push('--stagenet')
  }
  if (!config.launcher.interactive) {
    // we handle the detach, we don't need to detach lokid from us
    // we need this now to keep a console open
    //lokid_options.push('--non-interactive')
    lokinet.disableLogging()
  }
  if (config.blockchain.zmq_port) {
    lokid_options.push('--zmq-rpc-bind-port='+config.blockchain.zmq_port)
  }
  if (config.blockchain.rpc_port) {
    lokid_options.push('--rpc-bind-port='+config.blockchain.rpc_port)
  }
  if (config.blockchain.p2p_port) {
    lokid_options.push('--p2p-bind-port='+config.blockchain.p2p_port)
  }
  if (config.blockchain.data_dir) {
    lokid_options.push('--data-dir='+config.blockchain.data_dir)
  }
  // copy CLI options to lokid
  for(var i in args) {
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
    log('not going to start lokid, shutting down')
    return
  }
  // hijack STDIN but not OUT/ERR
  if (interactive) {
    // don't hijack stdout, so prepare_registration works
    loki_daemon = spawn(binary_path, lokid_options, {
      stdio: ['pipe', 'inherit', 'inherit'],
      //shell: true
    })
  } else {
    // allow us to hijack stdout
    loki_daemon = spawn(binary_path, lokid_options)
  }
  if (!loki_daemon) {
    console.error('failed to start lokied, exiting...')
    shutdown_everything()
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
        for(var i in connections) {
          var conn = connections[i]
          conn.write(data + "\n")
        }
      }
    })
  }

  loki_daemon.on('close', (code) => {
    console.log(`loki_daemon process exited with code ${code}`)
    // code 0 means clean shutdown
    if (code === 0) {
      // likely to mean it was requested
      if (config.blockchain.restart) {
        // we're just going to restart
        if (server) {
          // broadcast
          for(var i in connections) {
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
        console.log('lokid is configured to be restarted. Will do so in 30s')
        // restart it in 30 seconds to avoid pegging the cpu
        setTimeout(function() {
          console.log('restarting lokid')
          launchLokid(config.blockchain.binary_path, lokid_options, config.launcher.interactive, config, args)
        }, 30 * 1000)
      } else {
        shutdown_everything()
      }
    }
  })


  function flushOutput() {
    if (!loki_daemon) {
      console.log('flushOutput lost handle, stopping flushing')
      return
    }
    // FIXME turn off when in prepare status...
    loki_daemon.stdin.write("\n")
    // schedule next flush
    loki_daemon.outputFlushTimer = setTimeout(flushOutput, 1000)
  }
  loki_daemon.outputFlushTimer = setTimeout(flushOutput, 1000)

  if (cb) cb()
}

function startLokid(config, args) {

  var parameters = configureLokid(config, args)
  var lokid_options = parameters.lokid_options
  console.log('launching lokid with', lokid_options.join(' '))

  launchLokid(config.blockchain.binary_path, lokid_options, config.launcher.interactive, config, args)

  // if we're interactive grab the console
  if (config.launcher.interactive) {
    // resume stdin in the parent process (node app won't quit all by itself
    // unless an error or process.exit() happens)
    stdin.resume()

    // i don't want binary, do you?
    stdin.setEncoding( 'utf8' )

    // on any data into stdin
    stdin.on( 'data', function( key ){
      // ctrl-c ( end of text )
      if ( key === '\u0003' ) {
        shutdown_everything()
        return
      }
      if (key.match(/^lokinet/i)) {
        var remaining = key.replace(/^lokinet\s*/i, '')
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
        return
      }
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
    console.log('Starting socket')
    server = net.createServer((c) => {
      console.log('client connected')
      connections.push(c)
      c.setEncoding('utf8')
      c.on('end', () => {
        console.log('client disconnected')
        var idx = connections.indexOf(c)
        if (idx != -1) {
          connections.splice(idx, 1)
        }
      })
      c.on('data', (data) => {
        var parts = data.toString().split(/\n/)
        parts.pop()
        stripped = parts.join('\n')
        console.log('socket got', stripped)
        if (loki_daemon && !loki_daemon.killed) {
          console.log('sending to lokid')
          loki_daemon.stdin.write(data + "\n")
        }
      })
      c.write('hello\n')
      c.pipe(c)
    })

    server.on('error', (err) => {
      if (err.code == 'EADDRINUSE') {
        // either already running or we were killed
        // try to connect to it
        net.connect({ path: "launcher.socket" }, function() {
          // successfully connected, then it's in use...
          throw e;
        }).on('error', function(e) {
          if (e.code !== 'ECONNREFUSED') throw e
          console.log('socket is stale, nuking')
          fs.unlinkSync('launcher.socket')
          server.listen('launcher.socket')
        })
        return
      }
      console.error('err', err)
      // some errors we need to shutdown
      //shutdown_everything()
    })

    server.listen('launcher.socket', () => {
      console.log('bound')
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
    console.log('loki_daemon status', loki_daemon)
    console.log('lokinet status', lokinet.isRunning())
  })
  // ctrl-c
  process.on('SIGINT', function() {
    console.log('LAUNCHER daemon got SIGINT (ctrl-c)')
    shutdown_everything()
  })
  // -15
  process.on('SIGTERM', function() {
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
