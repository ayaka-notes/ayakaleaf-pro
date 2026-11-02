#!/usr/bin/env bash
set -e

VERSION="v0.5.7"

curl -L "https://github.com/WGUNDERWOOD/tex-fmt/archive/refs/tags/${VERSION}.tar.gz" | tar xz

cd "tex-fmt-${VERSION#v}"

# Same steps as the `wasm` recipe in tex-fmt's justfile
cargo build --release --locked --features wasm --lib --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir pkg \
  target/wasm32-unknown-unknown/release/tex_fmt.wasm
wasm-opt -Oz -o pkg/tex_fmt_bg.wasm pkg/tex_fmt_bg.wasm

cp pkg/tex_fmt.js pkg/tex_fmt.d.ts pkg/tex_fmt_bg.wasm /wasm/
