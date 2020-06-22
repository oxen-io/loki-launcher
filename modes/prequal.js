// no npm!
const fs = require('fs')
const os = require('os')
const ini = require(__dirname + '/../ini')
const lib = require(__dirname + '/../lib')
const configUtil = require(__dirname + '/../config')
const lokinet = require(__dirname + '/../lokinet') // expects 0.8 used for randomString
const networkTest = require(__dirname + '/../lib.networkTest')
const child_process = require('child_process')

// now can't call this directly
module.exports = function(config, debug, timeout) {
  return new Promise(resolve => {
    if (timeout === undefined) timeout = 60 * 1000

    // set up config for prequal
    configUtil.prequal(config)
    if (config.launcher.testnet || config.blockchain.network === 'test') {
      console.log('')
      console.log('in testnet mode, this only checks the ports for testnet')
      console.log('please run outside of testnet mode if you plan to take this node onto the mainnet')
      console.log('')
    }

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
    var snode_warnings = 0
    var need = {
      diskspace: false,
      rpcport: false,
    }
    var blockchain_size = 20 //gb
    var storage_size = 5 //gb

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
        resolve(false)
      } else {
        if (snode_warnings) {
          console.info('Your node successfully passed all required tests. However we did find some warnings:')
          console.log('')
          console.log(log.join("\n"))
        } else {
          console.info('Your node successfully passed all tests')
        }
        resolve(true)
      }
      if (killedLauncher) {
        console.log('')
        console.log('remember to restart your launcher')
      }
    }

    // diskspace check
    function diskspaceCheck() {
      // FIXME: give me my own subsystem...
      // test for /dev/net/tun on linux
      if (os.platform() == 'linux') {
        console.log('Detected linux platform, checking for /dev/net')
        if (!fs.existsSync('/dev/net')) {
          log.push('WE COULD NOT VERIFY THAT YOU HAVE /dev/net, this is now required to run a service node. Ask your service provider to enable it or you may need to find a new provider.')
          console.log('NetworkTunable: Failed !')
          snode_problems++
        } else {
          console.log('NetworkTunable: Success !')
        }
      }

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
        if (config.storage.enabled) {
          //if (config.storage.data_dir === undefined) config.storage.data_dir = '.'
          if (!fs.existsSync(config.storage.data_dir)) {
            console.log('Creating', config.storage.data_dir)
            // FIXME: permissions
            lokinet.mkDirByPathSync(config.storage.data_dir)
          }
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

    function portTest() {
      const ourTests = [
        {
          name: 'blockchain p2p',
          shortName: 'OpenP2pPort',
          type: 'tcp',
          outgoing: false,
          recommended: true,
          port: config.blockchain.p2p_port
        },
        {
          name: 'blockchain quorumnet',
          shortName: 'OpenQuorumNetPort',
          type: 'tcp',
          outgoing: false,
          recommended: false,
          port: config.blockchain.qun_port
        },
        {
          name: 'storage server',
          shortName: 'OpenStoragePort',
          type: 'tcp',
          outgoing: false,
          recommended: false,
          port: config.storage.port
        },
        {
          name: 'storage server LMQ',
          shortName: 'OpenStorageLMQPort',
          type: 'tcp',
          outgoing: false,
          recommended: false,
          port: config.storage.lmq_port
        },
        {
          name: 'network incoming',
          shortName: 'OpenNetworkRecvPort',
          type: 'udp',
          outgoing: false,
          recommended: false,
          port: config.network.public_port
        },
        {
          name: 'network outgoing',
          shortName: 'OpenNetworkSendPort',
          type: 'udp',
          outgoing: true,
          recommended: false,
          port: config.network.public_port
        },
      ]
      networkTest.createClient('na.testing.lokinet.org', 3000, async function(client) {
        if (client === false) {
          console.warn('We could not connect to our testing server, please try again later')
          process.exit()
        }

        function runTest(test) {
          return new Promise((resolve, rej) => {
            console.log('Starting open port check on configured', test.name, (test.type === 'tcp' ? 'TCP':'UDP'), 'port:', test.port)
            p2 = debug
            testName = 'startTestingServer'
            if (test.type === 'udp') {
              if (test.outgoing) {
                testName = 'testUDPSendPort'
                p2 = 1090
              } else {
                testName = 'startUDPRecvTestingServer'
              }
            }
            // due to a bug
            // this can callback twice (once as failure and then success)
            // but is it a scoping issue or the same test?
            // it only stalled the tcp, it never started the UDP tests...
            // I don't see any issues where with test var scope
            //
            client[testName](test.port, p2, function(results, port) {
              if (results != 'good') {
                if (results === 'inuse') {
                  log.push('WE COULD NOT VERIFY THAT YOU HAVE ' +
                    (test.type === 'udp' ? 'UDP' : 'TCP') + ' PORT ' + port +
                    ' ' + (test.outgoing?'OUTGOING':'INCOMING') +
                    ', OPEN ON YOUR FIREWALL/ROUTER, because the port was already in-use, please make sure nothing is using this port before running')
                } else {
                  log.push('WE COULD NOT VERIFY THAT YOU HAVE ' +
                    (test.type === 'udp' ? 'UDP' : 'TCP') + ' PORT ' + port +
                    ' ' + (test.outgoing?'OUTGOING':'INCOMING') +
                    ', OPEN ON YOUR FIREWALL/ROUTER, this is ' + (test.recommended?'recommended':'required') + ' to run a service node')
                }
                console.warn(test.shortName + ': Failed !')
                if (test.recommended) {
                  snode_warnings++
                } else {
                  snode_problems++
                }
              } else {
                console.log(test.shortName + ': Success !')
              }
              resolve()
            })
          })
        }

        for(test of ourTests) {
          await runTest(test)
        }
        //console.log('port tests done')
        //console.log('rpcport done')
        markCheckDone('rpcport')
        diskspaceCheck()
        if (debug) console.debug('calling disconnect')
        client.disconnect()
      }, debug)
    }

    const killedLauncher = lib.stopLauncher(config)
    lib.waitForLauncherStop(config, function() {
      portTest()
    })
  })
}
