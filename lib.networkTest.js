const lokinet = require(__dirname + '/lokinet') // expects 0.8 used for randomString
const netWrap = require('./lets_tcp')

const dgram = require('dgram')
const udpClient = dgram.createSocket('udp4')

const slice = 10
const blocksPerTick = 100

const VERSION = 0.1

// FIXME: lock, so only one uploadTest can run at a time
function createClient(host, port, cb, debug) {
  //console.log('creating Client')
  netWrap.debug = debug

  var timer = null
  var uiTimer = null
  var intTimer = null
  var ticks = 0
  var count = 0
  var ip = null
  var testCallback = null
  var portTestCallback = null
  var shutdownOk = false
  var shutdownFinal = false
  var testResults = 0

  var downloadBytes = 0
  var blocksSent = 0

  function startUploadTest(client) {
    // start test
    console.log('starting upload test')
    client.send('start')
    count = 0
    uiTimer = setInterval(function() {
      count++
      if (count % 5 == 0) {
        console.log('upload test has been running for', count)
      }
      // back up, incase something goes wrong?!?
      if (count > 120) {
        stopTest()
        client.destroy() // cause a disconnect
        // call back? or exit?
      }
    }, 1000)
    /*
    client.socket.on('drain', function() {
      console.log('got drain')
    })
    */
    // send roughly 64k per 1ms (640k per 10ms)
    const block = 'data '+'0123456789'.repeat(100 * 64)
    timer = setInterval(function() {
      for(var i = 0; i < blocksPerTick; i++) {
        client.send(block)
        blocksSent++
        if (!client.readyToSend) {
          break
        }
      }

      ticks++
    }, slice)
  }

  function startDownloadTest(client) {
    if (uiTimer != null) {
      console.error("Can't start download test because another test is running")
      return
    }
    // start test
    console.log('starting download test')
    client.send('startDownload')
    downloadBytes = 0
    count = 0
    uiTimer = setInterval(function() {
      count++
      if (count % 5 == 0) {
        console.log('downlaod test has been running for', count)
      }
      // back up, incase something goes wrong?!?
      if (count > 120) {
        stopTest()
        client.destroy() // cause a disconnect
        // call back? or exit?
      }
    }, 1000)
    // send roughly 64k per 1ms (640k per 10ms)
    /*
    const block = 'data '+'0123456789'.repeat(100 * 64)
    timer = setInterval(function() {
      for(var i = 0; i < blocksPerTick; i++) {
        client.send(block)
      }

      ticks++
    }, slice)
    */
  }

  var timeoutTimer = null
  function startPortTest(client, port) {
    //console.log('starting port test for', port)
    client.send('port ' + port)
    timeoutTimer = setTimeout(function() {
      //console.warn('port test timed out')
      if (portTestCallback) {
        var callMe = portTestCallback
        portTestCallback = null
        callMe({
          ip: '127.0.0.1',
          result: 'unknown',
          code: 'unknown'
        })
      }
    }, 10 * 1000)
  }

  function stopTest() {
    if (timer) {
      if (debug) console.log('Stopping timer')
      clearInterval(timer)
      timer = null
    }
    if (uiTimer) {
      if (debug) console.log('Stopping uiTimer')
      clearInterval(uiTimer)
      uiTimer = null
    }
    if (timeoutTimer) {
      clearInterval(timeoutTimer)
      timeoutTimer = null
    }
    if (testCallback) {
      var callMe = testCallback
      testCallback = null
      callMe({
        ip: ip,
        bytesPerSec: testResults,
      })
    }
  }

  netWrap.recv = function(pkt, client) {
    //console.log('got', pkt, 'to', client.socket.address().address)
    if (debug) console.log('got', pkt, 'from', client.socket.remoteAddress)
    var parts = pkt.split(/ /)
    var w0    = parts[0]
    switch(w0) {
      case 'ip':
        if (debug) console.log('Your public IP address is', parts[1])
        ip = parts[1]
      break
      case 'data':
        // just count the bytes
        downloadBytes += str.length
      break
      case 'stop':
        console.log('stopping request after', count, 's and', ticks, 'ticks, attempted to send', blocksSent, 'blocks which totals', formatBytes(blocksSent * 65535), 'which is', formatBytes(blocksSent * 65535 / count)+'/s')
        testResults = parts[1]
        stopTest()
      break
      case 'report':
        //console.log('got report')
        clearTimeout(timeoutTimer)
        clearInterval(intTimer)
        if (portTestCallback) {
          portTestCallback({
            ip: ip,
            result: parts[1],
            code: parts[2]
          })
          portTestCallback = null
        }
      break
      default:
        console.log('got unknown pkt', pkt, 'from', client.socket.address().address)
      break
    }
  }

  netWrap.disconnect = function(socket, isClient) {
    // only if the client disconnects...
    if (isClient) {
      if (!shutdownFinal) {
        console.log(socket.name, 'got disconnected, aborting any pending tests.')
        stopTest()
        process.exit()
      } else {
        if (debug) console.debug('Successfully disconnected from testing server')
      }
    } else {
      if (debug) console.debug('got server disconnect')
    }
  }

  var aborted = false
  var connectTimeoutTimer = setTimeout(function() {
    cb(false)
    aborted = true
  }, 60 * 1000)
  netWrap.connectTCP(host, port, function(client) {
    //console.log('connectTCP')
    clearTimeout(connectTimeoutTimer)
    // don't reconnect on disconnect (so we can actually force a disconnect when done)
    client.reconnect = false
    // prevent additional processing
    if (aborted) return
    let publicClient = {
      testUpload: function(cb) {
        if (testCallback) {
          console.log('a test is already running')
          return
        }
        testCallback = cb
        startUploadTest(client)
      },
      testDownload: function(cb) {
        if (testCallback) {
          console.log('a test is already running')
          return
        }
        testCallback = cb
        startDownloadTest(client)
      },
      testPort: function(port, cb) {
        if (portTestCallback) {
          console.log('a test is already running')
          return
        }
        portTestCallback = cb
        startPortTest(client, port)
      },
      testUDPRecvPort: function(port, cb) {
        if (portTestCallback) {
          console.log('a test is already running')
          return
        }
        // set lock
        portTestCallback = cb
        // create failure case
        timeoutTimer = setTimeout(function() {
          //console.warn('port test timed out')
          clearInterval(intTimer)
          if (portTestCallback) {
            var callMe = portTestCallback
            portTestCallback = null
            callMe({
              ip: '127.0.0.1',
              result: 'unknown',
              code: port
            })
          }
        }, 10 * 1000)
        // sent 5 packets, only need one
        intTimer = setInterval(function() {
          client.send('udpsendport ' + port)
        }, 1000)
      },
      testUDPSendPort: function(localPort, destPort, cb) {
        if (portTestCallback) {
          console.log('a test is already running')
          return
        }
        const safeLocalPort = parseInt(localPort)
        const safeDestPort = parseInt(destPort)
        if (!safeDestPort) {
          console.error('invalid destination port', safeDestPort)
          return
        }
        portTestCallback = function(res) {
          udpClient.close() // close server
          cb(res.result, res.code)
        }
        //client.send('udprecvport ' + port)
        const message = Buffer.from('Some bytes')
        // 1090 here is a destination port
        udpClient.bind(safeLocalPort, function() {
          timeoutTimer = setTimeout(function() {
            //console.warn('port test timed out')
            clearInterval(intTimer)
            if (portTestCallback) {
              var callMe = portTestCallback
              portTestCallback = null
              callMe({
                ip: '127.0.0.1',
                result: 'unknown',
                code: safeDestPort
              })
            }
          }, 5 * 1000)
          intTimer = setInterval(function() {
            udpClient.send(message, safeDestPort, host, function() {
              // done sending...
              // server will send to us if we're connect if it receives it: report good
            })
          }, 1000)
        })
      },
      disconnect: function() {
        //console.log('lib.networkTest - disconnecting')
        shutdownFinal = true
        client.send('dc')
        client.reconnect = false
        //client.disconncet()
        client.destroy() // cause a disconnect
        client.socket.destroy()
        shutdownOk = true
      }
    }
    // I really don't like this
    publicClient.startTestingServer = function(port, debug, cb) {
      startTestingServer(port, publicClient, debug, cb)
    }
    publicClient.startUDPRecvTestingServer = function(port, debug, cb) {
      startUDPRecvTestingServer(port, publicClient, debug, cb)
    }
    cb(publicClient)
  })

  // open port test by starting a network server on specified port
  function startTestingServer(port, networkTester, debug, cb) {
    // FIXME: make sure port isn't already taken
    var code = lokinet.randomString(96)
    var tempResponder = netWrap.serveTCP(port, function(incomingConnection) {
      if (debug) console.debug('port verified')
      // request shutdown of the tcp connection from server side
      //incomingConnection.send('quit ' + code + ' ' + Date.now())
    })
    tempResponder.errorHandler = function(err) {
      if (err.code == 'EADDRINUSE') {
        tempResponder.letsClose(function() {
          cb('inuse', port)
        })
        return
      } else {
        if (err) console.error('serveTCP problem:', err)
      }
    }
    networkTester.testPort(port, function(results) {
      if (debug) console.debug('port test complete', results)
      shutdownOk = true
      tempResponder.letsClose(function() {
        cb(results.result, port)
      })
    })
  }

  function startUDPRecvTestingServer(port, networkTester, debug, cb) {
    // FIXME: make sure port isn't already taken
    var code = lokinet.randomString(96)
    var tempResponder = netWrap.serveUDP(port, function(message, rinfo) {
      var str = message.toString()
      //console.log('message', str)
      if (str === 'Some bytes') {
        if (debug) console.debug('port verified')
        clearTimeout(timeoutTimer)
        clearInterval(intTimer)
        portTestCallback = null // release test lock
        shutdownOk = true
        tempResponder.letsClose(function() {
          cb('good', port)
        })
      }
    })
    if (!tempResponder) {
      console.error('could not bind to port', port)
      cb('cantbind', port)
      return
    }
    tempResponder.errorHandler = function(err) {
      if (err.code == 'EADDRINUSE') {
        portTestCallback = null // release test lock
        clearTimeout(timeoutTimer)
        clearInterval(intTimer)
        shutdownOk = true
        tempResponder.letsClose(function() {
          cb('inuse', port)
        })
        return
      } else {
        if (err) console.error('serveUDP problem:', err)
      }
    }

    // set up test, and ask servers to hit us
    networkTester.testUDPRecvPort(port, function(results) {
      // only called on timeout
      portTestCallback = null // release lock (points to this function actually)
      clearTimeout(timeoutTimer)
      clearInterval(intTimer)
      shutdownOk = true
      if (tempResponder.letsClose) {
        tempResponder.letsClose(function() {
          cb(results.result, results.code)
        })
      } else {
        console.log('tempResponder doesnt have letsClose', tempResponder)
        cb(results.result, results.code)
      }
    })
  }

}

// from https://stackoverflow.com/a/18650828
function formatBytes(bytes, decimals = 2) {
  if(bytes == 0) return '0 Bytes'
  var k = 1024,
     dm = decimals <= 0 ? 0 : decimals || 2,
     sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'],
     i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

module.exports = {
  createClient: createClient,
  formatBytes: formatBytes,
}
