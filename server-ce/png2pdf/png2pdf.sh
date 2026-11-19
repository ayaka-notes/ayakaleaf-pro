#!/bin/sh
# CLSI "png2pdf" container contract shim (engine: img2pdf 0.6.3, josch).
# Replaces the proprietary quay.io/sharelatex/png2pdf:2026-06-24.
#
# Invoked by the CLSI docker runner (go/services/clsitex/dockerrunner.go, go/services/clsitex/png2pdf/png2pdf.go):
#   args: ["--in-place", "--", "<relpath1>", ...]   CWD=/compile
#   the docker runner does NOT supply a binary name in the command, so the
#   image ENTRYPOINT is this script.
#
# Paths: each arg is a conversion path CLSI downloaded, RELATIVE to the
# mounted cache dir (CWD /compile). Real CLSI derives it from the file
# URL path (u.Path: '/'->'-') + mtime + ".opt<10-hex cacheKey>",
# e.g. ".-uploads-filestore-a1b2c3d4-0-1-1756600000000.opta1b2c3d4a1bc"
# (leading dash, no directory separator).
#
# "IN-PLACE" means "rewrite each input PATH as a PDF". CLSI then renames
# each path to its own ".opt" cache entry and copies it into the compile
# dir (urlcache.CommitConversion) — PER FILE and UNCONDITIONALLY (sync.go:
# a conversion error only logs a warning). So each converted file lands
# in the cache even in a partially-failed run; an unconverted file is
# committed as the original-PNG fallback.
#
# Contract (go/services/clsitex/png2pdf/png2pdf.go):
#   - stdout: one "Converted <f> to PDF" per converted file (Go counts
#     lines matching ^Converted .+ to PDF$ -> stats.png2pdf).
#   - exit non-zero if anything fails: CLSI logs a warning and commits
#     each file's current on-disk state (converted or original).
#
# Why img2pdf: LOSSLESS. PNG IDAT is embedded verbatim into the PDF (no
# re-encode); the alpha channel becomes a PDF /SMask, also lossless.
# That is the mechanism of the feature: pdfTeX copies PDF image streams
# cheaply, whereas PNGs with alpha/gamma/palette/interlace are re-decoded
# from the PNG on every compile — what made them "slow". Without
# --imgsize the image keeps its pHYs DPI, falling back to 96dpi (the same
# default pdfLaTeX itself uses).
#
# Failure handling: convert to a temp + atomic replace, and CONTINUE with
# the remaining files after a failure (their valid conversions are
# committed by CLSI even though the run is reported failed). A failed
# file stays exactly the original PNG CLSI downloaded.

set -u

# argv is exactly [--in-place]... ["--"] <files...>. The loop terminates:
# every iteration either shifts, breaks, or exits.
while [ "$#" -gt 0 ]; do
  case "$1" in
    --)       shift ; break ;;
    --in-place) shift ;;
    *)        echo "png2pdf: unexpected argument: $1" >&2 ; exit 2 ;;
  esac
done

if [ "$#" -lt 1 ]; then
  echo "png2pdf: no input files (usage: --in-place -- <png>...)" >&2
  exit 2
fi

rc=0
for file in "$@"; do
  # Resolve against CWD so a leading '-' (or '.') never lands in an argv
  # slot of img2pdf/mv, where it would be parsed as an option.
  case "$file" in
    / | /*) abs="$file" ;;
    *)      abs="$(pwd)/$file" ;;
  esac
  tmp="${abs}.tmp"

  if ! img2pdf --output "$tmp" "$abs"; then
    echo "png2pdf: conversion failed for $file" >&2
    rm -f -- "$tmp"
    rc=1
    continue
  fi
  if ! mv -- "$tmp" "$abs"; then
    echo "png2pdf: failed to replace $file" >&2
    rm -f -- "$tmp"
    rc=1
    continue
  fi
  echo "Converted $file to PDF"
done
exit "$rc"
