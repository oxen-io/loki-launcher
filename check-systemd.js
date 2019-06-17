// no npm!
const fs = require('fs')


function rewriteServiceFile(serviceFile) {
  console.log('detected', serviceFile)
  // read file
  const service_bytes = fs.readFileSync(serviceFile)
  var lines = service_bytes.toString().split(/\n/)
  var nLines = []
  var needsUpdate = false
  for(var i in lines) {
    var tline = lines[i].trim()
    if (tline.match(/ExecStart/)) {
      //console.log('ExecStart', tline)
      if (tline.match(/lokid/)) {
        console.log('ExecStart uses lokid directly')
        needsUpdate = true
        // replace ExecStart
        tline = 'ExecStart=' + entrypoint + ' systemd-start';
      }
    }
    nLines.push(tline)
  }
  if (needsUpdate) {
    if (process.getuid() != 0) {
      console.warn('can not update your lokid.service, not running as root, please run with sudo')
    } else {
      console.log('updating lokid.service')
      var newBytes = nLines.join("\n")
      fs.writeFileSync(serviceFile, newBytes)
      // FIXME: `sudo systemctl daemon-reload`
    }
  }
}

function start(config, entrypoint) {
  if (fs.existsSync('/etc/systemd/system/lokid.service')) {
    rewriteServiceFile('/etc/systemd/system/lokid.service')
  } else {
    console.debug('/etc/systemd/system/lokid.service does not exist.')
    console.error('You may not be running your Service Node as a system Service, please follow the full guide to reconfigure your node')
  }
  // https://discordapp.com/channels/408081923835953153/583133711407513630/590010043907440656
  /*
  if (fs.existsSync('/lib/systemd/system/loki-node.service')) {
    rewriteServiceFile('/lib/systemd/system/loki-node.service')
  }
  */
}

module.exports = {
  start: start
}
