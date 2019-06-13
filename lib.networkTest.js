const slice = 10
const blocksPerTick = 100

const VERSION = 0.1

// FIXME: lock, so only one uploadTest can run at a time
function createClient(host, port, cb, debug) {
  const netWrap = require('./lets_tcp')
  netWrap.debug = debug

  var timer = null
  var uiTimer = null
  var ticks = 0
  var count = 0
  var ip = null
  var testCallback = null
  var portTestCallback = null
  var shutdownOk = false
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
      console.warn('port test timed out')
      if (portTestCallback) {
        var callMe = portTestCallback
        portTestCallback = null
        callMe({
          ip: '127.0.0.1',
          result: 'unknown',
          code: 'unknown'
        })
      }
    }, 60 * 1000)
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
    //console.log('got', pkt, 'from', client.socket.address().address)
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
        console.log('got report')
        clearTimeout(timeoutTimer)
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
        console.log('got', pkt, 'from', client.socket.address().address)
      break
    }
  }

  netWrap.disconnect = function(client) {
    if (!shutdownOk) {
      console.log('got disconnected, stopping any pending tests')
    }
    stopTest()
  }

  var aborted = false
  var connectTimeoutTimer = setTimeout(function() {
    cb(false)
    aborted = true
  }, 60 * 1000)
  netWrap.connectTCP(host, port, function(client) {
    clearTimeout(connectTimeoutTimer)
    // don't reconnect on disconnect (so we can actually force a disconnect when done)
    client.reconnect = false
    // prevent additional processing
    if (aborted) return
    cb({
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
      disconnect: function() {
        client.reconnect = false
        shutdownOk = true
        //client.disconncet()
        client.destroy() // cause a disconnect
        client.socket.destroy()
      }
    })
  })
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
