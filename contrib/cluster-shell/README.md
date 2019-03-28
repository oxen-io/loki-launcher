put all binaries (lokid, lokinet, httpserver) into the bin/

copy as many lokiX to loki2, loki3, etc as you need (lokinet network needs a seed and 4 nodes a minimum)
Then for each lokiX edit the last digit following parameters to make the number of X in launcher.ini
- blockchain.rpc_port
- network.rpc_port
- network.public_port
- network.dns_port
- nickname
also change network.ifaddr changed the 10.142.0.1/24 to 10.14X.0.1/24
