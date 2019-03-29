mkdir loki$1
cd loki$1
ln -s ../bin/lokid lokid$1
ln -s ../bin/lokinet lokinet$1
ln -s ../bin/httpserver httpserver$1
cp ../lokiX/launcher.ini .
nano launcher.ini
echo "kill -15 `cat loki$1/launcher.pid`" >> stop.sh
