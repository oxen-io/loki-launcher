const slice = 10
const blocksPerTick = 100

const VERSION = 0.1

// FIXME: lock, so only one uploadTest can run at a time
function createClient(host, port, cb) {
  const netWrap = require('./lets_tcp')

  var timer = null
  var uiTimer = null
  var ticks = 0
  var count = 0
  var ip = null
  var testCallback = null
  var portTestCallback = null
  var shutdownOk = false

  function startUploadTest(client) {
    // start test
    console.log('starting upload test')
    client.send('start')
    count = 0
    uiTimer = setInterval(function() {
      count++
      if (count % 5 == 0) {
        console.log('test has been running for', count)
      }
      // back up, incase something goes wrong?!?
      if (count > 120) {
        stopTest()
        client.destroy() // cause a disconnect
      }
    }, 1000)
    // send roughly 64k per 1ms (640k per 10ms)
    const block = 'data '+'0123456789'.repeat(100 * 64)
    timer = setInterval(function() {
      for(var i = 0; i < blocksPerTick; i++) {
        client.send(block)
      }

      ticks++
    }, slice)
  }

  var timeoutTimer = null
  function startPortTest(client, port) {
    //console.log('starting port test for', port)
    client.send('port ' + port)
    timeoutTimer = setTimeout(function() {
      console.log('port test timed out')
      if (portTestCallback) {
        portTestCallback({
          ip: '127.0.0.1',
          result: 'unknown',
          code: 'unknown'
        })
      }
    }, 60 * 1000)
  }

  function stopTest() {
    if (timer) clearInterval(timer)
    if (uiTimer) clearInterval(uiTimer)
  }

  netWrap.recv = function(pkt, client) {
    //console.log('got', pkt, 'from', client.socket.address().address)
    var parts = pkt.split(/ /)
    var w0    = parts[0]
    switch(w0) {
      case 'ip':
        console.log('my public ip is maybe', parts[1])
        ip = parts[1]
      break
      case 'stop':
        console.log('stopping request after', count, 's and', ticks, 'ticks, attempted to send', formatBytes(blocksPerTick * ticks * 65535), 'which is', formatBytes(blocksPerTick * ticks * 65535 / count)+'/s')
        stopTest()
        if (testCallback) {
          testCallback({
            ip: ip,
            uploadBytesPerSec: parts[1],
          })
        }
      break
      case 'report':
        clearTimeout(timeoutTimer)
        if (portTestCallback) {
          portTestCallback({
            ip: ip,
            result: parts[1],
            code: parts[2]
          })
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
        testCallback = cb
        startUploadTest(client)
      },
      testPort: function(port, cb) {
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
