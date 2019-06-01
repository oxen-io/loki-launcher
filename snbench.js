// no npm!
const fs = require('fs')
const ini = require('./ini')
const lib = require('./lib')
const lokinet = require('./lokinet')
const netWrap = require('./lets_tcp')
const networkTest = require('./lib.networkTest')
const child_process = require('child_process')

const VERSION = 0.1

// load config from disk
const ini_bytes = fs.readFileSync('launcher.ini')
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

console.log('SNBench config:', config)
var logo = lib.getLogo('S N B E N C H   v e r s i o n   v version')
console.log(logo.replace(/version/, VERSION.toString().split('').join(' ')))



// we're not running it, so there's no output
//lokinet.disableLogging()

var debug = false

// diskspace check
function getFreeSpaceUnix(cb) {
  child_process.exec('df -k .', function(error, stdout) {
    //console.log('stdout', stdout)
    var lines = stdout.split('\n')
    for(var i in lines) {
      var tline = lines[i].trim()
      var parts = tline.split(/\W+/)
      //console.log(parts.length, parts[5])
      if (parts.length == 8 && parts[5]) {
        var gb = parseInt(parts[5]) / (1024)
        //console.log('gb', gb)
        if (gb) {
          //console.log('you have', gb, 'GBi free')
          cb(gb)
        }
      }
    }
  })
}

var snode_problems = 0
var need = {
  diskspace: false,
  rpcport: false,
}
function markCheckDone(doneSubSystem) {
  if (debug) console.info(doneSubSystem, 'check complete')
  need[doneSubSystem] = true;
  for(var subSystem in need) {
    if (need[subSystem] === false) {
      if (debug) console.debug('still need', subSystem)
      return
    }
  }
  if (debug) console.debug('all checks are complete')
  if (snode_problems) {
    console.error('We have found', snode_problems, 'please address them before running a servide node')
  } else {
    console.info('We have prequalified that you are ready to run a service node')
  }
}

// diskspace check
if (1) {
  getFreeSpaceUnix(function(space) {
    if (debug) console.debug('space', space, 'GBi free')
    if (space < 15) {
      console.warn('YOU DO NOT HAVE ENOUGH DISK SPACE FREE, you need 15GBi free, you have', space, 'GBi')
      snode_problems++
    }
    markCheckDone('diskspace')
  })
}

// port test
if (1) {
  // start a network server
  // on port config.blockchain.rpc_port
  // FIXME: make sure port isn't already taken
  var code = lokinet.randomString(96)
  console.log('Starting open port check on configured RPC port:', config.blockchain.rpc_port)
  var tempResponder = netWrap.serveTCP(config.blockchain.rpc_port, function(incomingConnection) {
    if (debug) console.debug('port verified')
    incomingConnection.send('quit ' + code + ' ' + Date.now())
  })
  networkTest.createClient('127.0.0.1', 3000, function(client) {
    if (client === false) {
      console.warn('We could not connect to our testing server, please try again later')
      process.exit()
    }
    client.testPort(config.blockchain.rpc_port, function(results) {
      if (debug) console.debug('port test complete', results)
      if (results.code != code) {
        console.warn('weird codes do not match but probably fine for now')
      }
      if (results.result != 'good') {
        console.warn('WE COULD VERIFY THAT YOU HAVE PORT ', config.blockchain.rpc_port,', OPEN ON YOUR FIREWALL, this is now required to run a service node')
        snode_problems++
      }
      client.disconnect()
      tempResponder.letsClose(function() {
        markCheckDone('rpcport')
      })
    })
  })
}