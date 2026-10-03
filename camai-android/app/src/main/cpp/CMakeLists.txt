cmake_minimum_required(VERSION 3.22.1)
project(camai C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# llama.cpp is a git submodule pinned to a release (see /.gitmodules).
set(LLAMA_SRC ${CMAKE_CURRENT_LIST_DIR}/../../../../llama.cpp)

if(ANDROID_ABI STREQUAL "arm64-v8a")
    # Arm-optimised kernels (dotprod / i8mm / SME) picked at runtime for the phone's CPU.
    set(GGML_CPU_KLEIDIAI ON CACHE BOOL "" FORCE)
endif()

add_subdirectory(${LLAMA_SRC} build-llama)

add_library(camai SHARED engine.cpp jni_bridge.cpp)
target_include_directories(camai PRIVATE
    ${LLAMA_SRC}/include
    ${LLAMA_SRC}/common
    ${LLAMA_SRC}/ggml/include)
target_link_libraries(camai llama llama-common android log)
