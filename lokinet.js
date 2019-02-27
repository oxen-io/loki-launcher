// no npm!
const os        = require('os')
const fs        = require('fs')
const dns       = require('dns')
const net       = require('net')
const http      = require('http')
const { spawn, exec } = require('child_process')
const stdin     = process.openStdin()

function getBoundIPv4s() {
  var nics = os.networkInterfaces()
  var ipv4s = []
  for(var adapter in nics) {
    var ips = nics[adapter]
    for(var ipIdx in ips) {
      var ipMap = ips[ipIdx]
      if (ipMap.address.match(/\./)) {
        ipv4s.push(ipMap.address)
      }
    }
  }
  return ipv4s
}

var auto_config_test_port, auto_config_test_host
function getNetworkIP(callback) {
  var socket = net.createConnection(auto_config_test_port, auto_config_test_host);
  socket.on('connect', function() {
    callback(undefined, socket.address().address);
    socket.end();
  });
  socket.on('error', function(e) {
    callback(e, 'error');
  });
}

function getIfNameFromIP(ip) {
  var nics = os.networkInterfaces()
  var ipv4s = []
  for(var adapter in nics) {
    var ips = nics[adapter]
    for(var ipIdx in ips) {
      var ipMap = ips[ipIdx]
      if (ipMap.address == ip) {
        return adapter
      }
    }
  }
  return ''
}

function httpGet(url, cb) {
  http.get(url, {
    timeout: 5000,
  }, (resp) => {
    resp.setEncoding('binary')
    let data = ''
    // A chunk of data has been recieved.
    resp.on('data', (chunk) => {
      data += chunk
    })
    // The whole response has been received. Print out the result.
    resp.on('end', () => {
      cb(data)
    })
  }).on("error", (err) => {
    console.error("httpGet Error: " + err.message)
    cb()
  })
}

function randomString(len) {
  var text = ""
  var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  for (var i = 0; i < len; i++)
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  return text;
}

function isDnsPort(ip, port, cb) {
  const resolver = new dns.Resolver()
  resolver.setServers([ip + ':' + port])
  resolver.resolve(auto_config_test_host, function(err, records) {
    if (err) console.error('resolve error: ', err)
    console.log(auto_config_test_host, records)
    cb(records !== undefined)
  })
}

function readResolv(cb) {
  const localIPs = getBoundIPv4s()
  var servers = []
  var checksLeft = 0

  function checkDone() {
    checksLeft--
    if (checksLeft<=0) {
      console.log('readResolv done')
      cb(servers)
    }
  }

  var resolvers = dns.getServers()
  console.log('Current resolvers', resolvers)
  for(var i in resolvers) {
    const server = resolvers[i]
    var idx = localIPs.indexOf(server)
    if (idx != -1) {
      console.log('local DNS server detected', server)
      const resolver = new dns.Resolver()
      resolver.setServers([server])
      checksLeft++
      resolver.resolve('localhost.loki', function(err, records) {
        //if (err) console.error(err)
        //console.log('local dns test results', records)
        if (records === undefined) {
          // not lokinet
          console.log(server, 'is not a lokinet DNS server')
          servers.push(server)
        }
        checkDone()
      })
    } else {
      // non-local
      console.log('found remote DNS server', server)
      servers.push(server)
    }
  }
  checksLeft++
  checkDone()
  /*
  const data = fs.readFileSync('/etc/resolv.conf', 'utf-8')
  const lines = data.split(/\n/)

  for(var i in lines) {
    var line = lines[i].trim()
    if (line.match(/#/)) {
      var parts = line.split(/#/)
      line = parts[0].trim()
    }
    // done reducing
    if (!line) continue
    if (line.match(/^nameserver /)) {
      const server = line.replace(/^nameserver /, '')
      var idx = localIPs.indexOf(server)
      if (idx != -1) {
        console.log('local DNS server detected', server)
        const resolver = new dns.Resolver()
        resolver.setServers([server])
        checksLeft++
        resolver.resolve('localhost.loki', function(err, records) {
          //if (err) console.error(err)
          //console.log('local dns test results', records)
          if (records === undefined) {
            // not lokinet
            console.log(server, 'is not a lokinet DNS server')
            servers.push(server)
          }
          checkDone()
        })
      } else {
        // non-local
        console.log('found remote DNS server', server)
        servers.push(server)
      }
      continue
    }
    checkDone()
    console.error('readResolv unknown', line)
  }
  return servers
  */
}

function iniToJSON(data) {
  const lines = data.split(/\n/)
  var section = 'unknown'
  var config = {}
  for(var i in lines) {
    var line = lines[i].trim()
    if (line.match(/#/)) {
      var parts = line.split(/#/)
      line = parts[0].trim()
    }
    // done reducing
    if (!line) continue

    // check for section
    if (line[0] == '[' && line[line.length - 1] == ']') {
      section = line.substring(1, line.length -1)
      if (config[section] === undefined) config[section] = {}
      //console.log('found section', section)
      continue
    }
    // key value pair
    if (line.match(/=/)) {
      var parts = line.split(/=/)
      var key = parts.shift()
      var value = parts.join('=')
      //console.log('key/pair ['+section+']', key, '=', value)
      config[section][key]=value
      continue
    }
    console.error('config ['+section+'] not section or key/value pair', line)
  }
  return config
}

function jsonToINI(json) {
  var lastSection = 'unknown'
  var config = ''
  for(var section in json) {
    config += '[' + section + ']' + "\n"
    var keys = json[section]
    for(var key in keys) {
      // FIXME: if keys[key] is an array, then we need to send the same key each time
      config += key + '=' + keys[key] + "\n"
    }
  }
  return config
}

// this can really delay the start of lokinet
function findFreePort53(ips, index, cb) {
  console.log('testing', ips[index], 'port 53')
  isDnsPort(ips[index], 53, function(res) {
    //console.log('isDnsPort res', res)
    // false
    if (!res) {
      console.log('Found free port 53 on', ips[index], index)
      cb(ips[index])
      return
    }
    console.log('Port 53 is not free on', ips[index], index)
    if (index + 1 == ips.length) {
      cb()
      return
    }
    findFreePort53(ips, index + 1, cb)
  })
}

function generateSerivceNodeINI(config, cb) {
  const homeDir = os.homedir()
  //console.log('homeDir', homeDir)
  //const data = fs.readFileSync(homeDir + '/.lokinet/lokinet.ini', 'utf-8')
  //const jConfig = iniToJSON(data)
  //console.dir(jConfig)
  //const iConfig = jsonToINI(jConfig)
  //console.log(iConfig)
  var done = {
    bootstrap: false,
    upstream : false,
    rpcCheck : false,
    dnsBind  : false,
  }
  var upstreams, lokinet_free53Ip, lokinet_nic
  var use_lokinet_rpc_port = config.rpc_port
  var lokinet_bootstrap_path = homeDir + '/.lokinet/bootstrap.signed'
  var lokinet_nodedb = homeDir + '/.lokinet/netdb'
  if (config.testnet) {
    lokinet_nodedb += '-staging'
  }
  function markDone(completeProcess) {
    done[completeProcess] = true
    let ready = true
    for(var i in done) {
      if (!done[i]) {
        ready = false
        console.log(i, 'is not ready')
        break
      }
    }
    if (!ready) return
    var keyPath = homeDir + '/.loki/'
    if (config.lokid.network.toLowerCase() == "test" || config.lokid.network.toLowerCase() == "testnet" || config.lokid.network.toLowerCase() == "test-net") {
      keyPath += 'testnet/'
    }
    keyPath += 'key'
    console.log('Drafting lokinet config')
    cb(`
[dns]
${upstreams}
bind=${lokinet_free53Ip}:53

[netdb]
dir=${lokinet_nodedb}

[bootstrap]
add-node=${lokinet_bootstrap_path}

[bind]
${lokinet_nic}=${config.public_port}

[network]
enabled=false

[api]
enabled=true
bind=${config.rpc_ip}:${config.rpc_port}

[lokid]
enabled=true
jsonrpc=${config.lokid.rpc_ip}:${config.lokid.rpc_port}
username=${config.lokid.rpc_user}
password=${config.lokid.rpc_pass}
service-node-seed=${keyPath}
`)
  }
  httpGet(config.bootstrap_url, function(bootstrapData) {
    const tmpRcPath = os.tmpdir() + '/' + randomString(8) + '.lokinet_signed'
    fs.writeFileSync(tmpRcPath, bootstrapData, 'binary')
    console.log('boostrap wrote', bootstrapData.length, 'bytes to', tmpRcPath)
    lokinet_bootstrap_path = tmpRcPath
    markDone('bootstrap')
  })
  readResolv(function(servers) {
    upstreams = 'upstream='+servers.join('\nupstream=')
    markDone('upstream')
  })
  console.log('trying', 'http://'+config.rpc_ip+':'+config.rpc_port)
  httpGet('http://'+config.rpc_ip+':'+config.rpc_port, function(testData) {
    //console.log('rpc has', testData)
    if (testData !== undefined) {
      console.log('Bumping RPC port', testData)
      use_lokinet_rpc_port = lokinet_rpc_port + 1
    }
    markDone('rpcCheck')
  })
  getNetworkIP(function(e, ip) {
    console.log('detected outgoing interface ip', ip)
    lokinet_nic = getIfNameFromIP(ip)
    console.log('detected outgoing interface', lokinet_nic)
    var tryIps = ['127.0.0.1']
    if (os.platform() == 'linux') {
      tryIps.push('127.3.2.1')
    }
    tryIps.push(ip)
    findFreePort53(tryIps, 0, function(free53Ip) {
      if (free53Ip === undefined) {
        console.error('Cant automatically find an IP to put a lokinet DNS server on')
        process.exit()
      }
      lokinet_free53Ip = free53Ip
      console.log('binding DNS port 53 to', free53Ip)
      markDone('dnsBind')
    })
  })
}

function generateClientINI(config, cb) {
  const homeDir = os.homedir()
  //console.log('homeDir', homeDir)
  //const data = fs.readFileSync(homeDir + '/.lokinet/lokinet.ini', 'utf-8')
  //const jConfig = iniToJSON(data)
  //console.dir(jConfig)
  //const iConfig = jsonToINI(jConfig)
  //console.log(iConfig)
  var done = {
    bootstrap: false,
    upstream : false,
    rpcCheck : false,
    dnsBind  : false,
  }
  var upstreams, lokinet_free53Ip, lokinet_nic
  var use_lokinet_rpc_port = config.rpc_port
  var lokinet_bootstrap_path = homeDir + '/.lokinet/bootstrap.signed'
  var lokinet_nodedb = homeDir + '/.lokinet/netdb'
  if (config.testnet) {
    lokinet_nodedb += '-staging'
  }
  function markDone(completeProcess) {
    done[completeProcess] = true
    let ready = true
    for(var i in done) {
      if (!done[i]) {
        ready = false
        console.log(i, 'is not ready')
        break
      }
    }
    if (!ready) return
    var keyPath = homeDir + '/.loki/'
    if (config.lokid.network.toLowerCase() == "test" || config.lokid.network.toLowerCase() == "testnet" || config.lokid.network.toLowerCase() == "test-net") {
      keyPath += 'testnet/'
    }
    keyPath += 'key'
    console.log('Drafting lokinet config')
    cb(`
[dns]
${upstreams}
bind=${lokinet_free53Ip}:53

[netdb]
dir=${lokinet_nodedb}

[bootstrap]
add-node=${lokinet_bootstrap_path}

[network]
#enabled=false

[api]
enabled=true
bind=${config.rpc_ip}:${config.rpc_port}
`)
  }
  httpGet(config.bootstrap_url, function(bootstrapData) {
    const tmpRcPath = os.tmpdir() + '/' + randomString(8) + '.lokinet_signed'
    fs.writeFileSync(tmpRcPath, bootstrapData, 'binary')
    console.log('boostrap wrote', bootstrapData.length, 'bytes to', tmpRcPath)
    lokinet_bootstrap_path = tmpRcPath
    markDone('bootstrap')
  })
  readResolv(function(servers) {
    upstreams = 'upstream='+servers.join('\nupstream=')
    markDone('upstream')
  })
  console.log('trying', 'http://'+config.rpc_ip+':'+config.rpc_port)
  httpGet('http://'+config.rpc_ip+':'+config.rpc_port, function(testData) {
    //console.log('rpc has', testData)
    if (testData !== undefined) {
      console.log('Bumping RPC port', testData)
      // maybe just turn it off here...
      use_lokinet_rpc_port = lokinet_rpc_port + 1
    }
    markDone('rpcCheck')
  })
  getNetworkIP(function(e, ip) {
    console.log('detected outgoing interface ip', ip)
    lokinet_nic = getIfNameFromIP(ip)
    console.log('detected outgoing interface', lokinet_nic)
    var tryIps = ['127.0.0.1']
    if (os.platform() == 'linux') {
      tryIps.push('127.3.2.1')
    }
    tryIps.push(ip)
    findFreePort53(tryIps, 0, function(free53Ip) {
      if (free53Ip === undefined) {
        console.error('Cant automatically find an IP to put a lokinet DNS server on')
        process.exit()
      }
      lokinet_free53Ip = free53Ip
      console.log('binding DNS port 53 to', free53Ip)
      markDone('dnsBind')
    })
  })
}

var shuttingDown
var lokinet
function launchLokinet(config, cb) {
  const tmpDir = os.tmpdir()
  //console.log('tmpPath', tmpPath)
  const tmpPath = tmpDir + '/' + randomString(8) + '.lokinet_ini'

  if (os.platform() == 'linux') {
    // not root-like
    exec('getcap ' + config.binary_location, function (error, stdout, stderr) {
      console.log('stdout', stdout)
      if (stdout == '') {
        if (process.getgid() != 0) {
          conole.log(config.binary_location, 'does not have setcap')
          process.exit()
        } else {
          // are root
          console.log('going to try to setcap your binary, so you dont need root')
          exec('setcap cap_net_admin,cap_net_bind_service=+eip ' + config.binary_location, function (error, stdout, stderr) {
            console.log('binary permissions upgraded')
          })
        }
      }
    })
  }

  config.ini_writer(config, function (iniData) {
    console.log(iniData)
    fs.writeFileSync(tmpPath, iniData)
    //
    lokinet = spawn(config.binary_location, ['-v', tmpPath]);
    lokinet.stdout.on('data', (data) => {
      var parts = data.toString().split(/\n/)
      parts.pop()
      data = parts.join('\n')
      console.log(`lokinet: ${data}`)
    })

    lokinet.stderr.on('data', (data) => {
      console.log(`lokineterr: ${data}`)
    })

    lokinet.on('close', (code) => {
      console.log(`lokinet process exited with code ${code}`)
      fs.unlinkSync(tmpPath) // clean up
      if (shuttingDown) {
        console.log('loki_daemon is also down, stopping launcher')
      } else {
        console.log('loki_daemon is still running, restarting lokinet')
        launchLokinet(config)
      }
    })
    if (cb) cb()
  })
}

function startServiceNode(config, cb) {
  auto_config_test_port = config.auto_config_test_port
  auto_config_test_host = config.auto_config_test_host
  config.ini_writer = generateSerivceNodeINI
  launchLokinet(config, cb)
}
function startClient(config, cb) {
  auto_config_test_port = config.auto_config_test_port
  auto_config_test_host = config.auto_config_test_host
  config.ini_writer = generateClientINI
  launchLokinet(config, cb)
}

// return a truish value if so
function isRunning() {
  return lokinet
}

function stop() {
  if (lokinet) {
    console.log('requesting lokinet be shutdown')
    shuttingDown = true
    process.kill(lokinet.pid)
  }
}

module.exports = {
  startServiceNode : startServiceNode,
  startClient      : startClient,
  isRunning        : isRunning,
  stop             : stop,
}

//console.log('userInfo', os.userInfo('utf8'))
//console.log('started as', process.getuid(), process.geteuid())
/*
if (os.platform() == 'darwin') {
  if (process.getuid() != 0) {
    console.error('MacOS requires you start this with sudo')
    process.exit()
  }
} else {
  if (process.getuid() == 0) {
    console.error('Its not recommended you run this as root')
  }
}
*/
