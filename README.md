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
- [npm](https://www.npmjs.com/get-npm) usually installed with nodejs
- Linux (though macos does works and Windows kind of works)
- xz (xz-utils apt package) to be able to download and extract updated Linux binaries

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

Running it once should start the suite of services into the background or give you a message why it can't

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

Ubuntu NodeJS installation:

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

- 0.0.12 - (work in progress) fixes loki.conf file parsing
- 0.0.11 - removes lokid key search requirement for non-testnet
- 0.0.10* - fixes 3.0.7 release breaking testnet
- 0.0.9* - fixes missing INI library (issue #34)
- 0.0.8* - upgrade testnet to support 4.x binaries and enables storage server in testnet
- 0.0.7 - initial public release (compatible with 3.0.x lokid versions)

[1] deprecated and not longer available because they were not found to be functioning as expected
