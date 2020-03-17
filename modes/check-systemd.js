// no npm!
const fs = require('fs')
const cp = require('child_process')
const execSync = cp.execSync
const lib = require(__dirname + '/../lib')

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
        tline = 'ExecStart=' + entrypoint + ' systemd-start';
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
      execSync('systemctl daemon-reload')
      return true
    }
  }
  return false
}

// we actually currently don't use config at all... but we likely will evenutally
function start(config, entrypoint) {
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

module.exports = {
  start: start
}
