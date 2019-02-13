cmake_minimum_required (VERSION 2.6)
project (snode_launcher)
# The version number.
set (Launcher_VERSION_MAJOR 0)
set (Launcher_VERSION_MINOR 1)

#
# stolen from lokid cmake
#

# ARCH defines the target architecture, either by an explicit identifier or
# one of the following two keywords. By default, ARCH a value of 'native':
# target arch = host arch, binary is not portable. When ARCH is set to the
# string 'default', no -march arg is passed, which creates a binary that is
# portable across processors in the same family as host processor.  In cases
# when ARCH is not set to an explicit identifier, cmake's builtin is used
# to identify the target architecture, to direct logic in this cmake script.
# Since ARCH is a cached variable, it will not be set on first cmake invocation.
if (NOT ARCH OR ARCH STREQUAL "" OR ARCH STREQUAL "native" OR ARCH STREQUAL "default")
  set(ARCH_ID "${CMAKE_SYSTEM_PROCESSOR}")
else()
  set(ARCH_ID "${ARCH}")
endif()
string(TOLOWER "${ARCH_ID}" ARM_ID)
string(SUBSTRING "${ARM_ID}" 0 3 ARM_TEST)
if (ARM_TEST STREQUAL "arm")
  set(ARM 1)
  string(SUBSTRING "${ARM_ID}" 0 5 ARM_TEST)
  if (ARM_TEST STREQUAL "armv6")
    set(ARM6 1)
  endif()
  if (ARM_TEST STREQUAL "armv7")
    set(ARM7 1)
  endif()
endif()

if (ARM_ID STREQUAL "aarch64" OR ARM_ID STREQUAL "arm64" OR ARM_ID STREQUAL "armv8-a")
  set(ARM 1)
  set(ARM8 1)
  set(ARCH "armv8-a")
endif()

if(ARCH_ID STREQUAL "ppc64le")
  set(PPC64LE 1)
  set(PPC64   0)
  set(PPC     0)
endif()

if(ARCH_ID STREQUAL "powerpc64" OR ARCH_ID STREQUAL "ppc64")
  set(PPC64LE 0)
  set(PPC64   1)
  set(PPC     0)
endif()

if(ARCH_ID STREQUAL "powerpc" OR ARCH_ID STREQUAL "ppc")
  set(PPC64LE 0)
  set(PPC64   0)
  set(PPC     1)
endif()

if(ARCH_ID STREQUAL "s390x")
  set(S390X 1)
endif()

if(WIN32 OR ARM OR PPC64LE OR PPC64 OR PPC)
  set(OPT_FLAGS_RELEASE "-O2")
else()
  set(OPT_FLAGS_RELEASE "-Ofast")
endif()

option(NO_AES "Explicitly disable AES support" ${NO_AES})

  if(NO_AES)
    message(STATUS "AES support explicitly disabled")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -DNO_AES")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -DNO_AES")
  elseif(NOT ARM AND NOT PPC64LE AND NOT PPC64 AND NOT PPC AND NOT S390X)
    message(STATUS "AES support enabled")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -maes")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -maes")
  elseif(PPC64LE OR PPC64 OR PPC)
    message(STATUS "AES support not available on POWER")
  elseif(S390X)
    message(STATUS "AES support not available on s390x")
  elseif(ARM6)
    message(STATUS "AES support not available on ARMv6")
  elseif(ARM7)
    message(STATUS "AES support not available on ARMv7")
  elseif(ARM8)
    CHECK_CXX_ACCEPTS_FLAG("-march=${ARCH}+crypto" ARCH_PLUS_CRYPTO)
    if(ARCH_PLUS_CRYPTO)
      message(STATUS "Crypto extensions enabled for ARMv8")
      set(ARCH_FLAG "-march=${ARCH}+crypto")
    else()
      message(STATUS "Crypto extensions unavailable on your ARMv8 device")
    endif()
  else()
    message(STATUS "AES support disabled")
  endif()

#
# end stolen from lokid cmake
#

set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -DPOSIX")

set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -std=c++14 -fPIC -fpermissive")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -DDEFAULT_DB_TYPE=\\\"lmdb\\\"")
#set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -DLOKI_VERSION_MAJOR=2 -DLOKI_VERSION_MINOR=0 -DLOKI_VERSION_PATCH=3")
#set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -DLOKI_VERSION=\\\"2.0.3-rc\\\" -DLOKI_RELEASE_NAME=\\\"putnamehere\\\" -DLOKI_VERSION_FULL=\\\"Wouldntyouliketoknow\\\"")

message(STATUS "CXX FLAGS => ${CMAKE_CXX_FLAGS}")

# We start in src/launcher/cmake
include_directories ("..")

include_directories ("../../loki/src")
include_directories ("../../loki/contrib/epee/include")
include_directories ("../../loki/external")
include_directories ("../../loki/external/easylogging++")
include_directories ("../../loki/external/unbound/libunbound")
include_directories ("../../loki/external/rapidjson/include")
include_directories ("../../loki/external/db_drivers/liblmdb")
# FIXME: requires loki to be attempted to be built
find_path(
    TRANSLATION_FILES_INCLUDE_DIR
    NAMES "translation_files.h"
    PATHS "../../loki/build/release/translations" "../../loki/build/Linux/dev/release/translations" "../../loki/build/Darwin/dev/release/translations" "../../loki/build/release/translations"
)
message(STATUS "loki translation files => ${TRANSLATION_FILES_INCLUDE_DIR}")
include_directories(${TRANSLATION_FILES_INCLUDE_DIR})
if(NOT TRANSLATION_FILES_INCLUDE_DIR)
  message(FATAL_ERROR "loki configure stage not ran, run make in src/loki or set TRANSLATION_FILES_INCLUDE_DIR")
endif()

include_directories ("../../loki/build/release/translations")
include_directories ("../../loki/build/release/external/miniupnp/miniupnpc")
# dev version
include_directories ("../../loki/build/Linux/dev/release/translations")
include_directories ("../../loki/build/Linux/dev/release/external/miniupnp/miniupnpc")
include_directories ("../../loki/build/Darwin/dev/release/translations")
include_directories ("../../loki/build/Darwin/dev/release/external/miniupnp/miniupnpc")

FIND_PACKAGE( Boost 1.58
  COMPONENTS
    chrono
    filesystem
    program_options
    regex
    serialization
    system
    thread
  REQUIRED
)

message(STATUS "Boost include => ${Boost_INCLUDE_DIR}")
#message(STATUS "Boost library => ${Boost_LIBRARY_DIR}") # empty on mac/linux
message(STATUS "Boost libraries => ${Boost_LIBRARIES}")
include_directories(${Boost_INCLUDE_DIR})

#find_path(
#    BOOST_INCLUDE_DIR
#    NAMES "boost/program_options/parsers.hpp"
#    PATHS "../../../depbuild/boost_1_64_0" /usr/local /usr
#)
#include_directories(${BOOST_INCLUDE_DIR})
#message(STATUS "boost include => ${BOOST_INCLUDE_DIR}")

#find_path(
#    BOOST_LIB_DIR
#    NAMES "libboost_chrono.a"
#    PATHS "../../../depbuild/boost_1_64_0/stage/lib" /usr/lib/x86_64-linux-gnu /usr/local /usr
#)
#link_directories(${BOOST_LIB_DIR})
#message(STATUS "boost lib => ${BOOST_LIB_DIR}")

# boost 1.61 (and higher) needs -D_GLIBCXX_USE_CXX11_ABI=1
#set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -D_GLIBCXX_USE_CXX11_ABI=1")

find_path(
    UNBOUND_LIB_DIR
    NAMES "libunbound.a"
    PATHS "../../../depbuild/unbound-1.8.1/.libs" /usr/local /usr
)
message(STATUS "unbound => ${UNBOUND_LIB_DIR}")
link_directories(${UNBOUND_LIB_DIR})

find_path(
    OPENSSL_LIB_DIR
    NAMES "libssl.a"
    PATHS "../../../depbuild/openssl-1.1.1" /usr/local /usr
)
link_directories(${OPENSSL_LIB_DIR})
message(STATUS "libssl.a => ${OPENSSL_LIB_DIR}")

find_path(
    ZMQ_LIB_DIR
    NAMES "libzmq.a"
    PATHS /usr/local/lib /usr/lib
)
link_directories(${ZMQ_LIB_DIR})
message(STATUS "libzmq.a => ${ZMQ_LIB_DIR}")


find_path(
    OPENSSL_DIR
    NAMES "include/openssl/conf.h"
    PATHS "../../../depbuild/openssl-1.1.1" /usr/local /usr
)
include_directories("${OPENSSL_DIR}/include")
message(STATUS "openssl => ${OPENSSL_DIR}")

#
# Loki
#

set(MINI_LOKI_COMMON_SRC
  ../../loki/src/common/aligned.c
  ../../loki/src/common/base58.cpp
  ../../loki/src/common/command_line.cpp
  ../../loki/src/common/download.cpp
  ../../loki/src/common/dns_utils.cpp
#  ../../loki/src/common/exp2.cpp
  ../../loki/src/common/i18n.cpp
  ../../loki/src/common/loki.cpp
  ../../loki/src/common/notify.cpp
  ../../loki/src/common/password.cpp
  ../../loki/src/common/pruning.cpp
  ../../loki/src/common/perf_timer.cpp
  ../../loki/src/common/util.cpp
  ../../loki/src/common/round.cpp
  ../../loki/src/common/rules.cpp
  ../../loki/src/common/spawn.cpp
  ../../loki/src/common/updates.cpp
  ../../loki/src/common/threadpool.cpp
)
add_library(mini_loki_common ${MINI_LOKI_COMMON_SRC})
target_link_libraries(mini_loki_common unbound)

set(MINI_LOKI_CRYPTO_SRC
  ../../loki/src/crypto/chacha.c
  ../../loki/src/crypto/crypto.cpp
  ../../loki/src/crypto/crypto-ops.c
  ../../loki/src/crypto/keccak.c
  ../../loki/src/crypto/tree-hash.c
  ../../loki/src/crypto/skein.c
  ../../loki/src/crypto/jh.c
  ../../loki/src/crypto/groestl.c
  ../../loki/src/crypto/random.c
  ../../loki/src/crypto/crypto-ops-data.c
  ../../loki/src/crypto/hash.c
  ../../loki/src/crypto/blake256.c
  # FIXME: intel vs arm
  ../../loki/src/crypto/cn_slow_hash_hard_intel.cpp
  # FIXME: software only support
  ../../loki/src/crypto/cn_slow_hash_soft.cpp
  # linux needed
  ../../loki/src/crypto/crypto_ops_builder/verify.c
)
add_library(mini_loki_crypto ${MINI_LOKI_CRYPTO_SRC})

set(MINI_LOKI_DAEMON_SRC
  ../../loki/src/daemon/daemon.cpp
  ../../loki/src/daemon/command_server.cpp
  ../../loki/src/daemon/command_parser_executor.cpp
  ../../loki/src/daemon/rpc_command_executor.cpp
  ../../loki/src/daemon/executor.cpp
)
add_library(mini_loki_daemon ${MINI_LOKI_DAEMON_SRC})

set(MINI_LOKI_SERIALIZATION_SRC
  ../../loki/src/serialization/json_object.cpp
)
add_library(mini_loki_serialization ${MINI_LOKI_SERIALIZATION_SRC})
target_link_libraries(mini_loki_daemon
  ssl crypto
  ${Boost_LIBRARIES}
  mini_loki_common
)

set(MINI_LOKI_CN_CORE_SRC
  ../../loki/src/cryptonote_core/blockchain.cpp
  ../../loki/src/cryptonote_core/cryptonote_core.cpp
  ../../loki/src/cryptonote_core/cryptonote_tx_utils.cpp
  ../../loki/src/cryptonote_core/service_node_quorum_cop.cpp
  ../../loki/src/cryptonote_core/service_node_list.cpp
  ../../loki/src/cryptonote_core/service_node_rules.cpp
  ../../loki/src/cryptonote_core/service_node_deregister.cpp
  ../../loki/src/cryptonote_core/tx_pool.cpp
)
add_library(mini_loki_cn_core ${MINI_LOKI_CN_CORE_SRC})
target_link_libraries(mini_loki_cn_core
  mini_loki_ringct
)

set(MINI_LOKI_CN_BASIC_SRC
  ../../loki/src/cryptonote_basic/account.cpp
  ../../loki/src/cryptonote_basic/cryptonote_basic_impl.cpp
  ../../loki/src/cryptonote_basic/cryptonote_format_utils.cpp
  ../../loki/src/cryptonote_basic/difficulty.cpp
  ../../loki/src/cryptonote_basic/hardfork.cpp
  ../../loki/src/cryptonote_basic/miner.cpp
#  ../../loki/src/cryptonote_basic/service_node_deregister.cpp
)
add_library(mini_loki_cn_basic ${MINI_LOKI_CN_BASIC_SRC})
target_link_libraries(mini_loki_cn_core mini_loki_common)

set(MINI_LOKI_CN_PROTO_SRC
  ../../loki/src/cryptonote_protocol/cryptonote_protocol_handler-base.cpp
  ../../loki/src/cryptonote_protocol/block_queue.cpp
  ../../loki/src/cryptonote_protocol/cryptonote_protocol_handler.inl
)
target_link_libraries(mini_loki_cn_basic
  mini_loki_crypto
  mini_loki_common
)
add_library(mini_loki_cn_proto ${MINI_LOKI_CN_PROTO_SRC})

set(MINI_LOKI_EPEE_SRC
  ../../loki/contrib/epee/src/buffer.cpp
  ../../loki/contrib/epee/src/connection_basic.cpp
  ../../loki/contrib/epee/src/network_throttle-detail.cpp
  ../../loki/contrib/epee/src/http_auth.cpp
  ../../loki/contrib/epee/src/hex.cpp
  ../../loki/contrib/epee/src/memwipe.c
  ../../loki/contrib/epee/src/mlog.cpp
  ../../loki/contrib/epee/src/mlocker.cpp
  ../../loki/contrib/epee/src/network_throttle.cpp
  ../../loki/contrib/epee/src/net_utils_base.cpp
  ../../loki/contrib/epee/src/string_tools.cpp
  ../../loki/contrib/epee/src/wipeable_string.cpp
)
add_library(mini_loki_epee ${MINI_LOKI_EPEE_SRC})

# can't call this mini...
set(MINI_LOKI_UPNP_SRC
  ../../loki/external/miniupnp/miniupnpc/connecthostport.c
  ../../loki/external/miniupnp/miniupnpc/igd_desc_parse.c
  ../../loki/external/miniupnp/miniupnpc/miniupnpc.c
  ../../loki/external/miniupnp/miniupnpc/minissdpc.c
  ../../loki/external/miniupnp/miniupnpc/minisoap.c
  ../../loki/external/miniupnp/miniupnpc/minixml.c
  ../../loki/external/miniupnp/miniupnpc/miniwget.c
  ../../loki/external/miniupnp/miniupnpc/portlistingparse.c
  ../../loki/external/miniupnp/miniupnpc/receivedata.c
  ../../loki/external/miniupnp/miniupnpc/upnpc.c
  ../../loki/external/miniupnp/miniupnpc/upnpcommands.c
  ../../loki/external/miniupnp/miniupnpc/upnpdev.c
  ../../loki/external/miniupnp/miniupnpc/upnperrors.c
  ../../loki/external/miniupnp/miniupnpc/upnpreplyparse.c
)
add_library(mini_loki_upnp ${MINI_LOKI_UPNP_SRC})

set(MINI_LOKI_P2P_SRC
  ../../loki/src/p2p/net_node.inl
  ../../loki/src/p2p/net_node.cpp
)
add_library(mini_loki_p2p ${MINI_LOKI_P2P_SRC})

set(MINI_LOKI_RINGCT_SRC
  ../../loki/src/checkpoints/checkpoints.cpp
  ../../loki/src/device/device.cpp
  ../../loki/src/device/device_default.cpp
  ../../loki/src/ringct/bulletproofs.cc
  ../../loki/src/ringct/rctCryptoOps.c
  ../../loki/src/ringct/rctSigs.cpp
  ../../loki/src/ringct/rctOps.cpp
  ../../loki/src/ringct/rctTypes.cpp
  ../../loki/src/ringct/multiexp.cc
)
add_library(mini_loki_ringct ${MINI_LOKI_RINGCT_SRC})

set(MINI_LOKI_RPC_SRC
  ../../loki/src/rpc/core_rpc_server.cpp
  ../../loki/src/rpc/rpc_args.cpp
  ../../loki/src/rpc/rpc_handler.cpp
  ../../loki/src/rpc/daemon_handler.cpp
  ../../loki/src/rpc/daemon_messages.cpp
  ../../loki/src/rpc/message.cpp
  ../../loki/src/rpc/zmq_server.cpp
  ../../loki/src/rpc/instanciations.cpp
)
add_library(mini_loki_rpc ${MINI_LOKI_RPC_SRC})
target_link_libraries(mini_loki_rpc
  zmq
  ${Boost_LIBRARIES}
  mini_loki_epee
  mini_loki_cn_proto
  mini_loki_upnp
  mini_loki_p2p
)

set(MINI_LOKI_SRC
  ../../loki/src/checkpoints/checkpoints.cpp
#  ../../loki/src/crypto/slow-hash.c
  ../../loki/src/blockchain_db/blockchain_db.cpp
  ../../loki/src/blockchain_db/lmdb/db_lmdb.cpp
  ../../loki/external/db_drivers/liblmdb/mdb.c
  ../../loki/external/db_drivers/liblmdb/midl.c
  ../../loki/external/easylogging++/easylogging++.cc
  ../../loki/build/release/version.cpp
)
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -DAUTO_INITIALIZE_EASYLOGGINGPP")


add_library(mini_loki ${MINI_LOKI_SRC})
target_link_libraries(mini_loki
  mini_loki_common
  mini_loki_crypto
  mini_loki_daemon
  mini_loki_cn_core
  mini_loki_cn_basic
  mini_loki_cn_proto
  mini_loki_epee
  mini_loki_upnp
  mini_loki_rpc
  mini_loki_serialization
)

#
# Lokinet
#

set(ABSEIL_DIR ../../loki-network/vendor/abseil-cpp)
include_directories(${ABSEIL_DIR})
#add_subdirectory(${ABSEIL_DIR})

set(LOKINET_SRC
  ../../loki-network/llarp/crypto/constants.cpp
  ../../loki-network/llarp/crypto/crypto_libsodium.cpp
  ../../loki-network/llarp/crypto/crypto.cpp
  ../../loki-network/llarp/crypto/encrypted_frame.cpp
  ../../loki-network/llarp/crypto/encrypted.cpp
  ../../loki-network/llarp/crypto/types.cpp
  ../../loki-network/llarp/dht/bucket.cpp
  ../../loki-network/llarp/dht/context.cpp
  ../../loki-network/llarp/dht/dht.cpp
  ../../loki-network/llarp/dht/explorenetworkjob.cpp
  ../../loki-network/llarp/dht/kademlia.cpp
  ../../loki-network/llarp/dht/key.cpp
  ../../loki-network/llarp/dht/localtaglookup.cpp
  ../../loki-network/llarp/dht/localrouterlookup.cpp
  ../../loki-network/llarp/dht/localserviceaddresslookup.cpp
  ../../loki-network/llarp/dht/message.cpp
  ../../loki-network/llarp/dht/messages/findintro.cpp
  ../../loki-network/llarp/dht/messages/findrouter.cpp
  ../../loki-network/llarp/dht/messages/gotintro.cpp
  ../../loki-network/llarp/dht/messages/gotrouter.cpp
  ../../loki-network/llarp/dht/messages/pubintro.cpp
  ../../loki-network/llarp/dht/node.cpp
  ../../loki-network/llarp/dht/publishservicejob.cpp
  ../../loki-network/llarp/dht/recursiverouterlookup.cpp
  ../../loki-network/llarp/dht/serviceaddresslookup.cpp
  ../../loki-network/llarp/dht/taglookup.cpp
  ../../loki-network/llarp/dht/tx.cpp
  ../../loki-network/llarp/dht/txholder.cpp
  ../../loki-network/llarp/dht/txowner.cpp
  ../../loki-network/llarp/dns.cpp
  ../../loki-network/llarp/dnsc.cpp
  ../../loki-network/llarp/dnsd.cpp
  ../../loki-network/llarp/exit/close_exit.cpp
  ../../loki-network/llarp/exit/context.cpp
  ../../loki-network/llarp/exit/endpoint.cpp
  ../../loki-network/llarp/exit/grant_exit.cpp
  ../../loki-network/llarp/exit/obtain_exit.cpp
  ../../loki-network/llarp/exit/policy.cpp
  ../../loki-network/llarp/exit/reject_exit.cpp
  ../../loki-network/llarp/exit/session.cpp
  ../../loki-network/llarp/exit/transfer_traffic.cpp
  ../../loki-network/llarp/exit/update_exit.cpp
  ../../loki-network/llarp/handlers/exit.cpp
  ../../loki-network/llarp/handlers/null.cpp
  ../../loki-network/llarp/handlers/tun.cpp
  ../../loki-network/llarp/link/curvecp.cpp
  ../../loki-network/llarp/link/encoder.cpp
  ../../loki-network/llarp/link/iwp.cpp
  ../../loki-network/llarp/link/server.cpp
  ../../loki-network/llarp/link/session.cpp
  ../../loki-network/llarp/link/utp.cpp
  ../../loki-network/llarp/messages/dht.cpp
  ../../loki-network/llarp/messages/dht_immediate.cpp
  ../../loki-network/llarp/messages/discard.cpp
  ../../loki-network/llarp/messages/exit.cpp
  ../../loki-network/llarp/messages/link_intro.cpp
  ../../loki-network/llarp/messages/link_message.cpp
  ../../loki-network/llarp/messages/path_confirm.cpp
  ../../loki-network/llarp/messages/path_latency.cpp
  ../../loki-network/llarp/messages/path_transfer.cpp
  ../../loki-network/llarp/messages/relay.cpp
  ../../loki-network/llarp/messages/relay_commit.cpp
  ../../loki-network/llarp/messages/transfer_traffic.cpp
  ../../loki-network/llarp/net/address_info.cpp
  ../../loki-network/llarp/net/exit_info.cpp
  ../../loki-network/llarp/net/ip.cpp
  ../../loki-network/llarp/net/net_int.cpp
  #../../loki-network/llarp/net/net_addr.cpp
  ../../loki-network/llarp/nodedb.cpp
  ../../loki-network/llarp/path/path.cpp
  ../../loki-network/llarp/path/path_types.cpp
  ../../loki-network/llarp/path/pathbuilder.cpp
  ../../loki-network/llarp/path/pathset.cpp
  ../../loki-network/llarp/path/transit_hop.cpp
  ../../loki-network/llarp/pow.cpp
  ../../loki-network/llarp/profiling.cpp
  ../../loki-network/llarp/router/router.cpp
  ../../loki-network/llarp/router_contact.cpp
  ../../loki-network/llarp/router_id.cpp
  ../../loki-network/llarp/routing/dht_message.cpp
  ../../loki-network/llarp/routing/handler.cpp
  ../../loki-network/llarp/routing/message_parser.cpp
  ../../loki-network/llarp/routing/message.cpp
  ../../loki-network/llarp/routing/path_confirm.cpp
  ../../loki-network/llarp/routing/path_latency.cpp
  ../../loki-network/llarp/routing/path_transfer.cpp
  ../../loki-network/llarp/rpc/rpc.cpp
  ../../loki-network/llarp/service/Identity.cpp
  ../../loki-network/llarp/service/Intro.cpp
  ../../loki-network/llarp/service/IntroSet.cpp
  ../../loki-network/llarp/service/address.cpp
  ../../loki-network/llarp/service/config.cpp
  ../../loki-network/llarp/service/context.cpp
  ../../loki-network/llarp/service/endpoint.cpp
  ../../loki-network/llarp/service/handler.cpp
  ../../loki-network/llarp/service/info.cpp
  ../../loki-network/llarp/service/lookup.cpp
  ../../loki-network/llarp/service/protocol.cpp
  ../../loki-network/llarp/service/tag.cpp
  ../../loki-network/llarp/service/types.cpp
  ../../loki-network/llarp/service/vanity.cpp
  ../../loki-network/llarp/testnet.c

  ../../loki-network/vendor/cppbackport-master/lib/fs/path.cpp
  ../../loki-network/vendor/cppbackport-master/lib/fs/filestatus.cpp
  ../../loki-network/vendor/cppbackport-master/lib/fs/perms.cpp
  ../../loki-network/vendor/cppbackport-master/lib/fs/filetype.cpp
  ../../loki-network/llarp/config.cpp
  ../../loki-network/llarp/context.cpp
  ../../loki-network/llarp/dns/rectypes.cpp
  ../../loki-network/llarp/timer.cpp
  ../../loki-network/llarp/ev/ev.cpp
  ../../loki-network/llarp/util/bencode.cpp
  ../../loki-network/llarp/util/buffer.cpp
  ../../loki-network/llarp/util/ini.cpp
  ../../loki-network/llarp/util/logic.cpp
  ../../loki-network/llarp/util/logger.cpp
  ../../loki-network/llarp/util/mem.cpp
  ../../loki-network/llarp/util/str.cpp
  ../../loki-network/llarp/util/time.cpp
  ../../loki-network/llarp/util/threadpool.cpp
)

set(NTRU_AVX_SRC
  ../../loki-network/crypto/libntrup/src/avx/randomsmall.c
  ../../loki-network/crypto/libntrup/src/avx/weight.c
  ../../loki-network/crypto/libntrup/src/avx/swap.c
  ../../loki-network/crypto/libntrup/src/avx/rq_round3.c
  ../../loki-network/crypto/libntrup/src/avx/rq_recip3.c
  ../../loki-network/crypto/libntrup/src/avx/small.c
  ../../loki-network/crypto/libntrup/src/avx/randomweightw.c
  ../../loki-network/crypto/libntrup/src/avx/dec.c
  ../../loki-network/crypto/libntrup/src/avx/r3_recip.c
  ../../loki-network/crypto/libntrup/src/avx/keypair.c
  ../../loki-network/crypto/libntrup/src/avx/rq_rounded.c
  ../../loki-network/crypto/libntrup/src/avx/mult.c
  ../../loki-network/crypto/libntrup/src/avx/enc.c
  ../../loki-network/crypto/libntrup/src/avx/int32_sort.c
  ../../loki-network/crypto/libntrup/src/avx/rq.c
  ../../loki-network/crypto/libntrup/src/avx/rq_mod3.c
)

set(NTRU_REF_SRC
  ../../loki-network/crypto/libntrup/src/ref/randomsmall.c
  ../../loki-network/crypto/libntrup/src/ref/swap.c
  ../../loki-network/crypto/libntrup/src/ref/rq_round3.c
  ../../loki-network/crypto/libntrup/src/ref/rq_recip3.c
  ../../loki-network/crypto/libntrup/src/ref/small.c
  ../../loki-network/crypto/libntrup/src/ref/rq_mult.c
  ../../loki-network/crypto/libntrup/src/ref/randomweightw.c
  ../../loki-network/crypto/libntrup/src/ref/random32.c
  ../../loki-network/crypto/libntrup/src/ref/dec.c
  ../../loki-network/crypto/libntrup/src/ref/r3_mult.c
  ../../loki-network/crypto/libntrup/src/ref/r3_recip.c
  ../../loki-network/crypto/libntrup/src/ref/keypair.c
  ../../loki-network/crypto/libntrup/src/ref/rq_rounded.c
  ../../loki-network/crypto/libntrup/src/ref/enc.c
  ../../loki-network/crypto/libntrup/src/ref/int32_sort.c
  ../../loki-network/crypto/libntrup/src/ref/rq.c
)
set(CRYPTOGRAPHY_SRC
  ../../loki-network/crypto/libsodium/init.c
  ../../loki-network/crypto/libsodium/runtime.c
  ../../loki-network/crypto/verify/crypto_verify.c
  ../../loki-network/crypto/secmem/secmem.c
  ../../loki-network/crypto/csrng/randombytes_salsa20_random.c
  ../../loki-network/crypto/csrng/randombytes.c
  ../../loki-network/crypto/blake2b/blake2b-compress-avx2.c
  ../../loki-network/crypto/blake2b/blake2b-compress-ref.c
  ../../loki-network/crypto/blake2b/blake2b-compress-sse41.c
  ../../loki-network/crypto/blake2b/blake2b-compress-ssse3.c
  ../../loki-network/crypto/blake2b/blake2b-ref.c
  ../../loki-network/crypto/blake2b/generichash_blake2b.c
  ../../loki-network/crypto/chacha20/ref/chacha20_ref.c
  ../../loki-network/crypto/chacha20/dolbeau/chacha20_dolbeau-ssse3.c
  ../../loki-network/crypto/chacha20/dolbeau/chacha20_dolbeau-avx2.c
  ../../loki-network/crypto/chacha20/stream_chacha20.c
  ../../loki-network/crypto/salsa20/ref/salsa20_ref.c
  ../../loki-network/crypto/salsa20/core_salsa_ref.c
  ../../loki-network/crypto/salsa20/stream_salsa20.c
  ../../loki-network/crypto/salsa20/xmm6/salsa20_xmm6-asm.S
  ../../loki-network/crypto/salsa20/xmm6/salsa20_xmm6.c
  ../../loki-network/crypto/salsa20/xmm6int/salsa20_xmm6int-avx2.c
  ../../loki-network/crypto/salsa20/xmm6int/salsa20_xmm6int-sse2.c
  ../../loki-network/crypto/xchacha20/hchacha.c
  ../../loki-network/crypto/xchacha20/stream_xchacha20.c
  ../../loki-network/crypto/curve25519/crypto_scalarmult.c
  ../../loki-network/crypto/curve25519/ref10/x25519_ref10.c
  ../../loki-network/crypto/curve25519/ref10/ed25519_ref10.c
  ../../loki-network/crypto/curve25519/sandy2x/fe51_invert.c
  ../../loki-network/crypto/curve25519/sandy2x/ladder_base.S
  ../../loki-network/crypto/curve25519/sandy2x/curve25519_sandy2x.c
  ../../loki-network/crypto/curve25519/sandy2x/consts.S
  ../../loki-network/crypto/curve25519/sandy2x/fe51_nsquare.S
  ../../loki-network/crypto/curve25519/sandy2x/fe51_mul.S
  ../../loki-network/crypto/curve25519/sandy2x/fe51_pack.S
  ../../loki-network/crypto/curve25519/sandy2x/fe_frombytes_sandy2x.c
  ../../loki-network/crypto/curve25519/sandy2x/sandy2x.S
  ../../loki-network/crypto/curve25519/sandy2x/ladder.S
  ../../loki-network/crypto/curve25519/scalarmult_curve25519.c
  ../../loki-network/crypto/ed25519/crypto_box.c
  ../../loki-network/crypto/ed25519/crypto_sign.c
  ../../loki-network/crypto/ed25519/ref10/open.c
  ../../loki-network/crypto/ed25519/ref10/obsolete.c
  ../../loki-network/crypto/ed25519/ref10/keypair.c
  ../../loki-network/crypto/ed25519/ref10/sign.c
  ../../loki-network/crypto/ed25519/sign_ed25519.c
  ../../loki-network/crypto/sha512/sha512.c
  ${NTRU_AVX_SRC}
  ${NTRU_REF_SRC}
  ../../loki-network/crypto/libntrup/src/ntru.cpp)

set(UTP_SRC
  ../../loki-network/libutp/utp_callbacks.cpp
  ../../loki-network/libutp/utp_utils.cpp
  ../../loki-network/libutp/utp_internal.cpp
  ../../loki-network/libutp/utp_api.cpp
  ../../loki-network/libutp/utp_packedsockaddr.cpp
  ../../loki-network/libutp/utp_hash.cpp
)

add_library(lokinet ${LOKINET_SRC} ${CRYPTOGRAPHY_SRC} ${UTP_SRC}

#  ../../loki-network/build/vendor/abseil-cpp/absl/types/libabsl_optional.a
#  ../../loki-network/build/vendor/abseil-cpp/absl/types/libabsl_variant.a
)
target_include_directories (lokinet PUBLIC "../../loki-network/include")
target_include_directories (lokinet PUBLIC "../../loki-network/llarp")
#target_include_directories (lokinet PUBLIC "../../loki-network/vendor/abseil-cpp")
target_include_directories (lokinet PUBLIC "../../loki-network/crypto/include")
target_include_directories (lokinet PUBLIC "../../loki-network/vendor/cppbackport-master/lib")
target_include_directories (lokinet PUBLIC "../../loki-network/llarp/util")
#target_include_directories (lokinet PUBLIC "../../loki-network/include/llarp")
#target_include_directories (lokinet PUBLIC "../../loki-network/libutp")

#
# Launcher
#

add_executable(Launcher
  ../main.cpp
)
#find_library(MACOS_POWER_LIBRARY IOPowerSources)
target_include_directories (Launcher PUBLIC "../../loki-network/llarp")
target_include_directories (Launcher PUBLIC "../../loki-network/include")
target_include_directories (Launcher PUBLIC "../../loki-network/crypto/include")
target_include_directories (Launcher PUBLIC "../../loki-network/vendor/cppbackport-master/lib")


if (${CMAKE_SYSTEM_NAME} MATCHES "Darwin")
  message(STATUS "MacOS detected")
  TARGET_LINK_LIBRARIES(Launcher
    "-framework IOKit"
  )
endif()

if (${CMAKE_SYSTEM_NAME} MATCHES "Linux")
  message(STATUS "Linux detected")
  TARGET_LINK_LIBRARIES(Launcher
    "-lpthread"
  )
endif()

target_link_libraries(Launcher ${Boost_LIBRARIES})
TARGET_LINK_LIBRARIES(Launcher
  lokinet
  mini_loki
#  ssl crypto
#  unbound
#  zmq
#  ${BOOST_LIB_DIR}/libboost_chrono.a
#  ${BOOST_LIB_DIR}/libboost_system.a
#  ${BOOST_LIB_DIR}/libboost_filesystem.a
#  ${BOOST_LIB_DIR}/libboost_regex.a
#  ${BOOST_LIB_DIR}/libboost_thread.a
#  ${BOOST_LIB_DIR}/libboost_program_options.a
#  ${BOOST_LIB_DIR}/libboost_serialization.a
)
