#!/usr/bin/env node
// no npm!
const os = require('os')
const packageData = require('./package.json')

let VERSION = packageData.version
let useGitVersion = false

if (VERSION.match(/git/)) {
  const execSync = require('child_process').execSync
  try {
    var stdout = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
    if (stdout && stdout.toString) {
      VERSION = stdout.toString().trim()
      useGitVersion = true
    }
  } catch(e) {
    // guessing you don't have git installed...
    //console.warn('git is not installed, can\'t determine revision')
    // silently fail
  }
  continueStart()
} else {
  continueStart()
}

async function continueStart() {
  if (os.platform() == 'darwin') {
    if (process.getuid() != 0) {
      console.error('MacOS requires you start this with sudo, i.e. $ sudo ' + __filename)
      process.exit(1)
    }
  } else {
    // FIXME:
    // ok if you run this once as root, it may create directories as root
    // maybe we should never make dirs as root... (unless macos, ugh)
  }

  // preprocess command line arguments
  var args = JSON.parse(JSON.stringify(process.argv))
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
  // well argvs[0] we will always want to strip...
  stripArg('/usr/local/bin/node')
  stripArg('/usr/local/bin/nodejs')
  stripArg('/usr/bin/node')
  stripArg('/usr/bin/nodejs')
  stripArg('node')
  stripArg('nodejs')
  stripArg(__filename) // will just be index.js
  stripArg('loki-launcher')
  stripArg('/usr/bin/loki-launcher')
  stripArg('/usr/local/bin/loki-launcher')
  // how is this not __filename??
  stripArg('/usr/lib/node_modules/loki-launcher/index.js')
  //console.debug('index filename:', __filename)
  //console.debug('Launcher arguments:', args)

  function findFirstArgWithoutDash() {
    for(var i in args) {
      var arg = args[i]
      //console.log('arg is', arg)
      if (arg.match(/^-/)) continue
      //console.log('command', arg)
      return arg
    }
    return ''
  }

  // find the first arg without --
  var mode = findFirstArgWithoutDash()

  //console.log('mode', mode)
  stripArg(mode)
  mode = mode.toLowerCase() // make sure it's lowercase

  // load config from disk
  const fs = require('fs')
  const ini = require(__dirname + '/ini')
  const configUtil = require(__dirname + '/config')
  // FIXME: get config dir
  // via cli param
  // via . ?
  var disk_config = {}
  var config = configUtil.getDefaultConfig(__filename)
  var config_type = 'default'
  if (fs.existsSync('/etc/loki-launcher/launcher.ini')) {
    const ini_bytes = fs.readFileSync('/etc/loki-launcher/launcher.ini')
    disk_config = ini.iniToJSON(ini_bytes.toString())
    config = disk_config
    config_type = 'etc'
  }
  // local overrides default path
  //console.log('test', __dirname + '/launcher.ini')
  if (fs.existsSync(__dirname + '/launcher.ini')) {
    const ini_bytes = fs.readFileSync(__dirname + '/launcher.ini')
    disk_config = ini.iniToJSON(ini_bytes.toString())
    config = disk_config
    config_type = __dirname
  }
  config.type = config_type
  config.entrypoint = __filename
  const lib = require(__dirname + '/lib')

  //console.log('Launcher config:', config)
  if (useGitVersion) {
    var logo = lib.getLogo('git rev version')
    console.log(logo.replace(/version/, VERSION.toString().split('').join('')))
  } else {
    var logo = lib.getLogo('L A U N C H E R   v e r s i o n   v version')
    console.log(logo.replace(/version/, VERSION.toString().split('').join(' ')))
  }

  var debugMode = mode.match(/debug/i)
  //if (debugMode) console.debug('enabling debug')
  configUtil.check(config, args, debugMode)

  function warnRunAsRoot() {
    if (os.platform() != 'darwin') {
      if (process.getuid() === 0) {
        console.error('Its not recommended you run this as root unless the guide otherwise says to do so')
      }
    }
  }

  function requireRoot() {
    if (process.getuid() !== 0) {
      console.error('This now requires to be ran as root (currentUID:', process.getuid(), ', expected 0), try running the command with "sudo " in front')
      process.exit()
    }
  }

  let statusWatcher = false

  const statusSystem = require(__dirname + '/modes/status')
  statusSystem.start(config)

  // this just show's what's installed not running
  function showVersions() {
    console.log('blockchain installed version', lib.getBlockchainVersion(config))
    console.log('storage    installed version', lib.getStorageVersion(config))
    console.log('network    installed version', lib.getNetworkVersion(config))
  }

  console.log('Running', mode)
  switch(mode) {
    case 'strt':
    case 'strart':
    case 'staart':
    case 'start': // official
      warnRunAsRoot()
      require(__dirname + '/start')(args, config, __filename, false)
    break;
    case 'stauts':
    case 'statsu':
    case 'statu':
    case 'stuatus':
    case 'stautu':
    case 'status': // official
      await statusSystem.status()
      var type = findFirstArgWithoutDash()
      if (type) {
        switch(type) {
          case 'blockchain':
            // can hang if lokid is popping blocks
            console.log('BLOCKCHAIN STATUS')
            statusSystem.checkBlockchain();
          break;
          case 'storage':
            console.log('STORAGE STATUS')
            statusSystem.checkStorage();
          break;
          case 'network':
            console.log('NETWORK STATUS')
            statusSystem.checkNetwork();
          break;
        }
      }
    break;
    // no restart because we don't want people croning it
    case 'stop': // official
      // maybe use the client to see what's taking lokid a while...
      //console.log('Getting launcher state')
      lib.stopLauncher(config)
      function shutdownMonitor() {
        var running = lib.getProcessState(config)
        var pid = lib.areWeRunning(config)
        var waiting = []
        if (pid) {
          waiting.push('launcher')
        }
        if (running.lokid) {
          waiting.push('blockchain')
        }
        if (running.lokinet) {
          waiting.push('network')
        }
        if (running.storageServer) {
          waiting.push('storage')
        }
        if (running.lokid || running.lokinet || running.storageServer) {
          console.log('Shutdown waiting on', waiting.join(' '))
          setTimeout(shutdownMonitor, 1000)
        } else {
          console.log('Successfully shutdown.')
        }
      }

      var pid = lib.areWeRunning(config)
      if (!pid) {
        // launcher isn't running but asking for stop...
        const lokinet = require('./lokinet')
        // TODO: lokinet running? can't check udp. loki-storage port running?
        // TODO: launcher actually running somewhere?
        // and is it locked up? webserver port?
        lokinet.portIsFree(config.blockchain.rpc_ip, config.blockchain.rpc_port, async function(portFree) {
          if (!portFree) {
            const portPid = await lib.findPidByPort(config.blockchain.rpc_port)
            console.log('')
            console.log(`There's a lokid on ${portPid} that we're not tracking using our configuration (rpc_port is already in use). You likely will want to confirm and manually stop it before start using the launcher again.`);
            console.log('')
          }
        })
      }

      var running = lib.getProcessState(config)
      var wait = 500
      if (running.lokid) wait += 4500
      if (running.lokid || running.lokinet || running.storageServer) {
        console.log('Waiting for daemons to stop.')

        const net = require('net')

        var socketPath = config.launcher.var_path + '/launcher.socket'
        if (fs.existsSync(socketPath)) {
          console.log('Trying to connect to', socketPath)
          // FIXME: file exist check


          const client = net.createConnection({ path: socketPath }, () => {
            // 'connect' listener
            //console.log('Connected to server!')
          })
          client.on('error', (err) => {
            if (err.code == 'EPERM') {
              console.warn('It seems user', process.getuid(), 'does not have the required permissions to view socket while blockchain stops')
            } else
            if (err.code == 'ECONNREFUSED') {
              console.warn('Can not connect to', socketPath, 'connection is refused')
            } else {
              console.warn('client socket err', err)
            }
          })
          client.on('data', (data) => {
            var stripped = data.toString().trim()
            console.log('FROM SOCKET:', stripped)
          })
          client.on('end', () => {
            console.log('Disconnected from socket server...')
            //process.exit()
          })
        }

        setTimeout(shutdownMonitor, wait)
      }
    break;
    case 'start-debug':
      // no interactive or docker
      config.launcher.cimode = true
      // debug mode basically (but also used internally now)
      process.env.__daemon = true
      require(__dirname + '/start')(args, config, __filename, true)
    break;
    case 'interactive-debug':
    case 'interactive':
      config.launcher.interactive = true
      process.env.__daemon = true
      if (debugMode) {
        statusWatcher = setInterval(status, 30*1000)
        process.on('SIGUSR1', function () {
          console.log('Disabling statusWatcher')
          clearInterval(statusWatcher)
        })
        process.on('SIGUSR2', function () {
          console.log('Enabling statusWatcher')
          statusWatcher = setInterval(status, 30*1000)
        })
        // lokid exit seems fine...
        // ctrl-c seems fine too
        process.on('SIGTERM', function () {
          console.log('interactive SIGTERM')
          if (statusWatcher) {
            clearInterval(statusWatcher)
            statusWatcher = false
          }
        })
        process.on('SIGINT', function () {
          console.log('interactive SIGINT')
          if (statusWatcher) {
            clearInterval(statusWatcher)
            statusWatcher = false
          }
          process.exit();
        })
      }
      require(__dirname + '/start')(args, config, __filename, debugMode)
    break;
    case 'daemon-start-debug': // official
    case 'daemon-start': // official
      // debug mode basically (but also used internally now)
      // how this different from systemd-start?
      // this allows for interactive mode...
      process.env.__daemon = true
      require(__dirname + '/start')(args, config, __filename, debugMode)
    break;
    case 'non-interactive':
    case 'systemd-start-debug':
    case 'systemd-start': // official
      // stay in foreground mode...
      // force docker mode...
      // somehow I don't like this hack...
      // what we if reload config from disk...
      // treat it like an CLI arg
      config.launcher.docker = true
      process.env.__daemon = true
      require(__dirname + '/start')(args, config, __filename, debugMode)
    break;
    case 'config-build': // official
      // build a default config
      // commit it to disk if it doesn't exist
    break;
    case 'config-view': // official
      console.log('Loki-launcher is in', __dirname)
      // FIXME: prettyPrint
      console.log('Launcher stored-config:', config)
      var pids = lib.getPids(config)
      if (pids && pids.runningConfig) {
        console.log('Launcher running-config:', pids.runningConfig)
      }
    break;
    case 'config-edit': // official
      // xdg-open / open ?
    break;
    case 'client': // deprecated
    case 'console': // official
      // enable all 3
    case 'blockchain':
      require(__dirname + '/modes/client')(config)
    break;
    case 'prequal': // official
      require(__dirname + '/modes/prequal')(config, false)
    break;
    case 'prequal-debug': // official
      require(__dirname + '/modes/prequal')(config, true)
    break;
    case 'bwtest':
    case 'bw-test': // official
      require(__dirname + '/modes/bw-test').start(config, false)
    break;
    case 'bw-test-debug': // official
      require(__dirname + '/modes/bw-test').start(config, true)
    break;
    case 'check-systemd':
    case 'upgrade-systemd': // official
      // do the docs expect a specific message
      // requireRoot()
      if (process.getuid() != 0) {
        console.log('upgrade-systemd needs to be ran as root, try prefixing your attempted command with: sudo')
        process.exit(1)
      }
      require(__dirname + '/modes/check-systemd').start(config, __filename)
    break;
    case 'systemd':
      var type = findFirstArgWithoutDash()
      if (type === 'enable') {
        requireRoot()
        // migrate or create
        // need __filename for index location to put in service file
        require(__dirname + '/modes/check-systemd').start(config, __filename)
      } else
      if (type === 'disable') {
        requireRoot()
        // unlink('/etc/systemd/system/lokid.service')
      } else
      if (type === 'log') {
        require(__dirname + '/modes/check-systemd').launcherLogs(config)
      } else {
        console.log('requires one of the following parameters: enable or log')
      }
    break;
    case 'chown':
    case 'fixperms':
    case 'setperms':
    case 'set-perms':
    case 'fix-perms': // official
      var user = findFirstArgWithoutDash()
      if (!user) {
        console.log('No user passed in! You must explicitly tell us what user you want the permissions to be set for')
        console.log('You are currently logged in as', os.userInfo().username)
        return
      }
      if (process.getuid() != 0) {
        console.log('Fix-perms needs to be ran as root, try prefixing your attempted command with: sudo')
        process.exit(1)
      }
      require(__dirname + '/modes/fix-perms').start(user, __dirname, config)
    break;
    case 'args-debug': // official
      console.log('in :', process.argv)
      console.log('out:', args)
    break;
    case 'donwload-binaries':
    case 'donwload-binaries':
    case 'donwload-bianres':
    case 'downlaod-binaries':
    case 'download-binaries': // official
      // because of lokinet and mkdirp /opt/...
      requireRoot()
      var opt1 = findFirstArgWithoutDash()
      // FIXME: prerel-force
      var options = {
        forceDownload: (opt1 === 'force' || opt1 === 'force-prerel'),
        prerel: (opt1 === 'prerel' || opt1 === 'force-prerel')
      }
      require(__dirname + '/modes/download-binaries').start(config, options)
    break;
    case 'download-chain':
    case 'download-blockchain': // official
      // FIXME: disable if not mainnet
      // doesn't have to be root but does have to be stopped
      var options = {}
      require(__dirname + '/modes/download-blockchain').start(config, options)
    break;
    case 'export':
      // doesn't have to be root or stopped, just need read access

      if (!fs.existsSync(config.blockchain.lokid_key)) {
        console.log(config.blockchain.lokid_key, "does not exist, this has not been run as a service node yet")
        process.exit()
      }

      var opt1 = findFirstArgWithoutDash()

      let key
      if (!opt1) {
        var running = lib.getProcessState(config)

        if (running.lokid) {
          const keys = await lib.blockchainRpcGetKey(config)
          key = keys.result.service_node_pubkey
        } else {
          console.log('blockchain is not running, one sec, need to start it to get our key')
          const statusUtils = require(__dirname + '/modes/status')
          const daemon = require(__dirname + '/daemon')
          const lokinet = require('./lokinet')
          key = await lib.getSnodeOffline(statusUtils, daemon, lokinet, config)
        }
      }
      const date = new Date().toISOString().replace(/:/g, '-')

      var options = {
        destPath: opt1 || 'export_' + key + '_' + date + '.tar'
      }
      require(__dirname + '/modes/export').start(config, options)
    break;
    case 'versions':
    case 'version': // official
      showVersions()
    break
    case 'help': // official
    case 'hlep':
    case 'hepl':
    case 'lpeh':
    default:
      console.debug('in :', process.argv)
      console.debug('out:', args)
      //              storage    - get storage status
      console.log(`
  Unknown command [${mode}]

  loki-launcher is manages the Loki.network suite of software primarily for service node operation
  Usage:
    [sudo] loki-launcher [command] [OPTIONS]

    Commands:
      start       start the loki suite with OPTIONS
      status      get the current loki suite status, can optionally provide:
                    blockchain - get blockchain status
      client      connect to lokid
      prequal     prequalify your server for service node operation
      config-view print out current configuration information
      versions    show installed versions of Loki software
      export      try to create a compressed tarball with all the snode files
                    that you need to migrate this snode to another host
      systemd     requires one of the following options
                    log - show systemd launcher log file

    Commands that require root/sudo:
      download-binaries - download the latest version of the loki software suite
        can optionally provide: force, prerel and force-prerel
      upgrade-systemd (check-systemd) - reconfigures your lokid.service
      fix-perms - requires user OPTION, make all operational files own by user
  `)
    break;
  }
}
