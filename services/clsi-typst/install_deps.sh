#!/bin/bash
set -ex

# qpdf is used by OutputFileOptimiser to linearize output.pdf (parity with
# the TeX clsi image). The typst compiler itself is a fully static binary
# (see Dockerfile typst-build stage), and PDF word-count marker extraction
# runs in-process (pdfjs-dist).

apt-get update
apt-get install -y --no-install-recommends qpdf
rm -rf /var/lib/apt/lists/*
