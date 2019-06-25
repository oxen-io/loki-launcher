// no npm!
const fs        = require('fs')
const os        = require('os')
const net       = require('net')
const lib       = require(__dirname + '/../lib')
const { spawn } = require('child_process')
const stdin     = process.openStdin()

const VERSION = 0.2

function clientConnect(config) {
  console.log('trying to connect to', config.launcher.var_path + '/launcher.socket')
  const client = net.createConnection({ path: config.launcher.var_path + '/launcher.socket' }, () => {
    // 'connect' listener
    console.log('connected to server!')
    console.log('Remember to use ctrl-c to exit the client without shutting down the service node')
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
}

module.exports = function(config) {
  //
  // are we already running
  //
  var pid = lib.areWeRunning(config)
  if (!pid) {
    console.log("launcher isn't running")
    // we just started it up...?
    function socketReady(cb) {
      // FIXME: even if the file exists, doesn't mean it works...
      if (!fs.fileExistsSync(config.launcher.var_path + '/launcher.socket')) {
        console.log('waiting for launcher to start, ctrl-c to stop waiting')
        setTimeout(function() {
          socketReady(cb);
        }, 1000)
        return
      }
      cb()
    }
    /*
    socketReady(function() {
      console.log('located launcher daemon at', pid)
      clientConnect(config)
    })
    */
    process.exit(1)
  } else {
    console.log('located launcher daemon at', pid)
    clientConnect(config)
  }
}
