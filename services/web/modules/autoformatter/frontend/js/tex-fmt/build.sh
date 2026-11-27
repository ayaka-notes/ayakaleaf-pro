#!/usr/bin/env bash
set -e

# build a Rust Docker image with wasm-bindgen and wasm-opt installed
docker build --pull --tag overleaf/tex-fmt-wasm .

# compile tex-fmt to WASM and copy the output files from the Docker container
docker run --rm \
  --workdir /opt \
  --volume "$(pwd)/wasm":/wasm \
  --volume "$(pwd)/compile.sh":/opt/compile.sh:ro \
  overleaf/tex-fmt-wasm \
  bash compile.sh
