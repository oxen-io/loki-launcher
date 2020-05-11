```
        .o0l.
       ;kNMNo.
     ;kNMMXd'
   ;kNMMXd'                 .ld:             ,ldxkkkdl,.     'dd;     ,odl.  ;dd
 ;kNMMXo.  'ol.             ,KMx.          :ONXkollokXN0c.   cNMo   .dNNx'   dMW
dNMMM0,   ;KMMXo.           ,KMx.        .oNNx'      .dNWx.  :NMo .cKWk;     dMW
'dXMMNk;  .;ONMMXo'         ,KMx.        :NMx.         oWWl  cNWd;ON0:.      oMW
  'dXMMNk;.  ;kNMMXd'       ,KMx.        lWWl          :NMd  cNMNNMWd.       dMW
    'dXMMNk;.  ;kNMMXd'     ,KMx.        :NMx.         oWWl  cNMKolKWO,      dMW
      .oXMMK;   ,0MMMNd.    ,KMx.        .dNNx'      .dNWx.  cNMo  .dNNd.    dMW
        .lo'  'dXMMNk;.     ,KMXxdddddl.   :ONNkollokXN0c.   cNMo    ;OWKl.  dMW
            'dXMMNk;        .lddddddddo.     ,ldxkkkdl,.     'od,     .cdo;  ;dd
          'dXMMNk;
         .oNMNk;             L A U N C H E R
          .l0l.
```

# Requirements

- [nodejs](https://nodejs.org/en/) versions 8.x to 12.x are supported
- [npm](https://www.npmjs.com/get-npm) usually installed with nodejs (only for distribution and easy install of this software, we do not use ANY external NPMs for security reasons)
- Linux (though macos does works and Windows kind of works)
- xz (xz-utils apt package) to be able to download and extract updated Linux binaries
- setcap (apt: libcap2-bin, rpm: libcap) to be enable lokinet to not need to run as root on Linux

# Why use the launcher over DEBs
The goal of the launcher is to make it easier to run a service node, however the DEBs installation and upgrade process can be much easier if you're running a debian-based OS. However we do have some additional advantages:
- Safer, we have additional checks in configuration, like to make sure you don't create port conflicts. We also have other checks that can detect unwanted patterns of behavior between apps and be able to take action
- Easier config management, one config file to manage all 3 binaries, also reduces the chance of you having to resolve config conflicts during upgrades
- Firewall Notification, lets you know if you're blocking any required ports. DEBs will open them in ufw but this won't help if you're using an different or external firewall. 
- NAT support, Launcher automatically configures your outgoing interface and public IP. DEBs you have to manually set up your network interface and public ip. Neither will help you set up port forwarding though.
- Prequal tool, know for sure your situation meets our minimum requirements
- Easy to downgrade path: if an upgrade is causing you problems, you can manually pull older releases off github and replace the binaries in /opt/loki-launcher/bin and simply restart the launcher with the older binary until your node is stable.
- Diveristy of the network, in the highly unlikely event that Debian ever gets a serious bug, we want the service node network to be diverse enough to not be largely effective. Being able to support multiple operating systems is good for the Loki ecosystem.
- Robust distribution system: Launcher relies on Microsoft/GitHub infrastructure, the DEBs are ran by our developer on his server. You could argue Microsoft/GitHub has more people keeping an eye on security and availability of their system. (And while we use NPM to distribute loki-launcher we do not use any NPM modules in this project)
- Interactive client sessions, so you don't have lokid start up delays for each command you want to run
- Unified subsystem reporting, get the status or versions of all 3 subsystems (blockchain, storage, network) from one command

Launcher is maintained at cost of the Loki Foundation and if it's not found to be of use, maybe unfunded. Please consider supporting this great tool by using it.

# How to do a fresh service node install

This will use npm to install the launcher

`sudo npm install -g loki-launcher`

This will create any needed directories and make sure everything has the proper permissions to run as a specified user such as `snode` in this example

`sudo loki-launcher set-perms snode`

Now make sure sure you running the following commands as the user specified or you may run into permission problems (EPERM).

After it's installed, you can ask to prequalify your server to be a service node

`loki-launcher prequal`

you can also ask it to download the Loki binaries if you don't already have them

`loki-launcher download-binaries`

# How to use without systemd

`loki-launcher start`

Running it once should start the suite of services into the background or give you a message why it can't. This isn't recommended for long term uses as there is nothing to restart launcher if it dies/exits.

Running `loki-launcher client`, will give you an interactive terminal to lokid (the copy running from the current directory if you have multiple).
`exit` will stop your service node. If you just want to exit the interactive terminal, please use `ctrl-c`.

You can pass most [command line parameters](https://lokidocs.com/Advanced/lokid/) that you would give to lokid to `loki-launcher start`

You can make a launcher config file in /etc/loki-launcher/launcher.ini and change various settings, [Check our wiki](https://github.com/loki-project/loki-launcher/wiki/Launcher.ini-configuration-documentation) for details on options.

# How to keep the launcher up to date

## Update your launcher without systemd

Stop your service node if it's running (you can use `loki-launcher status` to check)

`loki-launcher stop`

Update the launcher

`sudo npm install -g loki-launcher`

And be sure to make sure you restart your service node (if it's staked) by

`loki-launcher start`

## Get the latest Loki software versions

`loki-launcher download-binaries`

And be sure to make sure you restart your service node (if it's staked) by

`loki-launcher start`

## Other

[upgrading from lokid 3.0.6 with systemd to use the launcher](upgrading.md)

# Popular linux distribution instructions to install NodeJS

### CentOS NodeJS installation:

`curl -sL https://rpm.nodesource.com/setup_12.x | sudo bash -`

### Ubuntu/Debian NodeJS installation:

`curl -sL https://deb.nodesource.com/setup_12.x | sudo bash -`

then

`sudo apt-get install -y nodejs`



# Software the launcher manages

- [lokid](https://github.com/loki-project/loki)
- [lokinet](https://github.com/loki-project/loki-network)
- [loki-storage](https://github.com/loki-project/loki-storage-server)

To get the required software you can run `loki-launcher download-binaries` and they will be placed in `/opt/loki-launcher/bin`

or

You can download the loki binaries (faster) from each above page's release section

or

You can build from source. Make sure you select the correct repos/branches/versions as not all versions will work with each other.

And if you don't have the dependencies to build from source check out [contrib/dependency_helper/](contrib/dependency_helper/getDepsUnix.sh)

# Changelog

For more indepth details, be sure to check out our weekly [dev reports](https://loki.network/blog/)
Changelog:
- 1.0.17
  - introduce `install USER`
  - introduce `upgrade USER`
  - fix lokinet pid sync issue
  - tune loki-storage's lokid watchdog to be more aggressive
  - fix prequal port-in-use handling
  - fix systemctl message to include sudo
  - move more_info out of `status blockchain`'s table output
- 1.0.16
  - make /tmp/storage.logs directory unique per storage port
  - add additional permissions check and clean up on /tmp/X/storage.logs
- 1.0.15
  - introduce web api (tries to bind to 22000 on localhost by default)
  - introduce `show-quorum`
  - introduce `import`
  - introduce `keys`
  - introduce `download-blockchain`
  - centos8 fixes
  - turn off always showing the logo
  - fix qun_ip (it's tied to the p2p_ip)
  - trim new lines from `stop` blockchain output
  - `download-binaries` now just runs `check-system` if systemd is enabled
  - `download-binaries` fall back to last release if the current one doesn't have a binary for your platform
  - improve `status blockchain` error handling
- 1.0.14
  - introduce `status blockchain` for quick read of important status
  - introduce `systemd log` for dumping launcher logs
  - introduce `export` for migrating snodes
  - download-binaries doesn't redownload binaries versions we already (unless 'download-binaries force' is used)
  - added prerel & force-prerel
  - integrate system enable/active detection
  - work around loki-storage 2.x permissions crash
  - parse INI section name case insensitively
  - limit lokid max threads to 16
  - catch getPidLimit exceptions
  - refactor storage server logging processing
  - hide CONNRESET socket server from logs
- 1.0.13
  - lower storage file descriptor requirement to just a warning instead of exiting
- 1.0.12
  - NEW storage lmq_port port (22020) must be open to the public
  - storage NOW required 16384 available file descriptors, check-systemd should upgrade this for you
  - download-binaries now requires root, so it can always fix the capabilities on lokinet
  - you will be suggested to install libcap2-bin if you don't have getcap in your path
  - remove immediate storage watchdog check on start up
  - write exception logs to /tmp instead of / so it's always writable
  - check-systemd now runs daemon-reload for you and detect and warn about a conflicting DEBs install
  - refactor all the testing calling to remove callback hell
  - added all binaries versions to "version" mode
- 1.0.11
  - fix storage server watchdog
  - make storage server watchdog run every 10mins instead of 60mins
  - handle storage server exit code 1 exits better (restart instead of exit) as crash can also cause code 1
  - now attempts lokid restart if storage server fails to communicate with it for 2-3 mins
  - handle storage server not being set better
  - always chomp pid file to make testing easier
  - status: if launcher isnn't running, always check to see if lokid's rpc port is in use or not
  - interactive-debug mode: SIGUSR1 hides, SIGUSR2 shows peridotic status reports
  - logging messages adjustments and fixes
- 1.0.10
  - loki repo rename to loki-core support
- 1.0.9
  - fix bug in port validation when upgrading from 5.x
- 1.0.8*
  - include storage/network last failure in status
  - check for port conflicts
  - connect to client when stopping the launcher, so you can see what the blockchain is taking so long
  - fix-perms fix network data_dir permissions fix
  - fix network status
  - add ifname validation
  - add p2p/zmq bind-ip processing
  - change definition of start up success (require storage_rpc, storageServer, network)
  - fix ECONNREFUSED exception in client mode
  - fix setcap exceptions in checkConfig
  - prequal can't bind fix
  - set network.public_port even in pre 6.x
  - if cimode exit
  - fix git rev output parsing
  - various pre 6.x support fixes (only passing quorumnet-port in 6.x)
- 1.0.7*
  - fix bug with qun_port not getting passed to lokid
  - Fix trying to load port numbers from loki.conf
- 1.0.6*
  - Don't commit to saying started unless lokinet can be started
  - made sure network binary is set for fix-perms
  - prequal: inform that quorumnet is not a suggestion but required / grammar fixes
  - only show full status if launcher is running
  - adjust start up process for loki-storage DH and create warning accordingly
  - fix stop race condition message
  - turn off debugging in interactive mode
  - move lokiKey from storage to blockchain
  - decrease port test failure timeout to 10s instead of 60s
  - fix VERSION detection race
  - fix duplicate socket server error logging
  - handle lokinet EPERM condition better
  - various logging clean up
- 1.0.5*
  - enable lokinet
  - changed default storage server port from 23023 to 22021 (SO UPDATE YOUR FIREWALLS)
  - remove service-node-seed / keyPath from lokinet
  - add seedMode to lokinet
  - remove lokinet solo-mode (without blockchain/storage)
  - bind storage server to 0.0.0.0
  - improve prequal
  - interactive mode improvements
  - require new port checks on startup
  - adjust lokinet snode config to be more inline with debs
  - don't use github pre-releases at all
  - add lokinet files to fix-perms
  - set data_dir for lokinet
  - fix-perms handle no user passed and can't lookup user better
  - include (re)start time in status
  - download-binaries make architecture aware
  - make status check storage rpc port
  - check on storage server every hour and restart if rpc does not respond
  - timer adjustments/better cancelations for speed improvements
- 1.0.4*
  - Add lokid 6.x prequal tests
- 1.0.3
  - disable 1.0.2 workaround
- 1.0.2
  - add xenial workaround
- 1.0.0
  - fix storage server pipe that would lock up storage server
  - make sure storage server is running before starting startup is successful
  - fix storage server stderr handler typo
  - SIGHUP guard fix
  - double check running pid
  - use SIGTERM instead of SIGINT to stop processes
  - handle socket write errors better
  - test socket for connectivity in status
  - clear stale pid and socket files
  - move uncaught exception log into var_path
- 0.0.13
  - change storage server default port from 8080 to 23023
  - storage server/lokinet start up now waits for blockchain rpc port to be open
  - fix linux pipe race condition (would say started but then launcher would die)
  - unhandle exception logger
  - add more retries on failure
  - don't check open storage server port twice
- 0.0.12 
  - 4.0 release changes
    - storage server open port check enforced on start
    - and actually updating the prequal to be 4.0 ready
  - 3.x detection for backwards compatibility
  - start now waits for rpc port to be open before saying it's a success
  - pass info if lokid/storage server exit before it's declared started
  - stop launchers before certain modes
  - exited with warning if not root instead of throwing EPERMs
  - fixes loki.conf file parsing
  - interactive mode bug
  - update ifconfig.me's URL
- 0.0.11 - removes lokid key search requirement for non-testnet
- 0.0.10* - fixes 3.0.7 release breaking testnet
- 0.0.9* - fixes missing INI library (issue #34)
- 0.0.8* - upgrade testnet to support 4.x binaries and enables storage server in testnet
- 0.0.7 - initial public release (compatible with 3.0.x lokid versions)

[1] deprecated and not longer available because they were not found to be functioning as expected
