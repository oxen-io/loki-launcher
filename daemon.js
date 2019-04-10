// no npm!
const fs        = require('fs')
const os        = require('os')
const net       = require('net')
const ini       = require('./ini')
const { spawn } = require('child_process')
const stdin     = process.openStdin()

// ugly hack for Ryan's mac box
if (os.platform() == 'darwin') {
  process.env.DYLD_LIBRARY_PATH = 'depbuild/boost_1_69_0/stage/lib'
}

module.exports = function(args, entryPoint, lokinet, config, getLokiDataDir) {
  var server
  var connections = []
  fs.writeFileSync('launcher.pid', process.pid)

  // see if we need to detach
  if (!config.launcher.interactive) {
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

  var shuttingDown = false

  var storageServer
  function launcherStorageServer(config, cb) {
    if (shuttingDown) {
      //if (cb) cb()
      console.log('not going to start storageServer, shutting down')
      return
    }
    // set storage port default
    if (!config.port) {
      config.port = 8080
    }
    // configure command line parameters
    let optionals = []
    if (config.log_level) {
      optionals.push('--log-level', config.log_level)
    }
    if (config.lokinet_identity) {
      optionals.push('--lokinet-identity', config.identity_path)
    }
    // FIXME: make launcher handle all logging
    if (config.output_log) {
      optionals.push('--output-log', config.output_log)
    }
    if (config.db_location) {
      optionals.push('--db-location', config.db_location)
    }
    storageServer = spawn(config.binary_path, [config.ip, config.port, ...optionals])

    //console.log('storageServer', storageServer)
    if (!storageServer.stdout) {
      console.error('storageServer failed?')
      return
    }

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
        launcherStorageServer(config)
      }
    })
    if (cb) cb()
  }

  if (1) {
    lokinet.startServiceNode(config.network, function() {
      //console.log('trying to get IP information about lokinet')
      lokinet.getLokiNetIP(function(ip) {
        if (ip) {
          console.log('starting storageServer on', ip)
          config.storage.ip = ip
          launcherStorageServer(config.storage)
        } else {
          console.log('Sorry cant detect our lokinet IP:', ip)
          shutdown_everything()
        }
      })
    })
  }
  /*
  try {
    process.seteuid('rtharp')
    console.log(`New uid: ${process.geteuid()}`)
  } catch(err) {
    console.log(`Failed to set uid: ${err}`)
  }
  */

  function shutdown_everything() {
    shuttingDown = true
    stdin.pause()
    if (storageServer && !storageServer.killed) {
      console.log('requesting storageServer be shutdown')
      process.kill(storageServer.pid, 'SIGINT')
      storageServer = null
    }
    // even if not running, yet, stop any attempts at starting it too
    lokinet.stop()
    if (loki_daemon && !loki_daemon.killed) {
      console.log('requesting lokid be shutdown')
      process.kill(loki_daemon.pid, 'SIGINT')
      loki_daemon = null
    }
    // clear our start up lock (if needed, will crash if not there)
    if (fs.existsSync('launcher.pid')) {
      fs.unlinkSync('launcher.pid')
    }

    if (server) {
      console.log('closing socket server')
      for(var i in connections) {
        var conn = connections[i]
        if (!conn.destroyed) {
          console.log('disconnecting client', i)
          conn.destroy()
        }
      }
      server.close()
      server.unref()
    }
    if (fs.existsSync('test.socket')) {
      console.log('cleaning socket')
      fs.unlinkSync('test.socket')
    }
    process._getActiveHandles();
    process._getActiveRequests();
    // don't think we need, seems to handle itself
    //console.log('should exit?')
    //process.exit()
  }

  var loki_daemon
  if (1) {
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
    console.log('launching lokid with', lokid_options.join(' '))

    // hijack STDIN but not OUT/ERR
    if (config.launcher.interactive) {
      // don't hijack stdout, so prepare_registration works
      loki_daemon = spawn(config.blockchain.binary_path, lokid_options, {
        stdio: ['pipe', 'inherit', 'inherit'],
        //shell: true
      })
    } else {
      // allow us to hijack stdout
      loki_daemon = spawn(config.blockchain.binary_path, lokid_options)
    }
    if (!loki_daemon) {
      console.error('failed to start lokied, exiting...')
      shutdown_everything()
    }

    if (!config.launcher.interactive) {
      // why is the banner held back until we connect!?
      loki_daemon.stdout.on('data', (data) => {
        console.log(`blockchainRAW: ${data}`)
        //var parts = data.toString().split(/\n/)
        //parts.pop()
        //stripped = parts.join('\n')
        //console.log(`blockchain: ${stripped}`)
        // seems to be working...
        if (server) {
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
      if (!shuttingDown) {
        loki_daemon = null
        shutdown_everything()
      }
    })
  }


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
        if (loki_daemon) {
          console.log('sending to lokid')
          loki_daemon.stdin.write(data + "\n")
        }
      })
      c.write('hello\n')
      c.pipe(c)
    })

    server.on('error', (err) => {
      console.error('err', err)
      // some errors we need to shutdown
      //shutdown_everything()
    })

    server.listen("test.socket", () => {
      console.log('bound')
    })
  }

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
}
