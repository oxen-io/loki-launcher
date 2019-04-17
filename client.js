// no npm!
const fs        = require('fs')
const os        = require('os')
const net       = require('net')
const lib       = require('./lib')
const { spawn } = require('child_process')
const stdin     = process.openStdin()

const VERSION = 0.1

var logo = lib.getLogo('L A U N C H E R   c l i e n t   v version')
console.log(logo.replace(/version/, VERSION.toString().split('').join(' ')))

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

//
// are we already running
//

var alreadyRunning = false
if (fs.existsSync('launcher.pid')) {
  // we are already running
  var pid = fs.readFileSync('launcher.pid', 'utf8')
  if (lib.isPidRunning(pid)) {
    alreadyRunning = true
  } else {
    console.log('stale launcher.pid')
    pid = 0
  }
}

/*
var pids = lib.getPids()
var anyOldRunning = false
if (!alreadyRunning) {
  if (pids.lokid && lib.isPidRunning(pids.lokid)) {
    console.log("old lokid is still running", pids.lokid)
    anyOldRunning = true
  }
  if (pids.lokinet && lib.isPidRunning(pids.lokinet)) {
    console.log("old lokinet is still running", pids.lokinet)
    anyOldRunning = true
  }
  if (pids.storageServer && lib.isPidRunning(pids.storageServer)) {
    console.log("old storage server is still running", pids.storageServer)
    anyOldRunning = true
  }
  if (!anyOldRunning) {
    console.log("Nothing old running")
  }
}
*/

// if already running just connect for now

if (!alreadyRunning) {
  console.log("launcher isn't running")
  stdin.pause()
  return
}

if (pid) {
  console.log('located launcher daemon at', pid)
} else {
  // we just started it up...
  // FIXME: probably should wait for socket to be created
}

console.log('trying to connect to launcher.socket')
const client = net.createConnection({ path: 'launcher.socket' }, () => {
  // 'connect' listener
  console.log('connected to server!')
  //client.write('world!\r\n')
})
//client.setEncoding('utf-8')
client.on('error', (err) => {
  console.error('error', err)
})
var lastcommand = ''
client.on('data', (data) => {
  //console.log('FROM SOCKETraw:', data.slice(data.length - 4, data.length))
  //console.log('lastcommand', lastcommand)
  var stripped = data.toString().replace(lastcommand, '').trim()
  //var buf = Buffer.from(stripped, 'utf8')
  //console.log(buf)
  /*
  if (stripped.match(/\r\n/)) console.log('has windows newline')
  else {
    if (stripped.match(/\n/)) console.log('has newline')
    if (stripped.match(/\r/)) console.log('has return')
  }
  */
  // remove terminal codes
  stripped = stripped.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').trim()
  if (!stripped) return // don't echo empty lines...

  // why does this work?
  /*
  if (stripped[stripped.length - 1] == 'm') {
    console.log('FROm SOCKET:', stripped.substr(0, stripped.length - 1))
  } else {
    //console.log('FROM SOCKET:', stripped, 'last', stripped[stripped.length - 1])
    */
  console.log('FROM SOCKET:', stripped)
  //}
  //client.end()
})
client.on('end', () => {
  console.log('disconnected from server')
  process.exit()
})


// hijack stdin
stdin.resume()
// i don't want binary, do you?
stdin.setEncoding( 'utf8' )

// on any data into stdin
var state = '', session = {}
stdin.on('data', function(str) {
  // confirm on exit?
  lastcommand = str
  if (lastcommand.trim() == "exit") {
    console.log("SHUTTING DOWN SERVICE NODE and this client, will end when SN is shutdown")
    // FIXME: prompt
  }
  client.write(str, 'utf8')
})
