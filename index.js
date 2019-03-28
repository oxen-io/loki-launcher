// no npm!
const fs        = require('fs')
const os        = require('os')
const ini       = require('./ini')
const { spawn } = require('child_process')
const stdin     = process.openStdin()
const lokinet   = require('./lokinet')

const VERSION = 0.1
console.log('loki SN launcher version', VERSION, 'registered')

// preprocess command line arguments
var args = process.argv
function stripArg(match) {
  for(var i in args) {
    var arg = args[i]
    if (arg.match(match)) {
      args.splice(i, 1)
    }
  }
}
stripArg('node')
stripArg('index')
console.log('Launcher arguments:', args)

// load config from disk
const ini_bytes = fs.readFileSync('launcher.ini')
var disk_config = ini.iniToJSON(ini_bytes.toString())
running_config   = {}
requested_config = disk_config

config = requested_config

console.log('Launcher loaded config:', config)

// defaults
if (config.network.testnet === undefined) {
  config.network.testnet = config.blockchain.network == "test"
}

// autoconfig
/*
--zmq-rpc-bind-port arg (=22024, 38158 if 'testnet', 38155 if 'stagenet')
--rpc-bind-port arg (=22023, 38157 if 'testnet', 38154 if 'stagenet')
--p2p-bind-port arg (=22022, 38156 if 'testnet', 38153 if 'stagenet')
--p2p-bind-port-ipv6 arg (=22022, 38156 if 'testnet', 38153 if 'stagenet')
*/
if (config.blockchain.zmq_port == '0') {
  // only really need this one set for lokinet
  config.blockchain.zmq_port = undefined
  /*
  if (config.blockchain.network.toLowerCase() == "test" || config.blockchain.network.toLowerCase() == "testnet" || config.blockchain.network.toLowerCase() == "test-net") {
    config.blockchain.zmq_port = 38158
  } else
  if (config.blockchain.network.toLowerCase() == "staging" || config.blockchain.network.toLowerCase() == "stage") {
    config.blockchain.zmq_port = 38155
  } else {
    config.blockchain.zmq_port = 22024
  }
  */
}
if (config.blockchain.rpc_port == '0') {
  if (config.blockchain.network.toLowerCase() == "test" || config.blockchain.network.toLowerCase() == "testnet" || config.blockchain.network.toLowerCase() == "test-net") {
    config.blockchain.rpc_port = 38157
  } else
  if (config.blockchain.network.toLowerCase() == "staging" || config.blockchain.network.toLowerCase() == "stage") {
    config.blockchain.rpc_port = 38154
  } else {
    // main
    config.blockchain.rpc_port = 22023
  }
}
if (config.blockchain.p2p_port == '0') {
  // only really need this one set for lokinet
  config.blockchain.p2p_port = undefined
  /*
  if (config.blockchain.network.toLowerCase() == "test" || config.blockchain.network.toLowerCase() == "testnet" || config.blockchain.network.toLowerCase() == "test-net") {
    config.blockchain.p2p_port = 38156
  } else
  if (config.blockchain.network.toLowerCase() == "staging" || config.blockchain.network.toLowerCase() == "stage") {
    config.blockchain.p2p_port = 38153
  } else {
    config.blockchain.p2p_port = 22022
  }
  */
}

// upload lokid to lokinet
config.network.lokid = config.blockchain

// ugly hack for Ryan's mac box
if (os.platform() == 'darwin') {
  process.env.DYLD_LIBRARY_PATH = 'depbuild/boost_1_69_0/stage/lib'
}

// run all sanity checks before we may need to detach
if (!fs.existsSync(config.blockchain.binary_path)) {
  console.error('lokid is not at configured location', config.blockchain.binary_path)
  process.exit()
}
if (!fs.existsSync(config.storage.binary_path)) {
  console.error('storageServer is not at configured location', config.storage.binary_path)
  process.exit()
}
lokinet.checkConfig(config.network)
if (!fs.existsSync(config.network.binary_path)) {
  console.error('lokinet is not at configured location', config.network.binary_path)
  process.exit()
}

if (config.network.bootstrap_path && !fs.existsSync(config.network.bootstrap_path)) {
  console.error('lokinet bootstrap not found at location', config.network.binary_path)
  process.exit()
}

//console.log('userInfo', os.userInfo('utf8'))
//console.log('started as', process.getuid(), process.geteuid())
if (os.platform() == 'darwin') {
  if (process.getuid() != 0) {
    console.error('MacOS requires you start this with sudo')
    process.exit()
  }
} else {
  if (process.getuid() == 0) {
    console.error('Its not recommended you run this as root')
  }
}

// see if we need to detach
if (!config.launcher.interactive) {
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
    var child = spawn(process.execPath, ['index'].concat(args), cp_opt)
    // required so we can exit
    child.unref()
    process.exit()
  }
}

var shuttingDown = false

var storageServer
function launcherStorageServer(config, cb) {
  if (shuttingDown) {
    //if (cb) cb()
    console.log('not going to start storageServer, shutting down')
    return
  }
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
      console.log('storageServer bind port could be in use')
      // we could want to issue one kill just to make sure
      // however since we don't know the pid, we won't know if it's ours
      // or meant be running by another copy of the launcher
      // at least any launcher copies will be restarted
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
      console.log('starting storageServer on', ip)
      config.storage.ip = ip
      launcherStorageServer(config.storage)
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
  // don't think we need, seems to handle itself
  //console.log('should exit?')
  //process.exit()
}

var loki_daemon
if (1) {
  var lokid_options = ['--service-node']
  lokid_options.push('--rpc-login='+config.blockchain.rpc_user+':'+config.blockchain.rpc_pass+'')
  if (config.blockchain.network.toLowerCase() == "test" || config.blockchain.network.toLowerCase() == "testnet" || config.blockchain.network.toLowerCase() == "test-net") {
    lokid_options.push('--testnet')
  } else
  if (config.blockchain.network.toLowerCase() == "staging" || config.blockchain.network.toLowerCase() == "stage") {
    lokid_options.push('--stagenet')
  }
  if (!config.launcher.interactive) {
    // we handle the detach, we don't need to detach lokid from us
    lokid_options.push('--non-interactive')
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
  loki_daemon = spawn(config.blockchain.binary_path, lokid_options, {
    stdio: ['pipe', 'inherit', 'inherit'],
    //shell: true
  })
  if (!loki_daemon) {
    console.error('failed to start lokied, exiting...')
    shutdown_everything()
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
      process.exit()
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
