// no npm!
const fs = require('fs')


function start(config, entrypoint) {
  if (fs.existsSync('/etc/systemd/system/lokid.service')) {
    console.log('detected lokid.service')
    // read file
    const service_bytes = fs.readFileSync('/etc/systemd/system/lokid.service')
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
        fs.writeFileSync('/etc/systemd/system/lokid.service', newBytes)
      }
    }
  }
}

module.exports = {
  start: start
}
