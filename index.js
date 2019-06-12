#!/usr/bin/env node
// no npm!
const os = require('os')
const VERSION = 0.8

if (os.platform() == 'darwin') {
  if (process.getuid() != 0) {
    console.error('MacOS requires you start this with sudo, i.e. $ sudo ' + __filename)
    process.exit()
  }
} else {
  // FIXME:
  // ok if you run this once as root, it may create directories as root
  // maybe we should never make dirs as root... (unless macos, ugh)
  if (process.getuid() == 0) {
    console.error('Its not recommended you run this as root')
  }
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
configUtil.check(config)

const lib = require(__dirname + '/lib')
//console.log('Launcher config:', config)
var logo = lib.getLogo('L A U N C H E R   v e r s i o n   v version')
console.log(logo.replace(/version/, VERSION.toString().split('').join(' ')))

// FIXME: move into fix-perms.js
const pathUtil = require('path')
function walk(dir, fn, cb) {
  var count,
      last_err,
      files_modified = [];

  var done = function(err, modified) {
    if (err) last_err = err;

    if (modified) {
      files_modified = files_modified.concat(modified);
    }

    --count || finished();
  }

  var finished = function() {
    fn(dir, function(err) {
      if (!err)
        files_modified.push(dir);

      cb(err || last_err, files_modified);
    })
  }

  fs.readdir(dir, function(err, files) {
    if (err) { // or stopped
      if (err.code == 'ENOTDIR')
        return finished();
      else
        return done(err);
    }
    else if (files.length == 0)
      return finished();

    count = files.length;

    files.forEach(function(file, index) {
      var path = pathUtil.join(dir, file);

      fs.lstat(path, function(err, stat) {
        if (err) // or stopped
          return done(err);

        if (stat.isDirectory()) { // recurse
          walk(path, fn, done);
        } else {
          fn(path, function(err) {
            if (!err) files_modified.push(path);

            // handle unexisting symlinks
            // var e = err && err.code != 'ENOENT' ? err : null;
            done(err);
          });
        }
      })
    })
  })

}

switch(mode) {
  case 'start': // official
    require(__dirname + '/start')(args, config, __filename)
  break;
  case 'status': // official
    var pid = lib.areWeRunning(config)
    console.log('launcher status:', pid?('running on ' + pid):'not running')
    var running = lib.getProcessState(config)
    console.log('blockchain status:', running.lokid?('running on ' + running.lokid):'offline')
    if (running.lokid) {
      // read config, run it with status param...
      // spawn out and relay output...
    }
    if (running.lokinet) {
      console.log('network status:', running.lokinet?('running on ' + running.lokinet):'offline')
    }
    if (running.storageServer) {
      console.log('storage status:', running.storageServer?('running on ' + running.storageServer):'offline')
    }
  break;
  case 'stop': // official
    console.log('Getting launcher state')
    var pid = lib.areWeRunning(config)
    if (pid) {
      // request launcher stop
      console.log('requesting launcher stop')
      process.kill(pid, 'SIGINT')
      // we quit too fast
      //require(__dirname + '/client')(config)
    } else {
      var running = lib.getProcessState(config)
      var pids = lib.getPids(config)
      if (running.lokid) {
        process.kill(pids.lokid, 'SIGINT')
      }
      if (config.storage.enabled && running.storageServer) {
        process.kill(pids.storageServer, 'SIGINT')
      }
      if (config.network.enabled && running.lokinet) {
        process.kill(pids.lokinet, 'SIGINT')
      }
    }
    function shutdownMonitor() {
      var running = lib.getProcessState(config)
      var waiting = []
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
  case 'daemon-start': // official
    // debug mode basically (but also used internally now)
    // how this different from systemd-start?
    // this allows for interactive mode...
    process.env.__daemon = true
    require(__dirname + '/start')(args, config, __filename)
  break;
  case 'systemd-start': // official
    // stay in foreground mode...
    // force docker mode...
    // somehow I don't like this hack...
    // what we if reload config from disk...
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
    console.log('Launcher config:', config)
  break;
  case 'config-edit': // official
    // xdg-open / open ?
  break;
  case 'client': // deprecated
  case 'console': // official
    // enable all 3
  case 'blockchain':
    require(__dirname + '/client')(config)
  break;
  case 'prequal': // official
    require(__dirname + '/snbench')(config, false)
  break;
  case 'prequal-debug': // official
    require(__dirname + '/snbench')(config, true)
  break;
  case 'bwtest':
  case 'bw-test': // official
    // write me!
  break;
  case 'check-systemd': // official
    require(__dirname + '/check-systemd').start(config, __filename)
  break;
  case 'chown':
  case 'fixperms':
  case 'fix-perms': // official
    // FIXME: make sure the launcher isn't running
    var user = findFirstArgWithoutDash()
    const uidGetter = require(__dirname + '/uid')
    console.log('setting permissions to', user)
    uidGetter.uidNumber(user, function(err, uid) {
      if (err) {
        console.error('Username lookup failed: ', err)
        return
      }
      console.log('user', user, 'uid is', uid)
      // binary paths
      fs.chownSync(config.blockchain.binary_path, uid, 0)
      if (config.network.binary_path) fs.chownSync(config.network.binary_path, uid, 0)
      if (config.storage.binary_path) fs.chownSync(config.storage.binary_path, uid, 0)
      // config.launcher.var_path
      fs.chownSync(config.launcher.var_path, uid, 0)
      // config.blockchain.data_dir
      if (config.blockchain.data_dir) fs.chownSync(config.blockchain.data_dir, uid, 0)
      // config.network.data_dir
      if (config.network.data_dir) fs.chownSync(config.network.data_dir, uid, 0)
      // config.network.lokinet_nodedb
      if (config.network.lokinet_nodedb) fs.chownSync(config.network.lokinet_nodedb, uid, 0)
      // config.storage.db_location
      if (config.storage.db_location) fs.chownSync(config.storage.db_location, uid, 0)
      // apt will all be owned as root...
      // /opt/loki-launcher/bin
      if (fs.existsSync(config.launcher.var_path + '/launcher.pid')) {
        fs.chownSync(config.launcher.var_path + '/launcher.pid', uid, 0)
      }
      if (fs.existsSync(config.launcher.var_path + '/pids.json')) {
        fs.chownSync(config.launcher.var_path + '/pids.json', uid, 0)
      }
      if (fs.existsSync(config.launcher.var_path + '/launcher.socket')) {
        fs.chownSync(config.launcher.var_path + '/launcher.socket', uid, 0)
      }
      fs.chownSync('/opt/loki-launcher/bin', uid, 0)
      if (config.blockchain.data_dir) {
        walk(config.blockchain.data_dir, function(path, cb) {
          console.log('fixing blockchain.data_dir file', path)
          var res = fs.chownSync(path, uid, 0)
          cb(res)
        }, function() {
          // done
        })
      } else {
        console.log('no blockchain data_dir')
      }
    })
  break;
  case 'args-debug': // official
    console.log('in :', process.argv)
    console.log('out:', args)
  break;
  case 'download-binaries': // official
    require(__dirname + '/download-binaries').start(config)
  break;
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
`)
  break;
}
