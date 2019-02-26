// no npm!
const os        = require('os')
const fs        = require('fs')
const dns       = require('dns')
const net       = require('net')
const { spawn } = require('child_process');
const stdin     = process.openStdin()

// TODO storage server
// FIXME:
var lokid_location = 'src/loki/build/release/bin/lokid'
if (os.platform() == 'linux') {
  lokid_location = 'src/loki/build/Linux/dev/release/bin/lokid'
}
const lokinet_location = 'src/loki-network/lokinet'
const lokid_testnet = true

// reads ~/.loki/testnet/key
const lokid_rpc_ip   = '127.0.0.1'
const lokid_rpc_user = 'user'
const lokid_rpc_pass = 'pass'
const lokid_rpc_port = 38157
const lokinet_bootstrap_url = 'http://206.81.100.174/n-st-1.signed'
const lokinet_bootstrap = 'n-st-1.signed'
const lokinet_rpc_ip    = '127.0.0.1'
const lokinet_rpc_port  = 28082
const lokinet_public_port = 1090
const auto_config_test_host = 'www.google.com'
const auto_config_test_port = 80

if (os.platform() == 'darwin') {
  process.env.DYLD_LIBRARY_PATH = 'depbuild/boost_1_64_0/stage/lib'
}

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

var shuttingDown = false

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
    if (err) console.error(err)
    console.log(auto_config_test_host, records)
    cb(records === undefined)
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

function findFreePort53(ips, index, cb) {
  console.log('testing', ips[index], 'port 53')
  isDnsPort(ips[index], 53, function(res) {
    //console.log('no dns server on', tryIps[0], 53, res)
    if (res) {
      cb(ips[index])
      return
    }
    if (index + 1 == ips.length) {
      cb()
      return
    }
    findFreePort53(ips, index + 1, cb)
  })
}

function makeConfig(cb) {
  const homeDir = os.homedir()
  //console.log('homeDir', homeDir)
  //const data = fs.readFileSync(homeDir + '/.lokinet/lokinet.ini', 'utf-8')
  //const jConfig = iniToJSON(data)
  //console.dir(jConfig)
  //const iConfig = jsonToINI(jConfig)
  //console.log(iConfig)
  readResolv(function(servers) {
    var upstreams = 'upstream='+servers.join('\nupstream=')
    getNetworkIP(function(e, ip) {
      console.log('detected outgoing interface ip', ip)
      var nic = getIfNameFromIP(ip)
      console.log('detected outgoing interface', nic)
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
        console.log('binding DNS port 53 to', free53Ip)
        var keyPath = homeDir + '/.loki/'
        if (lokid_testnet) {
          keyPath += 'testnet/'
        }
        keyPath += 'key'
        cb(`
[dns]
${upstreams}
bind=${free53Ip}:53

[netdb]
dir=${homeDir}/.lokinet/netdb-staging

[bootstrap]
add-node=${homeDir}/.lokinet/${lokinet_bootstrap}

[bind]
${nic}=${lokinet_public_port}

[api]
enabled=true
bind=${lokinet_rpc_ip}:${lokinet_rpc_port}

[lokid]
enabled=true
jsonrpc=${lokid_rpc_ip}:${lokid_rpc_port}
username=${lokid_rpc_user}
password=${lokid_rpc_pass}
service-node-seed=${keyPath}
`)
      })
    })
  })
}

var lokinet
function launchLokinet(cb) {
  const tmpDir = os.tmpdir()
  //console.log('tmpPath', tmpPath)
  const tmpPath = tmpDir + '/' + randomString(8) + '.lokinet_ini'

  makeConfig(function (iniData) {
    console.log(iniData)
    fs.writeFileSync(tmpPath, iniData)
    // '-v',
    lokinet = spawn(lokinet_location, [tmpPath]);
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
      if ((loki_daemon && loki_daemon.killed) || shuttingDown) {
        console.log('loki_daemon is also down, stopping launcher')
        stdin.pause()
      } else {
        console.log('loki_daemon is still running, restarting lokinet')
        launchLokinet()
      }
    })
    if (cb) cb()
  })
}

//console.log('userInfo', os.userInfo('utf8'))
//console.log('started as', process.getuid(), process.geteuid())
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

launchLokinet()

/*
try {
  process.seteuid('rtharp')
  console.log(`New uid: ${process.geteuid()}`)
} catch(err) {
  console.log(`Failed to set uid: ${err}`)
}
*/

var lokid_options = ['--service-node', '--rpc-login='+lokid_rpc_user+':'+lokid_rpc_pass+'']
if (lokid_testnet) {
  lokid_options.push('--testnet')
}
const loki_daemon = spawn(lokid_location, lokid_options);

loki_daemon.stdout.on('data', (data) => {
  var parts = data.toString().split(/\n/)
  parts.pop()
  data = parts.join('\n')
  if (data.trim()) {
    console.log(`lokid: ${data}`)
  }
})

loki_daemon.stderr.on('data', (data) => {
  console.log(`lokiderr: ${data}`)
})

loki_daemon.on('close', (code) => {
  console.log(`loki_daemon process exited with code ${code}`)
  shuttingDown = true
  if (lokinet && !lokinet.killed) {
    console.log('requesting lokinet be shutdown')
    process.kill(lokinet.pid)
  }
  if (!lokinet) {
    console.log('lokinet is not running, trying to exit')
    // may not be started yet or already dead..
    // need to kill node
    process.exit()
  }
})

// resume stdin in the parent process (node app won't quit all by itself
// unless an error or process.exit() happens)
stdin.resume()

// i don't want binary, do you?
stdin.setEncoding( 'utf8' )

// on any data into stdin
stdin.on( 'data', function( key ){
  // ctrl-c ( end of text )
  if ( key === '\u0003' ) {
    process.exit()
  }
  // local echo, write the key to stdout all normal like
  if (!shuttingDown) {
    // on ssh we don't need this
    //process.stdout.write(key)
    loki_daemon.stdin.write(key)
  }
})

process.on('SIGHUP', () => {
  console.log('shuttingDown?', shuttingDown)
  console.log('loki_daemon status', loki_daemon)
  console.log('lokinet status', lokinet)
})

})
