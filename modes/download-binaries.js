const fs = require('fs')
const os = require('os')
const lib = require(__dirname + '/../lib')
const lokinet = require(__dirname + '/../lokinet')
const http = require('http')
const https = require('https')
const urlparser = require('url')
const pathUtil = require('path')

const debug = false

// we need this for github header
const VERSION = 0.2
//console.log('loki binary downloader version', VERSION, 'registered')

function getFileSizeSync(path) {
  const stats = fs.statSync(path);
  return stats.size;
}

function downloadGithubFile(dest, url, cb) {

  const urlDetails = urlparser.parse(url)
  //console.log('httpGet url', urlDetails)
  //console.log('httpGet', url)
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
  }, 2 * 60 * 60 * 1000)
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
    if (resp.statusCode == 302) {
      if (debug) console.debug('Got redirect to', resp.headers.location)
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
    resp.pipe(file);
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
    console.error("downloadFile Error: " + err.message, 'port', urlDetails.port)
    //console.log('err', err)
    cb()
  })
}

// MacOS
function downloadZip(url, config) {
  const baseZipDir = pathUtil.basename(url, '.zip')
  console.log('Downloading Loki binaries from', url)
  console.log('')
  var tmpPath = '/tmp/loki-launcher_binaryDownload-' + lokinet.randomString(8) + '.zip'
  //console.log('downloading to tmp file', tmpPath)
  downloadGithubFile(tmpPath, url, function(result) {
    if (result !== undefined) {
      console.log('something went wrong with download, try again later or check with us')
      process.exit(1)
    }
    console.log('')
    //console.log('result is', result)
    if (url.match(/\.zip/i)) {
      const { exec } = require('child_process');

      // FIXME: refactor out
      function waitForLokidToBeDeadAndExtract() {
        running = lib.getProcessState(config)
        if (running.lokid) {
          console.log('waiting 5s for lokid to quit...')
          setTimeout(waitForLokidToBeDeadAndExtract, 5000)
          return
        }
        // we could do this check earlier
        // but maybe we'll add support in the future
        if (os.platform() == 'darwin') {
          console.log('Unzipping')
          exec('tar xvf '+tmpPath+' --strip-components=1 -C /opt/loki-launcher/bin '+baseZipDir+'/lokid', (err, stdout, stderr) => {
            // delete tmp file
            if (1) {
              //console.debug('cleaning up', tmpPath)
              fs.unlinkSync(tmpPath)
            }
            if (err) {
              console.error('file extract error', err)
              return
            }
            console.log('Unzip Success')
            //console.log('stdout', stdout)
            //console.log('lokid extracted to /opt/loki-launcher/bin', getFileSizeSync('/opt/loki-launcher/bin/lokid'), 'bytes extracted')
          })
        } else {
          // how to extract a zip on linux?
          console.error('Do not know how to extract zips on linux')
          process.exit(1)
        }
      }
      waitForLokidToBeDeadAndExtract()
    }
  })
}

// Linux
function downloadTarXz(url, config) {
  const baseArchDir = pathUtil.basename(url, '.tar.xz')
  console.log('Downloading Loki binaries from', url)
  console.log('')
  var tmpPath = '/tmp/loki-launcher_binaryDownload-' + lokinet.randomString(8) + '.tar.xz'
  //console.log('downloading to tmp file', tmpPath)
  downloadGithubFile(tmpPath, url, function(result) {
    if (result !== undefined) {
      console.log('something went wrong with download, try again later or check with us')
      process.exit(1)
    }
    //console.log('result is', result)
    if (url.match(/\.tar.xz/i)) {
      const { exec } = require('child_process');

      function waitForLokidToBeDeadAndExtract() {
        running = lib.getProcessState(config)
        if (running.lokid) {
          console.log('waiting 5s for lokid to quit...')
          setTimeout(waitForLokidToBeDeadAndExtract, 5000)
          return
        }
        console.log('Untarring')
        exec('tar xvf '+tmpPath+' --strip-components=1 -C /opt/loki-launcher/bin '+baseArchDir+'/lokid', (err, stdout, stderr) => {
          // delete tmp file
          if (1) {
            //console.debug('cleaning up', tmpPath)
            fs.unlinkSync(tmpPath)
          }
          if (err) {
            console.error('file extract error', err)
            return
          }
          console.log('Untar Success')
          //console.log('stdout', stdout)
          //console.log('lokid extracted to /opt/loki-launcher/bin', getFileSizeSync('/opt/loki-launcher/bin/lokid'), 'bytes extracted')
        })
      }
      waitForLokidToBeDeadAndExtract()
    }
  })
}

var start_retries = 0
function start(config) {
  var running = lib.getProcessState(config)
  if (running.lokid) {
    var pids = lib.getPids(config)
    console.log('lokid is running, request shutdown')
    process.kill(pids.lokid, 'SIGINT')
    // should be down by the time the file downloads...
  }
  // deb support? nope, you use apt to update...
  lokinet.mkDirByPathSync('/opt/loki-launcher/bin')
  const github_url = 'https://api.github.com/repos/loki-project/loki/releases/latest'
  lokinet.httpGet(github_url, function(json) {
    if (json === undefined) {
      // possibly a 403
      start_retries++
      if (start_retries < 10) {
        setTimeout(function() {
          console.log('retrying...')
          start(config)
        }, 60 * 1000)
      } else {
        console.warn('failure communicating with api.github.com')
      }
      return;
    }
    try {
      var data = JSON.parse(json)
    } catch(e) {
      console.debug('json', json)
      console.error('error with', github_url, e)
      process.exit(1)
    }
    // FIXME: compare against version we have downloaded...
    // FIXME: how can we get the version of a binary?
    var search = 'UNKNOWN'
    if (os.platform() == 'darwin') search = 'osx'
    else
    if (os.platform() == 'linux') search = 'linux'
    else {
      console.error('Sorry, platform', os.platform(), 'is not currently supported, please let us know you would like us to support this platform by opening an issue on github: https://github.com/loki-project/loki-launcher/issues')
      process.exit(1)
    }
    var searchRE = new RegExp(search, 'i');
    for(var i in data.assets) {
      var asset = data.assets[i]
      //console.log(i, 'asset', asset.browser_download_url)
      if (search == 'linux' && asset.browser_download_url.match(searchRE) && asset.browser_download_url.match(/\.tar.xz/i)) {
        // linux
        downloadTarXz(asset.browser_download_url, config)
      }
      if (search == 'osx' && asset.browser_download_url.match(searchRE) && asset.browser_download_url.match(/\.zip/i)) {
        // MacOS
        downloadZip(asset.browser_download_url, config)
      }
    }
  })
}

module.exports = {
  start: start,
}
