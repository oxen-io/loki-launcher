// no npm!
const fs        = require('fs')
const os        = require('os')
const { spawn } = require('child_process')
const stdin     = process.openStdin()
const lokinet   = require('./lokinet')

// FIXME: move configs into INI file

// reads ~/.loki/[testnet/]key

//
// start config
//

var lokid_config = {
  binary_location: 'src/loki/build/release/bin/lokid',
  network : "test",
  rpc_ip  : '127.0.0.1',
  rpc_port: 0, // 0 means base on default network port
  rpc_user: 'user',
  rpc_pass: 'pass',
}

var lokinet_config = {
  binary_location : 'src/loki-network/lokinet',
  bootstrap_url   : 'http://206.81.100.174/n-sv-1.signed',
  rpc_ip          : '127.0.0.1',
  rpc_port        : 28083,
  public_port     : 1090,
  // just make them the same for now
  // but build the system so they could be separate
  testnet : lokid_config.network == "test",
}

var lokiStorageServer_config = {
  binary_location : 'src/loki-storage-server/build/httpserver',
  port            : 8080,
  ip              : '127.0.0.1', // this will be overrode by lokinet
}

//
// end config
//

// autoconfig
if (lokid_config.rpc_port === 0) {
  if (lokid_config.network.toLowerCase() == "test" || lokid_config.network.toLowerCase() == "testnet" || lokid_config.network.toLowerCase() == "test-net") {
    lokid_config.rpc_port = 38157
  } else
  if (lokid_config.network.toLowerCase() == "staging" || lokid_config.network.toLowerCase() == "stage") {
    lokid_config.rpc_port = 28082
  } else {
    // main
    lokid_config.rpc_port = 18082
  }
}

// upload lokid to lokinet
lokinet_config.lokid = lokid_config

// ugly hack for Ryan's mac box
if (os.platform() == 'darwin') {
  process.env.DYLD_LIBRARY_PATH = 'depbuild/boost_1_69_0/stage/lib'
}

if (!fs.existsSync(lokid_config.binary_location)) {
  console.error('lokid is not at configured location', lokid_config.binary_location)
  process.exit()
}
if (!fs.existsSync(lokinet_config.binary_location)) {
  console.error('lokinet is not at configured location', lokid_config.binary_location)
  process.exit()
}
if (!fs.existsSync(lokiStorageServer_config.binary_location)) {
  console.error('storageServer is not at configured location', lokid_config.binary_location)
  process.exit()
}

var shuttingDown = false

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

var storageServer
function launcherStorageServer(config, cb) {
  if (shuttingDown) {
    //if (cb) cb()
    console.log('not going to start storageServer, shutting down')
    return
  }
  storageServer = spawn(config.binary_location, [config.ip, config.port])

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
    if (shuttingDown) {
      console.log('loki_daemon is also down, stopping launcher')
    } else {
      console.log('loki_daemon is still running, restarting storageServer')
      launcherStorageServer(config)
    }
  })
  if (cb) cb()
}

if (1) {
  lokinet.startServiceNode(lokinet_config, function() {
    //console.log('trying to get IP information about lokinet')
    lokinet.getLokiNetIP(function(ip) {
      console.log('starting storageServer on', ip)
      lokiStorageServer_config.ip = ip
      launcherStorageServer(lokiStorageServer_config)
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
  if (storageServer) {
    console.log('requesting storageServer be shutdown')
    process.kill(storageServer.pid)
  }
  if (lokinet.isRunning()) {
    lokinet.stop()
  } else {
    console.log('lokinet is not running, trying to exit')
    // lokinet could be waiting to start up
    process.exit()
  }
}

var loki_daemon
if (1) {
  var lokid_options = ['--service-node']
  lokid_options.push('--rpc-login='+lokid_config.rpc_user+':'+lokid_config.rpc_pass+'')
  if (lokid_config.network.toLowerCase() == "test" || lokid_config.network.toLowerCase() == "testnet" || lokid_config.network.toLowerCase() == "test-net") {
    lokid_options.push('--testnet')
    // never hurts to have an extra peer
    //lokid_options.push('--add-peer=206.81.100.174')
    //lokid_options.push('--add-exclusive-node=206.81.100.174:38180')
    lokid_options.push('--add-exclusive-node=159.69.40.252:38156')
  } else
  if (lokid_config.network.toLowerCase() == "staging" || lokid_config.network.toLowerCase() == "stage") {
    lokid_options.push('--stagenet')
  }
  console.log('launching lokid with', lokid_options.join(' '))
  //lokid_options = ['-i0', '-o0', '-e0', lokid_config.binary_location].concat(lokid_options)
  //loki_daemon = spawn('stdbuf', lokid_options, {

  // hijack STDIN but not OUT/ERR
  loki_daemon = spawn(lokid_config.binary_location, lokid_options, {
    stdio: ['pipe', 'inherit', 'inherit'],
    //shell: true
  })
  if (!loki_daemon) {
    console.error('failed to start lokied, exiting...')
    shutdown_everything()
  }

  /*
  loki_daemon.stdout.on('data', (data) => {
    var parts = data.toString().split(/\n/)
    parts.pop()
    data = parts.join('\n')
    if (data.trim()) {
      console.log(`lokid: ${data}`)
    }
  })

  loki_daemon.stderr.on('data', (data) => {
    console.log(`lokiderr: ${data}`)
  })
  */

  loki_daemon.on('close', (code) => {
    console.log(`loki_daemon process exited with code ${code}`)
    shutdown_everything()
  })
}

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
    console.log('lokinet command', remaining)
    if (remaining.match(/^log/i)) {
      var param = remaining.replace(/^log\s*/i, '')
      console.log('lokinet log', param)
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

process.on('SIGHUP', () => {
  console.log('shuttingDown?', shuttingDown)
  console.log('loki_daemon status', loki_daemon)
  console.log('lokinet status', lokinet.isRunning())
})
