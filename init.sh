#!/bin/sh
git submodule init
git submodule update
cd src/loki
git submodule init
git submodule update
# attempt a build to set up some basics
make
cd ../..
