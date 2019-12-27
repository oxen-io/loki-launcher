/**
 * @file tcp client and server encapsulation tools
 * @author Ryan Tharp
 * @module lets_tcp
 */
const net = require('net');
const dgram = require('dgram');
const VERSION = 0.2

// works for client/server
// you'd never want the client and server to be the same
// we can at least separate them
// but having cb handles would be better I think
// also no duplicate code
// we have clients w/o server but servers w/clients

var clients=[];
var servers=[];
var serverClientCounter=0;
module.exports={
  /**
   * debug flag to detect problems with the stack
   */
  debug: false,
  /**
   * receive data handler
   *
   * @function
   * @param {string} pkt - data we received
   * @param {object} socket - socket we received it on
   */
  recv: function(pkt, socket) {
    console.log('dummy receive function');
  },
  /**
   * send data handler
   * works for client/server
   *
   * @function
   * @param {object} client - client to send the data to
   * @param {string} str - string to send
   * @returns boolean whether or not it was sent
   */
  send: function(client, str) {
    if (!client || !client.socket) {
      if (client) {
        console.log('invalid handle - no socket');
      } else {
        console.log('invalid handle - no client');
      }
      return;
    }
    /*
    if (!client.connected) {
      console.log('not connected, so cant write');
      //console.log('invalid handle', client);
      return false;
    }
    */
    if (str.length===undefined) {
      console.log('No str passed in', str, 'for', client);
      return 0;
    }
    if (str.length>65535) {
      console.log('time to write chunking');
    }
    //console.log('strlength', str.length);
    var buffer=Buffer.alloc(2+str.length);
    buffer.fill(0);
    buffer.writeUInt16LE(str.length, 0);
    buffer.write(str, 2, 'binary');
    if (buffer.length!=str.length+2) {
      console.log('lets_tcp buf', buffer.length, '!=', str.length+2);
    }
    if (client.socket) {
      //console.log('sending', str, str.length);
      client.readyToSend = client.socket.write(buffer);
    } else {
      console.log('client socket isnt set', client);
      return false;
    }
    return true;
  },
  /**
   * request disconnect from client
   *
   * for server or client?
   * deprecated for client
   * @function
   * @param {object} client - client to disconnect
   */
  disconnect: function(socket, type) {
    console.log('disconnect stub');
  },
  /**
   * request reconnect for client
   *
   * for server or client?
   * almost deprecated
   * skyNet_client uses this
   * @function
   * @param {object} client - client to reconnect
   */
  reconnect: function(client) {
    console.log('reconnect stub');
  },
  /**
   * establish a TCP connection to a host
   *
   * connected callback
   * recieved callback
   * and a hook to callback
   * pass them all to the object that's calledback
   * @function
   * @param {string} host - hostname to connect to
   * @param {number} port - port to connect to
   * @param {connecTCPCallback} calback
   * @return socket - socket that's trying to connect
   */
  connectTCP: function(host, port, callback) {
    // connect to SkyNet
    var tcpClient = new net.Socket();
    tcpClient.setNoDelay(true); // disable nagle since most packets are over 40 bytes
    var handle=clients.length;
    clients.push({
      socket: tcpClient,
      name: host+':'+port,
      reconnect: true,
      retry: 1000,
      buf: Buffer.alloc(0),
      haveEnough: 0,
      type: 'text', // text, json or binary
      connected: true,
      handle: handle,
      send: function(str) {
        //console.log('internal handle', handle, 'count', clients.length);
        module.exports.send(clients[handle], str);
      },
      recv: function(pkt) {
        module.exports.recv(pkt, client);
      },
      // TODO: and if I want to close this client connection??
      /*
      reconn: function() {
        module.exports.reconnect(clients[handle]);
      },
      */
      disconnect: function() {
        module.exports.disconnect(clients[handle], true);
        if (client.reconnect) {
          console.log('sending reconnect');
          // good for partial disconnects
          client.socket.emit('reconnect');
        }
      },
      destroy: function() {
        //client.socket.end();
        //client.connected=false;
        client.socket.destroy();
      }
    });
    var client=clients[handle];
    tcpClient.on('error', function(err) {
      //console.error('err', err)
      if (module.exports.errorHandler) {
        module.exports.errorHandler(err)
      }
    })
    tcpClient.connect(port, host, function() {
      client.connected=true;
      // handle reconnects
      tcpClient.on('connect', function() {
        console.log('reconnected');
        // ok how do you define this??
        // well we callback with the client object
        // but this will likely be connected by then
        // you'd almost have to have a separate variable to tell
        // unless we did the callback here...
        // but then we'd call the cb each time we connect/reconnect
        // so we either need
        // - delay connect
        // - pass in conn/reconn
        // - rename the module.exports function to include client in it
        // so the question becomes is anything using this?
        if (client.reconn) {
          client.reconn();
        }
        // since you can't define client.reconn
        // we'll need this for skyNet_client
        //console.log('clients', clients.length, 'handle', handle);
        //console.log('test', clients[handle]);
        // reconnect the socket
        //client.socket=tcpClient;
        client.connected=true;
        // let others know we're reconnected
        module.exports.reconnect(clients[handle]);
        //console.log('reconnect socket', tcpClient);
      });
      if (module.exports.debug) console.log('(re)connected to tcpClient', client.name);

      function checkForData() {
        if (client.haveEnough===0 && client.buf.length>=2) {
          client.haveEnough=client.buf.readUInt16LE(0);
          client.buf=client.buf.slice(2); // remove
        }
        if (client.haveEnough && client.buf.length>=client.haveEnough) {
          var pkt=client.buf.slice(0, client.haveEnough);
          client.buf=client.buf.slice(client.haveEnough); // remove
          client.haveEnough=0;
          if (client.type==='json') {
            // starts and ends on {}, must be a valid json
            if (pkt[0]===123 && pkt[pkt.length-1]===125) {
              //module.exports.recv(JSON.parse(pkt), client);
              client.recv(JSON.parse(pkt));
            } else {
              console.log(client.name, 'not json? first', pkt[0], 'last', pkt[pkt.length-1]);
            }
          } else if (client.type==='binary') {
            client.recv(pkt);
          } else {
            //module.exports.recv(pkt, client);
            client.recv(pkt.toString('binary'));
          }
          checkForData();
          //parsePkt(pkt, tcpClient);
        }
      }

      tcpClient.on('data', function(data) {
        if (module.exports.debug) console.log('recieved from', client.name, data.toString());
        client.buf=Buffer.concat([client.buf, data]);
        checkForData();
      });
      tcpClient.on('error', function(err) {
        console.log('tcpClient error event', err);
        if (module.exports.debug) console.log(client.name, 'error', err);
        if (client.connected) {
          client.destroy();
        }
        // tcpClient error event [Error: write after end]
        // tcpClient error event { [Error: This socket has been ended by the other party] code: 'EPIPE'
      });
      // what listener is added here over and over?
      /*
      tcpClient.on('end', function() {
        console.log('tcpClient end event')
      })
      tcpClient.on('timeout', function() {
        console.log('tcpClient timeout event')
      })
      */
      tcpClient.on('close', function() {
        //console.log('tcpClient close event')
        // only notify on first disconnect, not retries
        if (client.connected) {
          //console.log('reconnect failed');
          //return;
          if (module.exports.debug) console.log(client.name, 'connection closed');
          if (client.disconnect) {
            client.disconnect();
          }
        }
        client.connected=false;
        function tryAgain() {
          //tcpClient = new net.Socket(); // wipes all hooks
          console.log('reconnecting');
          if (module.exports.debug) console.log('reconnect try');
          //client.socket.emit('reconnect');
          //tcpClient.connect(port, host);
          try {
            module.exports.connectTCP(host, port, callback);
          } catch(e) {
            console.log('failed, trying again', e);
            setTimeout(tryAgain, client.retry);
          }
        }
        if (client.reconnect) {
          setTimeout(tryAgain, client.retry);
        }
      });
      if (callback) {
        callback(client);
      }
    });
    return tcpClient;
  },
  /**
   * create a TCP server
   *
   * @param {string} port - port to listen on
   * @param {callback} callback - connect handler function
   * @returns object - server socket
   */
  serveTCP: function(port, callback) {
    var server_clients={};
    var server=net.createServer(function (socket) {
      serverClientCounter++;
      // Put this new client in the list
      // can't use the server_clients as an array if we want a handle
      var handle=serverClientCounter;
      var client={
        socket: socket,
        name: port+'<'+socket.remoteAddress+':'+socket.remotePort,
        buf: Buffer.alloc(0),
        haveEnough: 0,
        type: 'text', // json, binary
        handle: handle,
        send: function(str) {
          if (!client) {
            console.error('server connection', handle, 'is already closed, cant send', str);
            return 1;
          }
          if (!client.socket) {
            console.error('server connection', handle, 'socket is already closed, cant send', str);
            return 1;
          }
          // this is sliding, handle slides to the new idx and doesn't perserve the old
          //, 'handle', handle
          if (client.socket.serverClientCounter!=handle) {
            console.warn('lets_tcp::serverTCP - socket.serverClientCounter is ', client.socket.serverClientCounter, 'but is handle', handle, 'for', str);
          }
          module.exports.send(client, str);
          return 0;
        },
        recv: function(pkt) {
          module.exports.recv(pkt, client);
        },
        // disconnect has happened
        disconnect: function() {
          module.exports.disconnect(client, false);
        },
      }
      if (module.exports.debug) console.debug('lets_tcp::serveTCP - serverClientCounter', serverClientCounter);
      socket.serverClientCounter=serverClientCounter;
      // we can't use an array if we want a handle
      server_clients[handle]=client;
      // when server_clients, does the handle stay fixed at the new index
      // or keep the old index?
      // callback on connection to change settings?
      // nothing to change atm
      if (callback) {
        // for sending to this
        callback(server_clients[handle]);
      }

      // Send a nice welcome message and announce
      //socket.write("Welcome " + socket.name + "\n");
      //broadcast(socket.name + " joined the chat\n", socket);

      function checkForData() {
        if (client.haveEnough===0 && client.buf.length>=2) {
          client.haveEnough=client.buf.readUInt16LE(0);
          client.buf=client.buf.slice(2); // remove
        }
        if (client.haveEnough && client.buf.length>=client.haveEnough) {
          var pkt=client.buf.slice(0, client.haveEnough);
          client.buf=client.buf.slice(client.haveEnough); // remove
          client.haveEnough=0;
          if (client.type==='json') {
            // starts and ends on {}, must be a valid json
            if (pkt[0]===123 && pkt[pkt.length-1]===125) {
              //module.exports.recv(JSON.parse(pkt), client);
              client.recv(JSON.parse(pkt));
            } else {
              console.warn(client.name, 'not json? first', pkt[0], 'last', pkt[pkt.length-1]);
            }
          } else if (client.type==='binary') {
            client.recv(pkt);
          } else {
            //module.exports.recv(pkt, client);
            client.recv(pkt.toString('binary'));
          }
          checkForData();
          //parsePkt(pkt, tcpClient);
        }
      }

      // Handle incoming messages from clients.
      socket.on('data', function (data) {
        //broadcast(socket.name + "> " + data, socket);
        //console.log('recieved from cli', data);
        if (module.exports.debug) console.log('recieved from', client.name, data.toString());
        client.buf=Buffer.concat([client.buf, data]);

        /*
        if (client.haveEnough===0 && client.buf.length>=2) {
          client.haveEnough=client.buf.readUInt16LE(0);
          client.buf=client.buf.slice(2); // remove
        }
        if (client.buf.length>=client.haveEnough) {
          var pkt=client.buf.slice(0, client.haveEnough);
          client.buf=client.buf.slice(client.haveEnough); // remove
          client.haveEnough=0;
          //console.log(client.name, 'pkt', pkt.toString());
          //parsePkt(pkt, skyNetClient);
          //module.exports.recv(pkt, client);
          if (client.type==='json') {
            if (pkt[0]===123 && pkt[pkt.length-1]===125) {
              //module.exports.recv(JSON.parse(pkt), client);
              client.recv(JSON.parse(pkt));
            } else {
              console.log(client.name, 'not json? first', pkt[0], 'last', pkt[pkt.length-1]);
            }
          } else if (client.type==='binary') {
            client.recv(pkt);
          } else {
            client.recv(pkt.toString());
          }
        }
        */
        checkForData();
      });

      socket.on('error', function(err) {
        console.error(client.name, 'socket err', err);
      });

      // Remove the client from the list when it leaves
      socket.on('end', function () {
        if (module.exports.debug) console.debug(client.name, 'socket end');
        //broadcast(socket.name + " left the chat.\n");
      });
      socket.on('close', function() {
        if (module.exports.debug) console.debug(client.name, 'socket close');
        //console.log('socket end', clients.length);
        // we changed server_clients from an array to an object
        /*
        var search=server_clients.indexOf(socket);
        if (search!==-1) {
          server_clients.splice(search, 1);
          client.disconnect();
        } else {
          console.log('lets_tcp::server.on.close - already disconnect, cant find socket in server_clients');
        }
        */
        // should we destroy the socket too?
        socket.emit('forceDisconnect');
        socket.destroy();
        delete server_clients[client.handle];
        // let callbacks know
        client.disconnect();
        //console.log('now only', clients.length);
      });
    });
    server.on('error', (err) => {
      if (server.errorHandler) {
        server.errorHandler(err)
      } else {
        console.error('SOCKET ERROR:', err)
      }
    })
    server.letsClose=function(cb) {
      if (module.exports.debug) console.debug('closing server', port, 'connections', clients.length);
      for(var i in server_clients) {
        //console.debug('destroying server', port, 'client', i);
        // http://stackoverflow.com/questions/5048231/force-client-disconnect-from-server-with-socket-io-and-nodejs
        server_clients[i].socket.emit('forceDisconnect');
        //clients[i].disconnect(true);
        //clients[i]._onDisconnect();
        server_clients[i].socket.destroy();
        //server_clients.splice(i, 1);
      }
      server_clients={};
      //console.debug('server', port, 'clients destroyed');
      server.close(function() {
        //console.debug('server port', port, 'closed');
        if (cb) cb();
      });
    }
    servers.push(server);
    server.listen(port);
    return server;
  },
  /**
   * create a UDP server
   *
   * @param {string} port - port to listen on
   * @param {callback} callback - connect handler function
   * @returns object - server socket
   */
  serveUDP: function(port, callback) {
    const server = dgram.createSocket('udp4');
    const safePort = parseInt(port);
    if (!safePort) {
      return false;
    }
    server.on('error', (err) => {
      if (server.errorHandler) {
        server.errorHandler(err)
      } else {
        console.error('SOCKET ERROR:', err)
        if (module.exports.debug) console.log(`server error:\n${err.stack}`);
        //server.close();
      }
    });

    server.on('message', (msg, rinfo) => {
      if (module.exports.debug) console.log(`UDPserver got: ${msg} from ${rinfo.address}:${rinfo.port}`);
      callback(msg, rinfo);
    });

    server.on('listening', () => {
      const address = server.address();
      if (module.exports.debug) console.log(`server listening ${address.address}:${address.port}`);
    });
    let open = true
    server.on('close', () => {
      open = false
    });

    server.letsClose=function(cb) {
      if (module.exports.debug) console.debug('closing server UDP', port, 'connections', clients.length);
      //console.debug('server', port, 'clients destroyed');
      if (open) {
        server.close(function() {
          //console.debug('server port', port, 'closed');
          if (cb) cb();
        });
      } else {
        if (cb) cb();
      }
    }

    server.bind(safePort);
    return server;
  }
}

