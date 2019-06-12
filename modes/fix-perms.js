const fs = require('fs')
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

function start(user, dir, config) {
  // FIXME: make sure the launcher isn't running
  const uidGetter = require(dir + '/uid')
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
    // config.launcher.var_path doesn't always exist yet
    if (fs.existsSync(config.launcher.var_path)) {
      fs.chownSync(config.launcher.var_path, uid, 0)
    }
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
}

module.exports = {
  start: start
}
