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

