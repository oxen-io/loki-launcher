// no npm!
const fs = require('fs')

if (fs.existsSync('/etc/systemd/system/lokid.service')) {
  // read file
  // rewrite
  // save
  // reload
}

function start() {
//
}

module.exports = {
  start: start
}
