cmake_minimum_required (VERSION 2.6)
#project (snode_launcher)
# The version number.
#set (Launcher_VERSION_MAJOR 0)
#set (Launcher_VERSION_MINOR 1)

add_subdirectory(src/loki-network)
#set(CMAKE_PREFIX_PATH src/loki)
#set(CMAKE_MODULE_PATH src/loki/cmake)
add_subdirectory(src/loki)
