// no npm!
const fs = require('fs')

// This module calls into get-uid.js, which sets the
// uid to the supplied argument, in order to find out their
// numeric value.  This can't be done in the main node process,
// because otherwise node would be running as that user from this
// point on.

const child_process = require('child_process')
  , path = require('path')
  , uidSupport = process.getuid && process.setuid
  , uidCache = {}
  , gidCache = {}

function uidGidNumber(uid, gid, cb) {
  if (!uidSupport) return cb()
  if (typeof cb !== "function") cb = gid, gid = null
  if (typeof cb !== "function") cb = uid, uid = null
  if (gid == null) gid = process.getgid()
  if (uid == null) uid = process.getuid()
  if (!isNaN(gid)) gid = gidCache[gid] = +gid
  if (!isNaN(uid)) uid = uidCache[uid] = +uid

  if (uidCache.hasOwnProperty(uid)) uid = uidCache[uid]
  if (gidCache.hasOwnProperty(gid)) gid = gidCache[gid]

  if (typeof gid === "number" && typeof uid === "number") {
    return process.nextTick(cb.bind(null, null, uid, gid))
  }

  var getter = require.resolve(__dirname + "/get-uid-gid.js")

  child_process.execFile( process.execPath
                        , [getter, uid, gid]
                        , function (code, out, stderr) {
    if (code) {
      var er = new Error("could not get uid/gid\n" + stderr)
      er.code = code
      return cb(er)
    }

    try {
      out = JSON.parse(out+"")
    } catch (ex) {
      return cb(ex)
    }

    if (out.error) {
      var er = new Error(out.error)
      er.errno = out.errno
      return cb(er)
    }

    if (isNaN(out.uid) || isNaN(out.gid)) return cb(new Error(
      "Could not get uid/gid: "+JSON.stringify(out)))

    cb(null, uidCache[uid] = +out.uid, gidCache[gid] = +out.gid)
  })
}

function extractDarwin(line) {
  const columns = line.split(':');

  // Darwin passwd(5)
  // 0 name      User's login name.
  // 1 password  User's encrypted password.
  // 2 uid       User's id.
  // 3 gid       User's login group id.
  // 4 class     User's general classification (unused).
  // 5 change    Password change time.
  // 6 expire    Account expiration time.
  // 7 gecos     User's full name.
  // 8 home_dir  User's home directory.
  // 9 shell     User's login shell.

  return {
    username: columns[0],
    password: columns[1],
    userIdentifier: Number(columns[2]),
    groupIdentifier: Number(columns[3]),
    fullName: columns[7],
    homeDirectory: columns[8],
    shell: columns[9]
  };
}

function extractLinux(line) {
  const columns = line.split(':');

  // Linux passwd(5):
  // 0 login name
  // 1 optional encrypted password
  // 2 numerical user ID
  // 3 numerical group ID
  // 4 user name or comment field
  // 5 user home directory
  // 6 optional user command interpreter

  return {
    username: columns[0],
    password: columns[1],
    userIdentifier: Number(columns[2]),
    groupIdentifier: Number(columns[3]),
    fullName: columns[4] && columns[4].split(',')[0],
    homeDirectory: columns[5],
    shell: columns[6]
  };
}

function uidNumber(uid, cb) {
  if (!uidSupport) return cb()
  if (typeof cb !== "function") cb = uid, uid = null
  if (uid == null) uid = process.getuid()
  if (!isNaN(uid)) uid = uidCache[uid] = +uid

  if (uidCache.hasOwnProperty(uid)) uid = uidCache[uid]

  if (typeof uid === "number") {
    return process.nextTick(cb.bind(null, uid))
  }

  var getter = require.resolve(__dirname + "/get-uid.js")

  // in the future: there's the ~username trick too to get the homedir of any user...

  if (process.platform === 'linux') {
    const passwd = fs.readFileSync('/etc/passwd', 'utf-8')
    const lines = passwd.split('\n')
    for(var i in lines) {
      var tLine = lines[i].trim()
      const user = extractLinux(tLine)
      if (user.username == uid) {
        uidCache[uid] = +user.userIdentifier
        return cb(null, user.userIdentifier, user.homeDirectory)

      }
    }
    return cb('404')
  }
  // not linux...
  child_process.execFile( '/usr/bin/id', ['-P', uid], function (code, out, stderr) {
    if (code) {
      cb(stderr)
      return
    }
    //console.log('out', out)
    const user = extractDarwin(out.trim())
    cb(null, user.userIdentifier, user.homeDirectory)
  })

  /*
  child_process.execFile( process.execPath
                        , [getter, uid]
                        , function (code, out, stderr) {
    if (code) {
      var er = new Error("could not get uid\n" + stderr)
      er.code = code
      return cb(er)
    }
    //console.log('out', out)

    try {
      out = JSON.parse(out+"")
    } catch (ex) {
      return cb(ex)
    }
    //console.dir(out)

    if (out.error) {
      var er = new Error(out.error)
      er.errno = out.errno
      return cb(er)
    }

    if (isNaN(out.uid)) return cb(new Error(
      "Could not get uid: "+JSON.stringify(out)))

    cb(null, uidCache[uid] = +out.uid, out.homeDir)
  })
  */
}

module.exports = {
  uidNumber: uidNumber,
  uidGidNumber: uidGidNumber,
}
