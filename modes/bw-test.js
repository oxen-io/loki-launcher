const networkTest = require(__dirname + '/../lib.networkTest')

function start(config, debug) {
  console.log('connecting to testing server')
  networkTest.createClient('na.testing.lokinet.org', 3000, function(client) {
    console.log('connected')
    client.testUpload(function(results) {
      //console.log('GOT UPLOAD CB')
      console.log('FINAL (remote) RESULTS: bytes per second:', networkTest.formatBytes(results.bytesPerSec), 'from', results.ip)
      client.testDownload(function(results) {
        //console.log('GOT DOWNLOAD CB')
        console.log('FINAL (local) RESULTS: bytes per second:', networkTest.formatBytes(results.bytesPerSec), 'from', results.ip)
        client.disconnect()
      })
    })
  })
}

module.exports = {
  start: start,
}