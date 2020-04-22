const http = require('http')
const lib = require(__dirname + '/lib')
const statusSystem = require(__dirname + '/modes/status')
const lokinet = require(__dirname + '/lokinet')

// if we keep this read-only, we can't go too wrong

// FIXME: caching layer...

// return server handle
function start(config) {
  webApiServer = http.createServer(async function(request, response) {
    //console.log('method', request.method)
    switch(request.method) {
      case 'GET':
        //console.log('path', request.url)
        switch(request.url) {
          case '/v1/pids.json':
            //
            lib.getLauncherStatus(config, lokinet, 'waiting...', function(running, checklist) {
              response.writeHead(200, {"Content-Type" : "application/json"})
              // const combined = {...running, ...checklist}
              response.end(JSON.stringify(running))
            })
          break;
          case '/v1/health.json':
            // , statusSystem.checkNetwork()
            const statuses = await Promise.all([statusSystem.checkBlockchain(),
              statusSystem.checkStorage()])

            const status = statuses.reduce((result, current) => {
              return Object.assign(result, current)
            })
            response.writeHead(200, {"Content-Type" : "application/json"})
            response.end(JSON.stringify(status))
          break;
          case '/':
            //response.writeHead(200, {"Content-Type" : "text/html"})
            response.end(`
            <a href="/v1/pids.json">pids.json</a>
            <a href="/v1/health.json">health.json</a>
            `)
          break;
          default:
            response.writeHead(200, {"Content-Type" : "text/plain"});
            response.end(`Unknown Path ${request.url}`);
          break;
        }
      break;
      default:
        response.writeHead(200, {"Content-Type" : "text/plain"});
        response.end(`Unknown Method ${request.method}`);
      break;
    }
  });
  webApiServer.listen(config.web_api.port, config.web_api.ip).on('error', function(e) {
    if (e.code === 'EADDRINUSE') {
      console.log('WEB_API: disabling because port', config.web_api.port, 'is inuse on', config.web_api.ip)
    } else {
      console.log('WEB_API:', e)
    }
  })
  return webApiServer
}

module.exports = {
  start: start,
}
