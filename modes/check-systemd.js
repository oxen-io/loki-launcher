// no npm!
const fs = require('fs')
const cp = require('child_process')
const execSync = cp.execSync
const spawn = cp.spawn
const lokinet = require(__dirname + '/../lokinet')

function rewriteServiceFile(serviceFile, entrypoint) {
  console.log('detected', serviceFile)
  // read file
  const service_bytes = fs.readFileSync(serviceFile)
  var lines = service_bytes.toString().split(/\n/)
  var nLines = []
  var needsBinaryUpdate = false
  var needsNoFileUpdate = true
  for(var i in lines) {
    var tline = lines[i].trim()
    if (tline.match(/^LimitNOFILE=/)) {
      needsNoFileUpdate = false
    }
    if (tline.match(/ExecStart/)) {
      //console.log('ExecStart', tline)
      if (tline.match(/lokid/)) {
        console.log('ExecStart uses lokid directly')
        needsBinaryUpdate = true
        // replace ExecStart
        tline = 'ExecStart=' + entrypoint + ' systemd-start'
      }
    }
    nLines.push(tline)
  }
  // patch up nLines if needed
  if (needsNoFileUpdate) {
    const cLines = [...nLines]
    nLines = []
    for(line of cLines) {
      if (line.match(/\[Service\]/i)) {
        nLines.push(line.trim())
        nLines.push('LimitNOFILE=16384')
        continue
      }
      nLines.push(line.trim())
    }
    //console.log('lines', nLines)
  }
  if (needsBinaryUpdate || needsNoFileUpdate) {
    if (process.getuid() != 0) {
      console.warn('can not update your lokid.service, not running as root, please run with sudo')
    } else {
      console.log('updating lokid.service')
      var newBytes = nLines.join("\n")
      fs.writeFileSync(serviceFile, newBytes)
      const found = lokinet.getBinaryPath('getcap')
      if (found) {
        try {
          execSync('systemctl daemon-reload')
          // FIXME also run:
          // systemctl enable lokid
          // systemctl start lokid? no, we reboot on fresh install
        } catch(e) {
          console.warn('(Error when trying to reload: ', e.message, ') You may need to run: systemctl daemon-reload')
        }
      } else {
        console.log('You may need to run: systemctl daemon-reload')
      }
      return true
    }
  }
  return false
}

// we actually currently don't use config at all... but we likely will evenutally
async function start(config, entrypoint) {
  const lib = require(__dirname + '/../lib')
  // address issue #19
  lib.stopLauncher(config)

  if (fs.existsSync('/etc/systemd/system/lokid.service')) {
    rewriteServiceFile('/etc/systemd/system/lokid.service', entrypoint)
  } else {
    console.debug('/etc/systemd/system/lokid.service does not exist.')
    console.error('You may not be running your Service Node as a system Service, please follow the full guide to reconfigure your node')
  }
  /*
  if (fs.existsSync('/lib/systemd/system/loki-node.service')) {
    rewriteServiceFile('/lib/systemd/system/loki-node.service')
  }
  */
  if (fs.existsSync('/lib/systemd/system/loki-node.service')) {
    // systemctl is-enabled loki-node
    let isEnabled = null
    try {
      const out = execSync('systemctl is-enabled loki-node')
      isEnabled = out.toString() !== 'disabled'
    } catch (err) {
      isEnabled = err.stdout.toString().trim() !== 'disabled'
    }
    if (isEnabled) {
      console.warn('detected a DEBs install, you should not run both the DEBs and the launcher')
      console.log('To disable the DEBs install, please run: sudo systemctl disable --now loki-node.service')
    }
  }
}

function launcherLogs(config) {
  const stdout = execSync('journalctl -u lokid')
  console.log(stdout.toString())
}

function isActive() {
  try {
    const stdout = execSync('systemctl is-active lokid')
    return !stdout.toString().match(/inactive/)
  } catch (e) {
    return
  }
}

function isEnabled(config) {
  if (!fs.existsSync('/etc/systemd/system/lokid.service')) {
    return
  }
  try {
    // and probably should make sure it's using our entrypoint
    // incase there's multiple snode?
    const stdoutShow = execSync('systemctl show lokid')
    // console.log('stdoutShow', stdoutShow.toString())
    if (stdoutShow.toString().includes(config.entrypoint)) {
      const stdout = execSync('systemctl is-enabled lokid')
      return stdout.toString().match(/enabled/)
    } else {
      console.log('System has systemd service but not for', config.entrypoint)
      // console.log(stdoutShow.toString())
    }
    return false
  } catch (e) {
    return
  }
}

// from (MIT) https://github.com/nmorsman/node-systemd-notify/blob/master/notify.js
function generateArgs(opts) {
  const result = []

  if (('ready' in opts) && (opts.ready === true)) {
    result.push('--ready')
  }

  if ('pid' in opts) {
    result.push(`--pid=${opts.pid}`)
  }
  else if (('ready' in opts) || ('status' in opts)) {
    /**
     * Always send PID to avoid possible race condition
     * https://www.pluralsight.com/tech-blog/using-systemd-notify-with-nodejs/
     */

    result.push(`--pid=${process.pid}`)
  }

  if ('status' in opts) {
    result.push(`--status=${opts.status}`)
  }

  if (('booted' in opts) && (opts.booted === true)) {
    result.push('--booted')
  }

  return result
}

function notifySystemd(opts = {}, callback) {
  return new Promise((resolve, reject) => {
    const args = generateArgs(opts)
    const cmd = spawn('systemd-notify', args)

    let stdout = ''
    let stderr = ''
    let hasCalledBack = false

    cmd.stdout.on('data', (d) => { stdout += d })
    cmd.stderr.on('data', (d) => { stderr += d })

    cmd.on('error', (err) => {
      if (hasCalledBack) {
        return null
      }

      hasCalledBack = true
      return (typeof callback === 'function') ? callback(err) : reject(err)
    })

    cmd.on('close', (code) => {
      if (hasCalledBack) {
        return null
      }

      hasCalledBack = true

      if (code !== 0) {
        const err = stderr.trim() || stdout.trim()
        return (typeof callback === 'function') ? callback(err) : reject(err)
      }

      return (typeof callback === 'function') ? callback(null, cmd) : resolve(cmd)
    })
  })
}

module.exports = {
  start: start,
  launcherLogs: launcherLogs,
  isStartedWithSystemD: isActive,
  isSystemdEnabled: isEnabled,
  notifySystemd: notifySystemd,
}
