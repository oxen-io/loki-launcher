// no npm!
const fs = require('fs')
const ini = require(__dirname + '/../ini')
const lib = require(__dirname + '/../lib')
const lokinet = require(__dirname + '/../lokinet') // expects 0.8 used for randomString
const netWrap = require(__dirname + '/../lets_tcp')
const networkTest = require(__dirname + '/../lib.networkTest')
const child_process = require('child_process')

// we're not running it, so there's no output
//lokinet.disableLogging()

//const VERSION = 0.3
//console.log('loki snbench version', VERSION, 'registered')

// now can't call this directly
module.exports = function(config, debug) {
  //var logo = lib.getLogo('S N B E N C H   v e r s i o n   v version')
  //console.log(logo.replace(/version/, VERSION.toString().split('').join(' ')))

  // diskspace check
  function getFreeSpaceUnix(path, cb) {
    if (debug) console.log('checking diskspace on', path)
    child_process.exec('df -kP ' + path, function(error, stdout) {
      if (debug) console.log('stdout', stdout)
      var lines = stdout.split('\n')
      if (debug) console.log('df lines', lines.length)
      var calledBack = false
      for(var i in lines) {
        var tline = lines[i].trim()
        var parts = tline.split(/( |\t)+/)
        if (debug) {
          console.log(''+parts.length, 'segments, 6th',parts[6])
          for(var i in parts) {
            console.log(i, parts[i])
          }
        }
        if (parts.length == 11 && parts[6]) {
          var gb = parseInt(parts[6]) / (1024 * 1024)
          //console.log('gb', gb)
          if (gb) {
            //console.log('you have', gb, 'GBi free')
            calledBack = true
            cb(gb)
          }
        }
      }
      if (!calledBack) {
        console.error('Could not parse your df output, please create a github issue here: https://github.com/loki-project/loki-launcher/issues with the following: ', stdout)
        // it exists anyways but make CI realize there's a problem
        process.exit(1)
        //cb(undefined)
      }
    })
  }

  var snode_problems = 0
  var need = {
    diskspace: false,
    rpcport: false,
  }
  var blockchain_size = 15 //gb
  var storage_size = 3.5 //gb

  var diskspaces = {}
  var log = [] // FIXME: rename to report
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
    if (diskspaces.storage === null) {
      diskspaces.storage = diskspaces.blockchain
    }
    var lmdbPath = config.blockchain.data_dir + '/lmdb/data.mdb'
    if (fs.existsSync(lmdbPath)) {
      const lmdbFileSize = fs.statSync(lmdbPath).size
      //console.log('lmdbFileSize', lmdbFileSize.toLocaleString())
      const lmdbFileSizeInGBi = parseInt(lmdbFileSize) / (1024 * 1024 * 1024)
      if (debug) console.log('lmdbFileSizeInGBi', lmdbFileSizeInGBi)
      // don't count their current lmdbSize against them
      blockchain_size -= lmdbFileSizeInGBi
    }
    const total_size = blockchain_size + storage_size
    // FIXME: compare by device name not exact size (or maybe both?)
    // FIXME: move out since we're doing it in serial now...
    if (diskspaces.blockchain === diskspaces.storage) {
      var requiredAmount = total_size
      if (diskspaces.blockchain < requiredAmount) {
        console.warn('DiskSpace: Failed !')
        log.push('YOU DO NOT HAVE ENOUGH DISK SPACE FREE, you need ' + requiredAmount.toFixed(2) +
          'GBi free, you have ' + diskspaces.blockchain.toFixed(2) + 'GBi')
        snode_problems++
      } else {
        console.log('DiskSpace: Success !')
      }
    } else {
      // different drives...
      if (diskspaces.blockchain < blockchain_size) {
        console.warn('DiskSpace_blockchain: Failed !')
        log.push('YOU DO NOT HAVE ENOUGH DISK SPACE FREE, you need ' + blockchain_size +
          'GBi free, you have ' + diskspaces.blockchain.toFixed(2) + 'GBi on' +
          config.blockchain.data_dir)
        snode_problems++
      } else {
        console.log('DiskSpace_blockchain: Success !')
      }
      if (diskspaces.storage < storage_size) {
        console.warn('DiskSpace_storage: Failed !')
        log.push('YOU DO NOT HAVE ENOUGH DISK SPACE FREE, you need ' + storage_size +
          'GBi free, you have ' + diskspaces.storage.toFixed(2) + 'GBi on ' +
          config.storage.data_dir)
        snode_problems++
      } else {
        console.log('DiskSpace_storage: Success !')
      }
    }

    console.log('') // space for impact
    if (snode_problems) {
      console.error('We have found', snode_problems, 'issue(s), please address them before running a service node')
      console.log('')
      console.log(log.join("\n"))
    } else {
      console.info('Your node successfully passed all tests')
    }
  }

  // diskspace check
  function diskspaceCheck() {
    // blockchain path
    // storage server path
    // if they're the same path, combine and compare
    console.log('Starting disk space check on blockchain partition', config.blockchain.data_dir)
    if (!fs.existsSync(config.blockchain.data_dir)) {
      // FIXME: hopefully running as the right user
      lokinet.mkDirByPathSync(config.blockchain.data_dir)
    }
    getFreeSpaceUnix(config.blockchain.data_dir, function(space) {
      if (debug) console.debug(config.blockchain.data_dir, 'space', space, 'GBi free')
      diskspaces.blockchain = space
      need.diskspace2 = false
      markCheckDone('diskspace')
      // can't do these in parallel apparently
      if (0) {
        if (config.storage.data_dir === undefined) config.storage.data_dir = '.'
        console.log('Starting disk space check on storage server partition', config.storage.data_dir)
        if (config.storage.data_dir) {
          getFreeSpaceUnix(config.storage.data_dir, function(space) {
            if (debug) console.debug(config.storage.data_dir, 'space', space, 'GBi free')
            diskspaces.storage = space
            markCheckDone('diskspace2')
          })
        }
      } else {
        diskspaces.storage = null
        markCheckDone('diskspace2')
      }
    })
  }

  // port test
  function portTest() {
    // start a network server
    // on port config.blockchain.rpc_port
    // FIXME: make sure port isn't already taken
    var code = lokinet.randomString(96)
    console.log('Starting open port check on configured RPC port:', config.blockchain.rpc_port)
    var tempResponder = netWrap.serveTCP(config.blockchain.rpc_port, function(incomingConnection) {
      if (debug) console.debug('port verified')
      incomingConnection.send('quit ' + code + ' ' + Date.now())
    })
    tempResponder.errorHandler = function(err) {
      if (err.code == 'EADDRINUSE') {
        console.error('Something seems to be running on port', config.blockchain.rpc_port + '. Make sure your lokid is stopped before running this test')
        process.exit(1)
      }
    }
    networkTest.createClient('na.testing.lokinet.org', 3000, function(client) {
      if (client === false) {
        console.warn('We could not connect to our testing server, please try again later')
        process.exit()
      }
      client.testPort(config.blockchain.rpc_port, function(results) {
        if (debug) console.debug('port test complete', results)
        /*
        if (results.code != code) {
          console.warn('weird codes do not match but probably fine for now')
        }
        */
        if (results.result != 'good') {
          console.warn('OpenPort: Failed !')
          log.push('WE COULD NOT VERIFY THAT YOU HAVE PORT ' + config.blockchain.rpc_port +
            ', OPEN ON YOUR FIREWALL, this is now required to run a service node')
          snode_problems++
        } else {
          console.log('OpenPort: Success !')
        }
        client.disconnect()
        tempResponder.letsClose(function() {
          markCheckDone('rpcport')
          diskspaceCheck()
        })
      })
    }, debug)
  }
  portTest()
}
