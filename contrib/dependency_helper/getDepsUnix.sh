#!/bin/bash

# this tries to download all project requirements and builds/installs them for you

# get to the root directory of the launcher
cd ../..

if [ ! -d "depbuild" ]; then
  echo "Creating depbuild dir"
  mkdir depbuild
fi
echo "Changing pwd to ./depbuild"
cd depbuild

echo "Checking for needed downloads"
# even if we have the binary, doesn't mean we have the header
#if ! type "openssl" > /dev/null; then
  # if we don't have the file get it
  if [ ! -f "openssl-1.1.1.tar.gz" ]; then
    curl -L https://www.openssl.org/source/openssl-1.1.1.tar.gz > openssl-1.1.1.tar.gz
  fi
#fi

  # if we don't have boost tarball get it
  if [ ! -f "boost_1_69_0.tar.bz2" ]; then
    curl -L https://sourceforge.net/projects/boost/files/boost/1.69.0/boost_1_69_0.tar.bz2 > boost_1_69_0.tar.bz2
  fi

  # may not need this one
  # if we don't have zeromq tarball get it
  if [ ! -f "zeromq-4.2.5.tar.gz" ]; then
    curl -L https://github.com/zeromq/libzmq/releases/download/v4.2.5/zeromq-4.2.5.tar.gz > zeromq-4.2.5.tar.gz
  fi

  # if we don't have zmqc++ tarball get it
  if [ ! -f "v4.3.0.tar.gz" ]; then
    curl -L https://github.com/zeromq/cppzmq/archive/v4.3.0.tar.gz > v4.3.0.tar.gz
  fi

  # if we don't have openpgm tarball get it
  if [ ! -f "libpgm-5.2.122.tar.bz2" ]; then
    curl -L https://storage.googleapis.com/google-code-archive-downloads/v2/code.google.com/openpgm/libpgm-5.2.122.tar.bz2 > libpgm-5.2.122.tar.bz2
  fi

  # if we don't have libexpat tarball get it
  if [ ! -f "expat-2.2.6.tar.bz2" ]; then
    curl -L https://github.com/libexpat/libexpat/releases/download/R_2_2_6/expat-2.2.6.tar.bz2 > expat-2.2.6.tar.bz2
  fi

  # if we don't have unbound tarball get it
  if [ ! -f "unbound-1.8.1.tar.gz" ]; then
    curl -L https://nlnetlabs.nl/downloads/unbound/unbound-1.8.1.tar.gz > unbound-1.8.1.tar.gz
  fi

  # if we don't have libsoidum tarball get it
  if [ ! -f "libsodium-1.0.16.tar.gz" ]; then
    curl -L https://github.com/jedisct1/libsodium/releases/download/1.0.16/libsodium-1.0.16.tar.gz > libsodium-1.0.16.tar.gz
  fi



echo "Extracing needed files"
#isGnuTar=$(tar --version | grep -q 'gnu')
#if [ $? -eq 0 ]
#then
#    echo "Detected GNU tar"
#else
#    echo "Detected BSD tar"
#fi

#if ! type "openssl" > /dev/null; then
# if we have openssl tarball
if [ -f "openssl-1.1.1.tar.gz" ]; then
  # if we haven't extracted it yet
  if [ ! -d "openssl-1.1.1" ]; then
    echo "Extracing OpenSSL"
    tar zxf openssl-1.1.1.tar.gz
  fi
fi
#fi

# if we have boost tarball
if [ -f "boost_1_69_0.tar.bz2" ]; then
  # if we haven't extracted it yet
  if [ ! -d "boost_1_69_0" ]; then
    echo "Extracing Boost"
    tar jxf boost_1_69_0.tar.bz2
  fi
fi

# if we have zeromq tarball
if [ -f "zeromq-4.2.5.tar.gz" ]; then
  # if we haven't extracted it yet
  if [ ! -d "zeromq-4.2.5" ]; then
    echo "Extracing ZeroMQ"
    tar zxf zeromq-4.2.5.tar.gz
  fi
fi

if [ -f "v4.3.0.tar.gz" ]; then
  # if we haven't extracted it yet
  if [ ! -d "cppzmq-4.3.0" ]; then
    echo "Extracing ZMQ C++"
    tar zxf v4.3.0.tar.gz
  fi
fi

# if we have openpgm tarball
if [ -f "libpgm-5.2.122.tar.bz2" ]; then
  # if we haven't extracted it yet
  if [ ! -d "libpgm-5.2.122" ]; then
    echo "Extracing LibPGM"
    tar jxf libpgm-5.2.122.tar.bz2
  fi
fi

# if we have libexpat tarball
if [ -f "expat-2.2.6.tar.bz2" ]; then
  # if we haven't extracted it yet
  if [ ! -d "expat-2.2.6" ]; then
    echo "Extracing LibExpat"
    tar jxf expat-2.2.6.tar.bz2
  fi
fi

# if we have unbound tarball
if [ -f "unbound-1.8.1.tar.gz" ]; then
  # if we haven't extracted it yet
  if [ ! -d "unbound-1.8.1" ]; then
    echo "Extracing Unbound"
    tar zxf unbound-1.8.1.tar.gz
  fi
fi

# if we have libsoidum tarball
if [ -f "libsodium-1.0.16.tar.gz" ]; then
  # if we haven't extracted it yet
  if [ ! -d "libsodium-1.0.16" ]; then
    echo "Extracing LibSodium"
    tar zxf libsodium-1.0.16.tar.gz
  fi
fi


physicalCpuCount=$([[ $(uname) = 'Darwin' ]] &&
                       sysctl -n hw.physicalcpu_max ||
                       lscpu -p | egrep -v '^#' | sort -u -t, -k 2,4 | wc -l)
echo "Detected for $physicalCpuCount physical CPU cores"
echo "Configuring, Building and Installing packages"
if [ -d "openssl-1.1.1" ]; then
  cd openssl-1.1.1
    if [ ! -f "Makefile" ]; then
      echo "Configuring OpenSSL"
      ./config
    fi
    if [ ! -f "apps/openssl" ]; then
      echo "Building OpenSSL"
      make -j$physicalCpuCount
    fi
    if [ ! -f "/usr/local/bin/openssl" ]; then
      echo "Installing OpenSSL"
      sudo make install
    fi
  cd ..
fi
if [ -d "boost_1_69_0" ]; then
  cd boost_1_69_0
    if [ ! -f "b2" ]; then
      echo "Configuring Boost"
      ./bootstrap.sh
    fi
    if [ ! -d "bin.v2" ]; then
      echo "Building and installing Boost"
      sudo ./b2
    fi
  cd ..
fi
if [ -d "zeromq-4.2.5" ]; then
  cd zeromq-4.2.5
    if [ ! -f "Makefile" ]; then
      echo "Configuring ZeroMQ"
      ./configure
    fi
    if [ ! -f "tools/curve_keygen" ]; then
      echo "Building ZeroMQ"
      make -j$physicalCpuCount
    fi
    if [ ! -f "/usr/local/bin/curve_keygen" ]; then
      echo "Installing ZeroMQ"
      sudo make install
    fi
  cd ..
fi
if [ -d "cppzmq-4.3.0" ]; then
  cd cppzmq-4.3.0
    if [ ! -f "Makefile" ]; then
      echo "Configuring ZMQ C++"
      cmake .
    fi
    if [ ! -f "bin/unit_tests" ]; then
      echo "Building ZMQ C++"
      make -j$physicalCpuCount
    fi
    if [ ! -f "/usr/local/include/zmq.hpp" ]; then
      echo "Installing ZMQ C++"
      sudo make install
    fi
  cd ..
fi
if [ -d "libpgm-5.2.122" ]; then
  cd libpgm-5.2.122/openpgm/pgm
    if [ ! -f "Makefile" ]; then
      echo "Configuring OpenPGM"
      ./configure
    fi
    if [ ! -f "libpgm.la" ]; then
      echo "Building OpenPGM"
      make -j$physicalCpuCount
    fi
    if [ ! -f "/usr/local/lib/libpgm.la" ]; then
      echo "Installing OpenPGM"
      sudo make install
    fi
  cd ../../..
fi
if [ -d "expat-2.2.6" ]; then
  cd expat-2.2.6
    if [ ! -f "Makefile" ]; then
      echo "Configuring LibExpat"
      ./configure
    fi
    if [ ! -f "lib/.libs/libexpat.a" ]; then
      echo "Building LibExpat"
      make -j$physicalCpuCount
    fi
    if [ ! -f "/usr/local/lib/libexpat.a" ]; then
      echo "Installing LibExpat"
      sudo make install
    fi
  cd ..
fi
# needs libexpat
if [ -d "unbound-1.8.1" ]; then
  cd unbound-1.8.1
    if [ ! -f "Makefile" ]; then
      echo "Configuring Unbound"
      ./configure
    fi
    if [ ! -f ".libs/libunbound.a" ]; then
      echo "Building Unbound"
      make -j$physicalCpuCount
    fi
    if [ ! -f "/usr/local/lib/libunbound.a" ]; then
      echo "Installing Unbound"
      sudo make install
    fi
  cd ..
fi
if [ -d "libsodium-1.0.16" ]; then
  cd libsodium-1.0.16
    if [ ! -f "Makefile" ]; then
      echo "Configuring LibSodium"
      ./configure
    fi
    if [ ! -f "src/libsodium/libsodium.la" ]; then
      echo "Building LibSodium"
      make -j$physicalCpuCount
    fi
    if [ ! -f "/usr/local/lib/libsodium.a" ]; then
      echo "Installing LibSodium"
      sudo make install
    fi
  cd ..
fi

echo "Done, restoring pwd"
cd ..
