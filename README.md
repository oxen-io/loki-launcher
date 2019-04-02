
# how to run

We're assuming you already have the lokid, lokinet and httpserver (storage server) binaries somewhere...

edit the config [launcher.ini](launcher.ini) and check over the settings, [Check our wiki](https://github.com/loki-project/loki-launcher/wiki/Launcher.ini-configuration-documentation) for options.

`node index.js`

If interactive is true, then this will provide an interactive console with lokid with lokinet running in the background
`exit` will quit both.
If interactive is fale, then it will validate the environment, let you know of any problems and potentially start the servers into the background (it will be safe to disconnect from the terminal and they should continue running).

# install nodejs 8.x or later

Ubuntu node installation:

`curl -sL https://deb.nodesource.com/setup_10.x | sudo bash -`

then

`sudo apt-get install -y nodejs`
