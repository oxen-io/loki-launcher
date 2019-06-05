#!/usr/bin/env node
// no npm!
const os = require('os')
const VERSION = 0.7

if (os.platform() == 'darwin') {
  if (process.getuid() != 0) {
    console.error('MacOS requires you start this with sudo, i.e. # sudo ' + __filename)
    process.exit()
  }
} else {
  if (process.getuid() == 0) {
    console.error('Its not recommended you run this as root')
  }
}

// preprocess command line arguments
var args = process.argv
function stripArg(match) {
  var found = false
  for (var i in args) {
    var arg = args[i]
    if (arg == match) {
      args.splice(i, 1)
      found = true
    }
  }
  return found
}
stripArg('/usr/local/bin/node')
stripArg('/usr/local/bin/nodejs')
stripArg('/usr/bin/node')
stripArg('/usr/bin/nodejs')
stripArg('node')
stripArg('nodejs')
stripArg(__filename)
//console.log('Launcher arguments:', args)

// find the first arg without --
var mode = ''
for(var i in args) {
  var arg = args[i]
  if (arg.match(/^-/)) continue
  //console.log('command', arg)
  if (mode == '') mode = arg
}

//console.log('mode', mode)
stripArg(mode)

// load config from disk
const fs = require('fs')
const ini = require(__dirname + '/ini')
const ini_bytes = fs.readFileSync(__dirname + '/launcher.ini')
var disk_config = ini.iniToJSON(ini_bytes.toString())
config = disk_config

if (config.blockchain.rpc_port == '0') {
  if (config.blockchain.network == 'test') {
    config.blockchain.rpc_port = 38157
  } else
  if (config.blockchain.network == 'demo') {
    config.blockchain.rpc_port = 38160
  } else
  if (config.blockchain.network == 'staging') {
    config.blockchain.rpc_port = 38154
  } else {
    // main
    config.blockchain.rpc_port = 22023
  }
}

const lib = require(__dirname + '/lib')
//console.log('Launcher config:', config)
var logo = lib.getLogo('L A U N C H E R   v e r s i o n   v version')
console.log(logo.replace(/version/, VERSION.toString().split('').join(' ')))

const http = require('http')
const https = require('https')
const urlparser = require('url')

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
      console.log('Got redirect to', resp.headers.location)
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
        console.log('Downloaded', tenPer * 10, '%')
        lastPer = tenPer
      }
    })
    resp.pipe(file);
    file.on('finish', function() {
      console.log('File download ', downloaded, '/', len, 'bytes of', url, 'complete')
      if (downloaded < len) {
        console.log('file is incomplete')
      }
      file.close(cb)
    })
  }).on("error", (err) => {
    console.error("downloadFile Error: " + err.message, 'port', urlDetails.port)
    //console.log('err', err)
    cb()
  })
}


switch(mode) {
  case 'start':
    require('./start')(args, __filename)
  break;
  case 'daemon-start':
    process.env.__daemon = true
    require('./start')(args)
  break;
  case 'status':
    console.log('coming soon')
  break;
  case 'config-build':
    // build a default config
    // commit it to disk if it doesn't exist
  break;
  case 'config-view':
    console.log('loki-launcher is in', __dirname)
    console.log('Launcher config:', config)
  break;
  case 'config-edit':
    // xdg-open / open ?
  break;
  case 'client':
    require('./client')
  break;
  case 'prequal':
    require('./snbench')(config, false)
  break;
  case 'prequal-debug':
    require('./snbench')(config, true)
  break;
  case 'args-debug':
    console.log('in :', process.argv)
    console.log('out:', args)
  break;
  case 'download-binaries':
    const lib = require('./lib')
    const lokinet = require('./lokinet')

    var running = lib.getProcessState()
    if (running.lokid) {
      console.log('lokid is running, request shutdown')
      process.kill(pids.lokid, 'SIGINT')
      // should be down by the time the file downloads...
    }
    lokinet.mkDirByPathSync('/opt/loki-launcher/bin')
    const github_url = 'https://api.github.com/repos/loki-project/loki/releases/latest'
    lokinet.httpGet(github_url, function(json) {
      try {
        var data = JSON.parse(json)
        var search = 'UNKNOWN'
        if (os.platform() == 'darwin') search = 'osx'
        else
        if (os.platform() == 'linux') search = 'linux'
        else {
          console.log('Sorry, platform', os.platform(), 'is not currently supported, please let us know you would like us to support this platform by opening an issue on github: https://github.com/loki-project/loki-launcher/issues')
          process.exit()
        }
        var searchRE = new RegExp(search, 'i');
        const pathUtil = require('path')
        for(var i in data.assets) {
          var asset = data.assets[i]
          //console.log(i, 'asset', asset.browser_download_url)
          if (asset.browser_download_url.match(searchRE) && asset.browser_download_url.match(/\.zip/i)) {
            const baseZipDir = pathUtil.basename(asset.browser_download_url, '.zip')
            console.log('Will download', asset.browser_download_url)
            var tmpPath = '/tmp/loki-launcher_binaryDownload-' + lokinet.randomString(8) + '.zip'
            //console.log('downloading to tmp file', tmpPath)
            downloadGithubFile(tmpPath, asset.browser_download_url, function(result) {
              if (result !== undefined) {
                console.log('something went wrong with download, try again later or check with us')
                process.exit()
              }
              console.log('result is', result)
              if (asset.browser_download_url.match(/\.zip/i)) {
                const { exec } = require('child_process');

                function waitForLokidToBeDeadAndExtract() {
                  running = lib.getProcessState()
                  if (running.lokid) {
                    console.log('waiting 5s for lokid to quit...')
                    setTimeout(waitForLokidToBeDeadAndExtract, 5000)
                    return
                  }
                  exec('tar xvf '+tmpPath+' --strip-components=1 -C /opt/loki-launcher/bin '+baseZipDir+'/lokid', (err, stdout, stderr) => {
                    // delete tmp file
                    if (1) {
                      console.log('cleaning up', tmpPath)
                      fs.unlinkSync(tmpPath)
                    }
                    if (err) {
                      console.error('file extract error', err)
                      return
                    }
                    console.log('stdout', stdout)
                    console.log('lokid extracted to /opt/loki-launcher/bin', getFileSizeSync('/opt/loki-launcher/bin/lokid'), 'bytes extracted')
                  })
                }
                waitForLokidToBeDeadAndExtract()
              }
            })
          }
        }
      } catch(e) {
        console.log('json', json)
        console.log('error with', github_url, e)
        process.exit()
      }
    })
  break;
  default:
    console.log(`
Unknown mode [${mode}]

loki-launcher is manages the Loki.network suite of software primarily for service node operation
Usage:
  loki-launcher [mode] [OPTIONS]

  Modes:
    start   start the loki suite with OPTIONS
    status  get the current loki suite status
    client  connect to lokid
    prequal prequalify your server for service node operation
`)
  break;
}
