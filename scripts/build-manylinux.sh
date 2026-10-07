#!/bin/bash
# Builds the Linux glibc addon inside a manylinux_2_28 container, the same
# glibc floor Node's own Linux binaries have, so the addon loads wherever Node
# does. Built on the runner's Ubuntu 24.04 it needed glibc 2.38 and the GCC 13
# libstdc++, and on Debian 12 (the node:22 image), Ubuntu 22.04, Amazon Linux
# 2023 or RHEL 9 it failed to load and ata ran on pure JS instead.
#
# Usage, from the repository root: docker run --rm -v "$PWD":/work -w /work \
#   quay.io/pypa/manylinux_2_28_<arch> bash scripts/build-manylinux.sh
set -euo pipefail

case "$(uname -m)" in
  x86_64) NODE_ARCH=x64 ;;
  aarch64) NODE_ARCH=arm64 ;;
  *) echo "unsupported architecture $(uname -m)"; exit 1 ;;
esac
NODE_VERSION=v22.20.0
curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-$NODE_ARCH.tar.xz" | tar -xJ -C /opt
export PATH="/opt/node-$NODE_VERSION-linux-$NODE_ARCH/bin:$PATH"

npm ci --ignore-scripts
npx cmake-js build --target ata
strip --strip-unneeded build/Release/ata.node
ls -l build/Release/ata.node

# The floor is the point of building here; fail if anything raised it.
max() { objdump -T build/Release/ata.node | grep -o "$1_[0-9.]*" | sort -V | tail -1; }
echo "requires $(max GLIBC) $(max GLIBCXX)"
for v in "$(max GLIBC)"; do
  if [ "$(printf '%s\nGLIBC_2.28\n' "$v" | sort -V | tail -1)" != "GLIBC_2.28" ]; then
    echo "the addon needs $v, above the 2.28 floor"; exit 1
  fi
done

node scripts/smoke-native.js
