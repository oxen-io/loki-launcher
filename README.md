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

- [nodejs](https://nodejs.org/en/) 8.x or later
- [npm](https://www.npmjs.com/get-npm) usually installed with nodejs
- Linux (though macos does works and Windows kind of works)

# How to upgrade to the launcher from running a lokid 3.0.6 service node (set up with systemd)

1. Install nodejs (and npm) and then install the launcher as root:

`sudo npm install -g loki-launcher`

2. Stop your existing service node:

`sudo systemctl stop lokid.service`

3. Run the check-systemd to make systemd now launch the launcher instead of lokid:

`sudo loki-launcher check-systemd`

4. Make sure the service is up to date:

`sudo systemctl daemon-reload`

5. Start lokid.service:

`sudo systemctl start lokid.service`

# How to do a fresh service node install

This will use npm to install the launcher

`sudo npm install -g loki-launcher`

After it's installed, you can ask to prequalify your server to be a service node

`loki-launcher prequal`

you can also ask it to download the Loki binaries if you don't already have them

`loki-launcher download-binaries`

# How to use

`loki-launcher start`

Running it once should start the suite of services into the background or give you a message why it can't

Running `loki-launcher client`, will give you an interactive terminal to lokid (the copy running from the current directory if you have multiple).
`exit` will stop your service node. If you just want to exit the interactive terminal, please use `ctrl-c`.

You can pass most [command line parameters](https://lokidocs.com/Advanced/lokid/) that you would give to lokid to `loki-launcher start`

You can make a launcher config file in /etc/loki-launcher/launcher.ini and change various settings, [Check our wiki](https://github.com/loki-project/loki-launcher/wiki/Launcher.ini-configuration-documentation) for details on options.

# How to keep the launcher up to date

## Update your launcher

Stop your service node if it's running (you can use `loki-launcher status` to check)

`loki-launcher stop`

Update the launcher

`npm update loki-launcher`

And be sure to make sure you restart your service node (if it's staked) by

`loki-launcher start`

## Get the latest Loki software versions

`loki-launcher download-binaries`

And be sure to make sure you restart your service node (if it's staked) by

`loki-launcher start`

# Popular linux distribution instructions to install NodeJS

Ubuntu NodeJS installation:

`curl -sL https://deb.nodesource.com/setup_10.x | sudo bash -`

then

`sudo apt-get install -y nodejs`

# Software the launcher manages

- [lokid](https://github.com/loki-project/loki)
- [lokinet](https://github.com/loki-project/loki-network)
- [httpserver (storage server)](https://github.com/loki-project/loki-storage-server)

To get the required software you can run `loki-launcher download-binaries` and they will be placed in `/opt/loki-launcher/bin`

or

You can download the loki binaries (faster) from each above page's release section

or

You can build from source, you can use the [init.sh](init.sh) script to pull the latest source.

And if you don't have the dependencies to build from source check out [contrib/dependency_helper/](contrib/dependency_helper/getDepsUnix.sh)
