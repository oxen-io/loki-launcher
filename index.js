#!/usr/bin/env node
// no npm!
const os = require('os')
const packageData = require('./package.json')

let VERSION = packageData.version
let useGitVersion = false

if (VERSION.match(/git/)) {
  const exec = require('child_process').exec
  exec('git rev-parse HEAD', function(err, stdout) {
    if (err) {
      continueStart()
      return
    }
    VERSION = stdout.trim()
    useGitVersion = true
    continueStart()
  })
} else {
  continueStart()
}

function continueStart() {
  if (os.platform() == 'darwin') {
    if (process.getuid() != 0) {
      console.error('MacOS requires you start this with sudo, i.e. $ sudo ' + __filename)
      process.exit()
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
      if (process.getuid() == 0) {
        console.error('Its not recommended you run this as root unless the guide otherwise says to do so')
      }
    }
  }
  console.log('running', mode)
  switch(mode) {
    case 'strt':
    case 'strart':
    case 'start': // official
      warnRunAsRoot()
      require(__dirname + '/start')(args, config, __filename, false)
    break;
    case 'status': // official
      const lokinet = require('./lokinet')
      var running = lib.getProcessState(config)
      if (running.lokid === undefined) {
        //console.log('no pids...')
        var pid = lib.areWeRunning(config)
        var pids = lib.getPids(config)
        if (pids.err == 'noFile'  && pid) {
          console.log('Launcher is running with no', config.launcher.var_path + '/pids.json, giving it a little nudge, please run status again, current results maybe incorrect')
          process.kill(pid, 'SIGHUP')
        } else if (pids.err && pids.err != 'noFile') {
          console.error('error reading file', config.launcher.var_path + '/pids.json', pids.err)
        }
        // update config from pids.json
        if (pids && !pids.err) {
          console.log('replacing disk config with running config')
          config = pids.runningConfig
        }
      }

      // "not running" but too easy to confuse with "running"
      lib.getLauncherStatus(config, lokinet, 'offline', function(running, checklist) {
        var nodeVer = Number(process.version.match(/^v(\d+\.\d+)/)[1])
        //console.log('nodeVer', nodeVer)
        if (nodeVer >= 10) {
          console.table(checklist)
        } else {
          console.log(checklist)
        }
      })
      if (running.lokid) {
        // read config, run it with status param...
        // spawn out and relay output...
        // could also use the socket to issue a print_sn_status
      }
    break;
    case 'stop': // official
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
          console.log('shutdown waiting on', waiting.join(' '))
          setTimeout(shutdownMonitor, 1000)
        } else {
          console.log('successfully shutdown')
        }
      }
      var running = lib.getProcessState(config)
      var wait = 500
      if (running.lokid) wait += 4500
      if (running.lokid || running.lokinet || running.storageServer) {
        console.log('waiting for daemons to stop')
        setTimeout(shutdownMonitor, wait)
      }
    break;
    case 'start-debug':
    case 'interactive':
      // debug mode basically (but also used internally now)
      process.env.__daemon = true
      config.launcher.interactive = true
      require(__dirname + '/start')(args, config, __filename, true)
    break;
    case 'daemon-start': // official
      // debug mode basically (but also used internally now)
      // how this different from systemd-start?
      // this allows for interactive mode...
      process.env.__daemon = true
      require(__dirname + '/start')(args, config, __filename)
    break;
    case 'non-interactive':
    case 'systemd-start': // official
      // stay in foreground mode...
      // force docker mode...
      // somehow I don't like this hack...
      // what we if reload config from disk...
      // treat it like an CLI arg
      config.launcher.docker = true
      process.env.__daemon = true
      require(__dirname + '/start')(args, config, __filename)
    break;
    case 'config-build': // official
      // build a default config
      // commit it to disk if it doesn't exist
    break;
    case 'config-view': // official
      console.log('loki-launcher is in', __dirname)
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
      if (process.getuid() != 0) {
        console.log('check-systemd needs to be ran as root, try prefixing your attempted command with: sudo')
        process.exit(1)
      }
      require(__dirname + '/modes/check-systemd').start(config, __filename)
    break;
    case 'chown':
    case 'fixperms':
    case 'setperms':
    case 'set-perms':
    case 'fix-perms': // official
      if (process.getuid() != 0) {
        console.log('fix-perms needs to be ran as root, try prefixing your attempted command with: sudo')
        process.exit(1)
      }
      var user = findFirstArgWithoutDash()
      require(__dirname + '/modes/fix-perms').start(user, __dirname, config)
    break;
    case 'args-debug': // official
      console.log('in :', process.argv)
      console.log('out:', args)
    break;
    case 'download-binaries': // official
      require(__dirname + '/modes/download-binaries').start(config)
    break;
    case 'version':
      //
    break
    case 'help': // official
    case 'hlep':
    case 'hepl':
    case 'lpeh':
    default:
      console.debug('in :', process.argv)
      console.debug('out:', args)
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
      download-binaries download the latest version of the loki software suite
      check-systemd upgrade your lokid.service to use the launcher (requires root)
      fix-perms requires user OPTION, make all operational files own by user passed in
      config-view print out current configuration information
  `)
    break;
  }
}
