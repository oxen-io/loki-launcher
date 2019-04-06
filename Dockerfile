FROM debian:stable


WORKDIR /usr/src/app
RUN apt update && \
apt install -y build-essential cmake git libcap-dev curl ninja-build libssl-dev libboost-dev expat unbound libsodium-dev  libpgm-dev libzmq3-dev
RUN apt install -y  pkg-config
RUN apt install -y libboost-all-dev
RUN curl -sL https://deb.nodesource.com/setup_10.x | bash -
RUN apt-get install -y nodejs
RUN  curl -L https://github.com/zeromq/cppzmq/archive/v4.3.0.tar.gz > v4.3.0.tar.gz
RUN  tar zxf v4.3.0.tar.gz
RUN  cd cppzmq-4.3.0 &&  cmake . &&  make -j$physicalCpuCount &&  make install


# Bundle app source
COPY . .  
RUN sh init.sh 
RUN ls -la /usr/src/app/src/loki-storage-server
RUN ls -la /usr/src/app/src/loki-network/
RUN groupadd -g 999 appuser && \
    useradd -r -u 999 -g appuser appuser
RUN chown -R appuser:appuser /usr/src/app
USER appuser



CMD ["node", "index.js"]
EXPOSE 38157 28083 1090

