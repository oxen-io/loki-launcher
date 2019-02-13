REPO := $(shell dirname $(realpath $(lastword $(MAKEFILE_LIST))))
BUILD_ROOT = $(REPO)/build
physicalCpuCount=$([[ $(uname) = 'Darwin' ]] && sysctl -n hw.physicalcpu_max || lscpu -p | egrep -v '^#' | sort -u -t, -k 2,4 | wc -l)

macos:
	mkdir -p '$(BUILD_ROOT)'
	cd '$(BUILD_ROOT)' && cmake -DBOOST_ROOT=../depbuild/boost_1_64_0 ../src && make -j$(physicalCpuCount)

launcher:
	mkdir -p '$(BUILD_ROOT)'
	cd '$(BUILD_ROOT)' && cmake ../src/launcher/cmake/ && make -j$(physicalCpuCount)
