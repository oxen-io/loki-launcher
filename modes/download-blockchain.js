const fs = require('fs')
const http  = require('http')
const https = require('https')
const urlparser = require('url')
// to stop the launcher
const lib       = require(__dirname + '/../lib')
// for mkdirp
const lokinet   = require(__dirname + '/../lokinet')

const cp  = require('child_process')
const execSync = cp.execSync

const debug = false

// we need this for github header
const VERSION = 0.3
//console.log('loki binary downloader version', VERSION, 'registered')

let xenial_hack = false

// mainly different timeouts
function downloadBlockchainFile(dest, url, cb) {
  const urlDetails = urlparser.parse(url)
  //console.log('downloadBlockchainFile url', urlDetails)
  //console.log('downloadBlockchainFile', url)
  var protoClient = http
  if (urlDetails.protocol == 'https:') {
    protoClient = https
  }
  // well somehow this can get hung on macos
  var abort = false
  var watchdog = setInterval(function () {
    if (shuttingDown) {
      //if (cb) cb()
      // [', url, ']
      console.log('hung httpGet but have shutdown request, calling back early and setting abort flag')
      clearInterval(watchdog)
      abort = true
      cb(false)
      return
    }
  }, 2 * 86400)
  protoClient.get({
    hostname: urlDetails.hostname,
    protocol: urlDetails.protocol,
    port: urlDetails.port,
    path: urlDetails.path,
    timeout: 5000,
    headers: {
      'User-Agent': 'Mozilla/5.0 Loki-launcher/' + VERSION
    }
  }, (resp) => {
    //log('httpGet setting up handlers')
    clearInterval(watchdog)
    if (resp.statusCode === 302 || resp.statusCode === 301) {
      if (debug) console.debug('downloadBlockchainFile - Got redirect to', resp.headers.location)
      downloadGithubFile(dest, resp.headers.location, cb)
      return
    }
    var file = fs.createWriteStream(dest, { encoding: 'binary' })
    resp.setEncoding('binary')
    const len = parseInt(resp.headers['content-length'], 10)
    var downloaded = 0
    var lastPer = 0
    resp.on('data', function(chunk) {
      downloaded += chunk.length
      var tenPer = parseInt(10 * downloaded / len, 10)
      //console.log('tenper', tenper, downloaded / len)
      if (tenPer != lastPer) {
        var haveMBs = downloaded / (1024 * 1024)
        var totalMBs = len / (1024 * 1024)
        console.log('Downloaded', (tenPer * 10) + '%', haveMBs.toFixed(2) + '/' + totalMBs.toFixed(2) +'MBi')
        lastPer = tenPer
      }
    })
    resp.pipe(file)
    file.on('finish', function() {
      //console.log('File download ', downloaded, '/', len, 'bytes of', url, 'complete')
      if (downloaded < len) {
        console.warn('file is incomplete, please try again later...')
        fs.unlinkSync(dest)
        process.exit(1)
      }
      file.close(cb)
    })
  }).on("error", (err) => {
    console.error("downloadBlockchainFile - Error: " + err.message, 'port', urlDetails.port)
    //console.log('err', err)
    cb()
  })
}

// FIXME: move into options
var start_retries = 0
function start(config, options) {
  return new Promise(resolve => {
    /*
    const { exec } = require('child_process')
    exec('lsb_release -c', (err, stdout, stderr) => {
      //console.log(stdout)
      if (stdout && stdout.match(/xenial/)) {
        xenial_hack = true
      }
    })
    */
    // quick request so should be down by the time the file downloads...
    lib.stopLauncher(config)

    // make sure ~/.loki/data exits
    const lmdbDir = config.blockchain.data_dir + '/lmdb'
    console.log('lmdbDir', lmdbDir)
    lokinet.mkDirByPathSync(lmdbDir)

    var mdbFilePath = lmdbDir + '/data.mdb'
    if (fs.existsSync(mdbFilePath)) {
      console.log('removing old blockchain')
      fs.unlinkSync(mdbFilePath)
    }

    const pingMap = {}
    function checkDone(label, value) {
      // console.log(label, 'avgPing', value)
      pingMap[label] = value
      if (Object.keys(pingMap).length === 2) {
        // https://imaginary.stream/loki/data.mdb
        // https://public.loki.foundation/loki/data.mdb
        // https://public.loki.foundation/loki/data.mdb.md5sum
        let url = 'https://' + (pingMap['ca'] > pingMap['eu'] ? 'public.loki.foundation' : 'imaginary.stream')
        url += '/loki/data.mdb'
        console.log('downloading', url)
        downloadBlockchainFile(mdbFilePath, url, function(result) {
          if (result !== undefined) {
            console.log('something went wrong with download, try again later or check with us')
            process.exit(1)
          }
          resolve(true)
        })
      }
    }

    console.log('detecting best source')
    const ca = cp.execFile('/bin/ping', ['-n', '-c5', 'imaginary.stream'], function(error, stdout, stderr) {
      if (error) console.error(error)
      var avg = []
      for(line of stdout.split('\n')) {
        if (line.match(/time=/)) {
          const parts = line.split(/time=/)
          const ms = parts[1].replace(' ms', '')
          avg.push(parseInt(ms * 100))
        }
      }
      const avgPing = avg.reduce((a, b) => a + b, 0) / avg.length
      checkDone('ca', avgPing)
    })
    const eu = cp.execFile('/bin/ping', ['-n', '-c5', 'public.loki.foundation'], function(error, stdout, stderr) {
      if (error) console.error(error)
      var avg = []
      for(line of stdout.split('\n')) {
        if (line.match(/time=/)) {
          const parts = line.split(/time=/)
          const ms = parts[1].replace(' ms', '')
          avg.push(parseInt(ms * 100))
        }
      }
      const avgPing = avg.reduce((a, b) => a + b, 0) / avg.length
      checkDone('eu', avgPing)
    })
  })
}

module.exports = {
  start: start,
}
