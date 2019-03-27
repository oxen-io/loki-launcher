// no npm!
const fs        = require('fs')
const os        = require('os')
const ini       = require('./ini')
const { spawn } = require('child_process')
const stdin     = process.openStdin()
const lokinet   = require('./lokinet')

// reads ~/.loki/[testnet/]key
const ini_bytes = fs.readFileSync('launcher.ini')
var config = ini.iniToJSON(ini_bytes.toString())
console.log('Launcher loaded config:', config)

//
// start config
//

/*
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
*/

//
// end config
//

// defaults
if (config.network.testnet === undefined) {
  config.network.testnet = config.blockchain.testnet == "test"
}

// autoconfig
if (config.blockchain.rpc_port == '0') {
  if (config.blockchain.network.toLowerCase() == "test" || config.blockchain.network.toLowerCase() == "testnet" || config.blockchain.network.toLowerCase() == "test-net") {
    config.blockchain.rpc_port = 38157
  } else
  if (config.blockchain.network.toLowerCase() == "staging" || config.blockchain.network.toLowerCase() == "stage") {
    config.blockchain.rpc_port = 28082
  } else {
    // main
    config.blockchain.rpc_port = 18082
  }
}

// upload lokid to lokinet
config.network.lokid = config.blockchain

// ugly hack for Ryan's mac box
if (os.platform() == 'darwin') {
  process.env.DYLD_LIBRARY_PATH = 'depbuild/boost_1_69_0/stage/lib'
}

if (!fs.existsSync(config.blockchain.binary_path)) {
  console.error('lokid is not at configured location', config.blockchain.binary_path)
  process.exit()
}
if (!fs.existsSync(config.network.binary_path)) {
  console.error('lokinet is not at configured location', config.network.binary_path)
  process.exit()
}
if (!fs.existsSync(config.storage.binary_path)) {
  console.error('storageServer is not at configured location', config.storage.binary_path)
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
  storageServer = spawn(config.binary_path, [config.ip, config.port])

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
  lokid_options.push('--rpc-login='+config.blockchain.rpc_user+':'+config.blockchain.rpc_pass+'')
  if (config.blockchain.network.toLowerCase() == "test" || config.blockchain.network.toLowerCase() == "testnet" || config.blockchain.network.toLowerCase() == "test-net") {
    lokid_options.push('--testnet')
    // never hurts to have an extra peer
    //lokid_options.push('--add-peer=206.81.100.174')
    //lokid_options.push('--add-exclusive-node=206.81.100.174:38180')
    lokid_options.push('--add-exclusive-node=159.69.40.252:38156')
  } else
  if (config.blockchain.network.toLowerCase() == "staging" || config.blockchain.network.toLowerCase() == "stage") {
    lokid_options.push('--stagenet')
  }
  console.log('launching lokid with', lokid_options.join(' '))
  //lokid_options = ['-i0', '-o0', '-e0', lokid_config.binary_location].concat(lokid_options)
  //loki_daemon = spawn('stdbuf', lokid_options, {

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
