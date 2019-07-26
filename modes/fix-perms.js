const fs = require('fs')
const pathUtil = require('path')
const lokinet = require(__dirname + '/../lokinet')
const lib = require(__dirname + '/../lib')

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

// should be ran after download-binaries
function start(user, dir, config) {
  const killedLauncher = lib.stopLauncher(config)
  lib.waitForLauncherStop(config, function() {
    const uidGetter = require(dir + '/uid')
    console.log('setting permissions to', user)
    uidGetter.uidNumber(user, function(err, uid, homedir) {
      if (err) {
        console.error('Username lookup failed: ', err)
        return
      }
      console.log('user', user, 'uid is', uid, 'homedir is', homedir)
      homedir = homedir.replace(/\/$/, '')
      // binary paths
      fs.chownSync(config.blockchain.binary_path, uid, 0)
      if (config.network.binary_path) fs.chownSync(config.network.binary_path, uid, 0)
      if (config.storage.binary_path) fs.chownSync(config.storage.binary_path, uid, 0)
      // config.launcher.var_path doesn't always exist yet
      if (fs.existsSync(config.launcher.var_path)) {
        fs.chownSync(config.launcher.var_path, uid, 0)
      } else {
        // opt has to be made as root
        lokinet.mkDirByPathSync(config.launcher.var_path)
        fs.chownSync(config.launcher.var_path, uid, 0)
        // should also make /opt/loki-launcher not root
        // but not /var
        if (config.launcher.var_path == '/opt/loki-launcher/var') {
          fs.chownSync('/opt/loki-launcher', uid, 0)
        }
      }
      // config.blockchain.data_dir
      // if this is default, then we'll be the wrong user...
      if (config.blockchain.data_dir_is_default) {
        const configUtil = require(__dirname + '/../config')
        config.blockchain.data_dir = homedir + '/.loki'
        const data_dir = configUtil.getLokiDataDir(config)
        // create it if needed
        if (!fs.existsSync(data_dir)) {
          lokinet.mkDirByPathSync(data_dir)
        }
        //console.log('default blockchain data_dir is', data_dir)
        fs.chownSync(data_dir, uid, 0)
      } else {
        if (config.blockchain.data_dir) fs.chownSync(config.blockchain.data_dir, uid, 0)
      }
      // config.storage.data_dir
      // if this is default, then we'll be the wrong user...
      if (config.storage.data_dir_is_default) {
        config.storage.data_dir = homedir + '/.loki/storage'
        // create it if needed
        if (!fs.existsSync(config.storage.data_dir)) {
          lokinet.mkDirByPathSync(config.storage.data_dir)
        }
        fs.chownSync(config.storage.data_dir, uid, 0)
      } else {
        if (config.storage.data_dir) fs.chownSync(config.storage.data_dir, uid, 0)
      }
      // config.network.data_dir
      if (config.network.data_dir) fs.chownSync(config.network.data_dir, uid, 0)
      // config.network.lokinet_nodedb
      if (config.network.lokinet_nodedb) fs.chownSync(config.network.lokinet_nodedb, uid, 0)
      // config.storage.data_dir
      if (config.storage.data_dir) fs.chownSync(config.storage.data_dir, uid, 0)
      if (config.storage.enabled) {
        if (fs.existsSync(config.launcher.var_path + '/storageServer.version')) {
          fs.chownSync(config.launcher.var_path + '/storageServer.version', uid, 0)
        }
      }
      if (config.network.enabled) {
        if (fs.existsSync(config.launcher.var_path + '/lokinet.version')) {
          fs.chownSync(config.launcher.var_path + '/lokinet.version', uid, 0)
        }
        if (fs.existsSync(config.launcher.var_path + '/snode_address')) {
          fs.chownSync(config.launcher.var_path + '/snode_address', uid, 0)
        }
      }
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
      if (fs.existsSync(config.launcher.var_path + 'launcher_exception.log')) {
        fs.chownSync(config.launcher.var_path + 'launcher_exception.log', uid, 0)
      }
      // this is the only place download binaries downloads too
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
      if (killedLauncher) {
        console.log('')
        console.log('remember to restart your launcher')
      }
    })
  })
}

module.exports = {
  start: start
}
