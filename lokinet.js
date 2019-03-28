// no npm!
const os        = require('os')
const fs        = require('fs')
const dns       = require('dns')
const net       = require('net')
const ini       = require('./ini')
const path      = require('path')
const http      = require('http')
const { spawn, exec } = require('child_process')

// FIXME: disable rpc if desired
const VERSION = 0.2
console.log('lokinet launcher version', VERSION, 'registered')

function log() {
  var args = []
  for(var i in arguments) {
    args.push(arguments[i])
  }
  console.log('LAUNCHER:', args.join(' '))
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

var auto_config_test_port, auto_config_test_host
// this doesn't need to connect completely to get our ip
function getNetworkIP(callback) {
  var socket = net.createConnection(auto_config_test_port, auto_config_test_host)
  socket.on('connect', function() {
    callback(undefined, socket.address().address)
    socket.end()
  })
  socket.on('error', function(e) {
    callback(e, 'error')
  })
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

const urlparser = require('url')

function httpGet(url, cb) {
  const urlDetails = urlparser.parse(url)
  //console.log('httpGet', url)
  http.get({
    hostname: urlDetails.hostname,
    protocol: urlDetails.protocol,
    port: urlDetails.port,
    path: urlDetails.path,
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
    console.error("httpGet Error: " + err.message, 'port', urlDetails.port)
    //console.log('err', err)
    cb()
  })
}

// used for generating temp filenames
function randomString(len) {
  var text = ""
  var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  for (var i = 0; i < len; i++)
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  return text
}

function isDnsPort(ip, port, cb) {
  const resolver = new dns.Resolver()
  resolver.setServers([ip + ':' + port])
  resolver.resolve(auto_config_test_host, function(err, records) {
    if (err) console.error('resolve error: ', err)
    log(auto_config_test_host, records)
    cb(records !== undefined)
  })
}

function testDNSForLokinet(server, cb) {
  const resolver = new dns.Resolver()
  resolver.setServers([server])
  resolver.resolve('localhost.loki', function(err, records) {
    //if (err) console.error(err)
    //console.log(server, 'dns test results', records)
    cb(records)
  })
}

function findLokiNetDNS(cb) {
  const localIPs = getBoundIPv4s()
  function checkDone() {
    if (shuttingDown) {
      //if (cb) cb()
      log('not going to start lokinet, shutting down')
      return
    }
    checksLeft--
    if (checksLeft<=0) {
      log('readResolv done')
      cb(servers)
    }
  }
  /*
  var resolvers = dns.getServers()
  console.log('Current resolvers', resolvers)
  // check local DNS servers in resolv config
  for(var i in resolvers) {
    const server = resolvers[i]
    var idx = localIPs.indexOf(server)
    if (idx != -1) {
      // local DNS server
      console.log('local DNS server detected', server)
      checksLeft++
      testDNSForLokinet(server, function(isLokinet) {
        if (isLokinet) {
          // lokinet
          console.log(server, 'is a lokinet DNS server')
          servers.push(server)
        }
        checkDone()
      })
    }
  }
  */
  // maybe check all local ips too
  for(var i in localIPs) {
    const server = localIPs[i]
    checksLeft++
    testDNSForLokinet(server, function(isLokinet) {
      if (isLokinet !== undefined) {
        // lokinet
        log(server, 'is a lokinet DNS server')
        servers.push(server)
      }
      checkDone()
    })
  }
}

function readResolv(cb) {
  const localIPs = getBoundIPv4s()
  var servers = []
  var checksLeft = 0

  function checkDone() {
    if (shuttingDown) {
      //if (cb) cb()
      log('not going to start lokinet, shutting down')
      return
    }
    checksLeft--
    if (checksLeft<=0) {
      log('readResolv done')
      cb(servers)
    }
  }

  var resolvers = dns.getServers()
  log('Current resolvers', resolvers)
  for(var i in resolvers) {
    const server = resolvers[i]
    var idx = localIPs.indexOf(server)
    if (idx != -1) {
      log('local DNS server detected', server)
      testDNSForLokinet(server, function(isLokinet) {
        if (isLokinet === undefined) {
          // not lokinet
          log(server, 'is not a lokinet DNS server')
          servers.push(server)
        }
        checkDone()
      })
    } else {
      // non-local
      log('found remote DNS server', server)
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

// this can really delay the start of lokinet
function findFreePort53(ips, index, cb) {
  log('testing', ips[index], 'port 53')
  isDnsPort(ips[index], 53, function(res) {
    //console.log('isDnsPort res', res)
    // false
    if (!res) {
      log('Found free port 53 on', ips[index], index)
      cb(ips[index])
      return
    }
    log('Port 53 is not free on', ips[index], index)
    if (index + 1 == ips.length) {
      cb()
      return
    }
    findFreePort53(ips, index + 1, cb)
  })
}

// https://stackoverflow.com/a/40686853
function mkDirByPathSync(targetDir, { isRelativeToScript = false } = {}) {
  const sep = path.sep
  const initDir = path.isAbsolute(targetDir) ? sep : ''
  const baseDir = isRelativeToScript ? __dirname : '.'

  return targetDir.split(sep).reduce((parentDir, childDir) => {
    const curDir = path.resolve(baseDir, parentDir, childDir)
    try {
      fs.mkdirSync(curDir)
    } catch (err) {
      if (err.code === 'EEXIST') { // curDir already exists!
        return curDir
      }

      // To avoid `EISDIR` error on Mac and `EACCES`-->`ENOENT` and `EPERM` on Windows.
      if (err.code === 'ENOENT') { // Throw the original parentDir error on curDir `ENOENT` failure.
        throw new Error(`EACCES: permission denied, mkdir '${parentDir}'`)
      }

      const caughtErr = ['EACCES', 'EPERM', 'EISDIR'].indexOf(err.code) > -1
      if (!caughtErr || caughtErr && curDir === path.resolve(targetDir)) {
        throw err // Throw if it's just the last created dir.
      }
    }

    return curDir
  }, initDir)
}

function makeMultiplatformPath(path) {
  return path
}

var cleanUpBootstrap = false
var cleanUpIni       = false
function generateINI(config, markDone, cb) {
  const homeDir = os.homedir()
  //console.log('homeDir', homeDir)
  //const data = fs.readFileSync(homeDir + '/.lokinet/lokinet.ini', 'utf-8')
  //const jConfig = iniToJSON(data)
  //console.dir(jConfig)
  //const iConfig = jsonToINI(jConfig)
  //console.log(iConfig)
  var upstreams, lokinet_free53Ip, lokinet_nic
  var use_lokinet_rpc_port = config.rpc_port
  var lokinet_bootstrap_path = homeDir + '/.lokinet/bootstrap.signed'
  var lokinet_nodedb = homeDir + '/.lokinet/netdb'
  if (config.testnet) {
    lokinet_nodedb += '-service'
  }
  if (!fs.existsSync(lokinet_nodedb)) {
    log('making', lokinet_nodedb)
    mkDirByPathSync(lokinet_nodedb)
  }
  var upstreamDNS_servers = []
  var params = {
    upstreamDNS_servers: upstreamDNS_servers,
    lokinet_free53Ip: lokinet_free53Ip,
    lokinet_nodedb: lokinet_nodedb,
    lokinet_bootstrap_path: lokinet_bootstrap_path,
    lokinet_nic: lokinet_nic,
    use_lokinet_rpc_port: use_lokinet_rpc_port,
  }
  if (config.bootstrap_url) {
    httpGet(config.bootstrap_url, function(bootstrapData) {
      if (bootstrapData) {
        cleanUpBootstrap = true
        const tmpRcPath = os.tmpdir() + '/' + randomString(8) + '.lokinet_signed'
        fs.writeFileSync(tmpRcPath, bootstrapData, 'binary')
        log('boostrap wrote', bootstrapData.length, 'bytes to', tmpRcPath)
        //lokinet_bootstrap_path = tmpRcPath
        params.lokinet_bootstrap_path = tmpRcPath
        config.bootstrap_path = tmpRcPath
      }
      markDone('bootstrap', params)
    })
  } else {
    // seed version
    //params.lokinet_bootstrap_path = ''
    markDone('bootstrap', params)
  }
  readResolv(function(servers) {
    upstreamDNS_servers = servers
    params.upstreamDNS_servers = servers
    upstreams = 'upstream='+servers.join('\nupstream=')
    markDone('upstream', params)
  })
  log('trying', 'http://'+config.rpc_ip+':'+config.rpc_port)
  httpGet('http://'+config.rpc_ip+':'+config.rpc_port, function(testData) {
    //console.log('rpc has', testData)
    if (testData !== undefined) {
      log('Bumping RPC port', testData)
      use_lokinet_rpc_port = use_lokinet_rpc_port + 1
      params.use_lokinet_rpc_port = use_lokinet_rpc_port
    }
    markDone('rpcCheck', params)
  })
  var skipDNS = false
  if (config.dns_ip || config.dns_port) {
    skipDNS = true
    markDone('dnsBind', params)
  }
  getNetworkIP(function(e, ip) {
    log('detected outgoing interface ip', ip)
    lokinet_nic = getIfNameFromIP(ip)
    params.lokinet_nic = lokinet_nic
    log('detected outgoing interface', lokinet_nic)
    markDone('netIf', params)
    if (skipDNS) return
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
      params.lokinet_free53Ip = free53Ip
      log('binding DNS port 53 to', free53Ip)
      markDone('dnsBind', params)
    })
  })
}

// unified post auto-config adjustments
function applyConfig(file_config, config_obj) {
  // bootstrap section
  // router mode: bootstrap is optional (might be a seed if not)
  // client mode: bootstrap is required, can't have a seed client
  if (file_config.bootstrap_path) {
    config_obj.bootstrap = {
      'add-node': config.bootstrap_path
    }
  }
  // router section
  if (file_config.nickname) {
    config_obj.router.nickname = file_config.nickname
  }
  // set default netid based on testnet
  if (file_config.lokid.network.toLowerCase() == "test" || file_config.lokid.network.toLowerCase() == "testnet" || config.lokid.network.toLowerCase() == "test-net") {
    config_obj.router.netid = 'service'
    //runningConfig.network['ifaddr'] = '10.254.0.1/24' // hack for Ryan's box
  }
  if (file_config.netid) {
    config_obj.router.netid = file_config.netid
  }
  // network section
  if (file_config.ifname) {
    config_obj.network.ifname = file_config.ifname
  }
  if (file_config.ifaddr) {
    config_obj.network.ifaddr = file_config.ifaddr
  }
  // dns section
  if (file_config.dns_ip || file_config.dns_port) {
    var ip = file_config.dns_ip
    // FIXME: dynamic dns ip
    if (!ip) ip = '127.0.0.1'
    config_obj.dns.bind = ip + ':' + file_config.dns_port
  }
}

var runningConfig = {}
function generateSerivceNodeINI(config, cb) {
  const homeDir = os.homedir()
  var done = {
    bootstrap: false,
    upstream : false,
    rpcCheck : false,
    dnsBind  : false,
    netIf    : false,
  }
  function markDone(completeProcess, params) {
    if (shuttingDown) {
      //if (cb) cb()
      log('not going to start lokinet, shutting down')
      return
    }
    done[completeProcess] = true
    let ready = true
    for(var i in done) {
      if (!done[i]) {
        ready = false
        log(i, 'is not ready')
        break
      }
    }
    if (!ready) return
    var keyPath = homeDir + '/.loki/'
    if (config.lokid.data_dir) {
      keyPath = config.lokid.data_dir
      // make sure it has a trailing slash
      if (keyPath[keyPath.length - 1]!='/') {
        keyPath += '/'
      }
    }
    if (config.lokid.network.toLowerCase() == "test" || config.lokid.network.toLowerCase() == "testnet" || config.lokid.network.toLowerCase() == "test-net") {
      keyPath += 'testnet/'
    }
    keyPath += 'key'
    log('markDone params', JSON.stringify(params))
    log('Drafting lokinet service node config')
    // FIXME: lock down identity.private for storage server
    runningConfig = {
      router: {
        nickname: 'ldl',
      },
      dns: {
        upstream: params.upstreamDNS_servers,
        bind: params.lokinet_free53Ip + ':53',
      },
      netdb: {
        dir: params.lokinet_nodedb,
      },
      bind: {
        // will be set after
      },
      network: {
      },
      api: {
        enabled: true,
        bind: config.rpc_ip + ':' + params.use_lokinet_rpc_port
      },
      lokid: {
        enabled: true,
        jsonrpc: config.lokid.rpc_ip + ':' + config.lokid.rpc_port,
        username: config.lokid.rpc_user,
        password: config.lokid.rpc_pass,
        'service-node-seed': keyPath
      }
    }
    runningConfig.bind[params.lokinet_nic] = config.public_port
    applyConfig(config, runningConfig)
    // optional bootstrap (might be a seed if not)
    // doesn't work
    //runningConfig.network['type'] = 'null' // disable exit
    //runningConfig.network['enabled'] = true;
    cb(ini.jsonToINI(runningConfig))
  }
  generateINI(config, markDone, cb)
}

function generateClientINI(config, cb) {
  var done = {
    bootstrap: false,
    upstream : false,
    rpcCheck : false,
    dnsBind  : false,
  }
  function markDone(completeProcess, params) {
    done[completeProcess] = true
    let ready = true
    for(var i in done) {
      if (!done[i]) {
        ready = false
        log(i, 'is not ready')
        break
      }
    }
    if (!ready) return
    log('Drafting lokinet client config')
    runningConfig = {
      router: {
        nickname: 'ldl',
      },
      dns: {
        upstream: params.upstreamDNS_servers,
        bind: params.lokinet_free53Ip + ':53',
      },
      netdb: {
        dir: params.lokinet_nodedb,
      },
      network: {
      },
      api: {
        enabled: true,
        bind: config.rpc_ip + ':' + params.use_lokinet_rpc_port
      },
    }
    applyConfig(config, runningConfig)
    // a bootstrap is required, can't have a seed client
    if (!runningConfig.bootstrap) {
      console.error('no bootstrap for client')
      process.exit()
    }
    cb(ini.jsonToINI(runningConfig))
  }
  generateINI(config, markDone, cb)
}

var shuttingDown
var lokinet
var lokinetLogging = true
function preLaunchLokinet(config, cb) {
  //console.log('userInfo', os.userInfo('utf8'))
  //console.log('started as', process.getuid(), process.geteuid())

  // check user permissions
  if (os.platform() == 'darwin') {
    if (process.getuid() != 0) {
      console.error('MacOS requires you start this with sudo')
      process.exit()
    }
  // leave the linux commentary for later
  /*
  } else {
    if (process.getuid() == 0) {
      console.error('Its not recommended you run this as root')
    } */
  }

  if (os.platform() == 'linux') {
    // not root-like
    exec('getcap ' + config.binary_path, function (error, stdout, stderr) {
      //console.log('stdout', stdout)
      // src/loki-network/lokinet = cap_net_bind_service,cap_net_admin+eip
      if (!(stdout.match(/cap_net_bind_service/) && stdout.match(/cap_net_admin/))) {
        if (process.getgid() != 0) {
          conole.log(config.binary_path, 'does not have setcap. Please setcap the binary (make install usually does this) or run launcher root one time, so we can')
          process.exit()
        } else {
          // are root
          log('going to try to setcap your binary, so you dont need root')
          exec('setcap cap_net_admin,cap_net_bind_service=+eip ' + config.binary_path, function (error, stdout, stderr) {
            log('binary permissions upgraded')
          })
        }
      }
    })
  }

  // lokinet will crash if this file is zero bytes
  if (fs.existsSync('profiles.dat')) {
    var stats = fs.statSync('profiles.dat')
    if (!stats.size) {
      log('cleaning router profiles')
      fs.unlinkSync('profiles.dat')
    }
  }

  const tmpDir = os.tmpdir()
  const tmpPath = tmpDir + '/' + randomString(8) + '.lokinet_ini'
  cleanUpIni = true
  config.ini_writer(config, function (iniData) {
    if (shuttingDown) {
      //if (cb) cb()
      log('not going to write lokinet config, shutting down')
      return
    }
    log(iniData, 'as', tmpPath)
    fs.writeFileSync(tmpPath, iniData)
    config.ini_file = tmpPath
    cb()
  })
}

function launchLokinet(config, cb) {
  if (shuttingDown) {
    //if (cb) cb()
    log('not going to start lokinet, shutting down')
    return
  }
  if (!fs.existsSync(config.ini_file)) {
    log('lokinet config file', config.ini_file, 'does not exist')
    process.exit()
  }
  // command line options
  var cli_options = [config.ini_file]
  if (config.verbose) {
    cli_options.push('-v')
  }
  lokinet = spawn(config.binary_path, cli_options)

  if (!lokinet) {
    console.error('failed to start lokinet, exiting...')
    process.exit()
  }
  lokinet.stdout.on('data', (data) => {
    if (lokinetLogging) {
      var parts = data.toString().split(/\n/)
      parts.pop()
      data = parts.join('\n')
      console.log(`lokinet: ${data}`)
    }
  })

  lokinet.stderr.on('data', (data) => {
    console.log(`lokineterr: ${data}`)
  })

  lokinet.on('close', (code) => {
    log(`lokinet process exited with code ${code}`)
    // code 0 means clean shutdown
    // clean up
    // if we have a temp bootstrap, clean it
    if (cleanUpBootstrap && runningConfig.bootstrap['add-node']) {
      fs.unlinkSync(runningConfig.bootstrap['add-node'])
    }
    if (cleanUpIni) {
      fs.unlinkSync(config.ini_file)
    }
    if (!shuttingDown) {
      if (config.restart) {
        log('loki_daemon is still running, restarting lokinet')
        launchLokinet(config)
      } else {
        // don't restart...
      }
    }
    // else we're shutting down
  })
  if (cb) cb()
}

function checkConfig(config) {
  if (config === undefined) config = {}
  if (config.auto_config_test_host === undefined ) config.auto_config_test_host='www.imdb.com'
  if (config.auto_config_test_port === undefined ) config.auto_config_test_port=80
  auto_config_test_port = config.auto_config_test_port
  auto_config_test_host = config.auto_config_test_host

  if (config.binary_path === undefined ) config.binary_path='/usr/local/bin/lokinet'
  // we don't always want a bootstrap_url

  // maybe if no port we shouldn't configure it
  if (config.rpc_ip === undefined ) config.rpc_ip='127.0.0.1'
  if (config.rpc_port === undefined ) config.rpc_port=0
}

function waitForUrl(url, cb) {
  httpGet(url, function(data) {
    //console.log('rpc data', data)
    // will be undefined if down (ECONNREFUSED)
    // if success
    // <html><head><title>Unauthorized Access</title></head><body><h1>401 Unauthorized</h1></body></html>
    if (data) {
      cb()
    } else {
      // no data could me 404
      if (shuttingDown) {
        //if (cb) cb()
        log('not going to start lokinet, shutting down')
        return
      }
      setTimeout(function() {
        waitForUrl(url, cb)
      }, 1000)
    }
  })
}

function startServiceNode(config, cb) {
  checkConfig(config)
  config.ini_writer = generateSerivceNodeINI
  config.restart = true
  preLaunchLokinet(config, function() {
    // test lokid rpc port first
    // also this makes sure the service key file exists
    var url = 'http://'+config.lokid.rpc_user+':'+config.lokid.rpc_pass+'@'+config.lokid.rpc_ip+':'+config.lokid.rpc_port
    log('lokinet waiting for lokid RPC server')
    waitForUrl(url, function() {
      launchLokinet(config, cb)
    })
  })
}

function startClient(config, cb) {
  checkConfig(config)
  if (config.bootstrap_url === undefined ) config.bootstrap_url='https://i2p.rocks/self.signed'
  config.ini_writer = generateClientINI
  preLaunchLokinet(config, function() {
    launchLokinet(config, cb)
  })
}

// return a truish value if so
function isRunning() {
  // should we block until port is responding?
  return lokinet
}

function stop() {
  shuttingDown = true
  if (!lokinet) {
    console.warn('lokinet already stopped')
    return
  }
  log('requesting lokinet be shutdown')
  if (!lokinet.killed) {
    process.kill(lokinet.pid, 'SIGINT')
  }
  lokinet = null
}

function enableLogging() {
  lokinetLogging = true
}

function disableLogging() {
  lokinetLogging = false
}

function getLokiNetIP(cb) {
  log('wait for lokinet startup')
  var url = 'http://'+runningConfig.api.bind+'/'
  waitForUrl(url, function() {
    log('lokinet seems to be running')
    // where's our DNS server?
    log('RunningConfig says our lokinet\'s DNS is on', runningConfig.dns.bind)
    testDNSForLokinet(runningConfig.dns.bind, function(ips) {
      log('lokinet test', ips)
      if (ips && ips.length) {
        cb(ips[0])
      } else {
        console.error('cant communicate with lokinet DNS, retrying')
        //process.exit()
        setTimeout(function() {
          getLokiNetIP(cb)
        }, 1000)
      }
    })
  })
}

module.exports = {
  startServiceNode : startServiceNode,
  startClient      : startClient,
  checkConfig      : checkConfig,
  findLokiNetDNS   : findLokiNetDNS,
  isRunning        : isRunning,
  stop             : stop,
  getLokiNetIP     : getLokiNetIP,
  enableLogging    : enableLogging,
  disableLogging   : disableLogging,
}
