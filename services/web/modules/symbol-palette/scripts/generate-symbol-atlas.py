#!/usr/bin/env python3
"""Build the symbol atlas from pinned, GPL-3.0 Hand-TeX SVG sources.

Install playwright==1.58.0 and its Chromium browser, then run this script.
--archive accepts an already downloaded source archive for offline rebuilding.
"""

import argparse
import base64
import hashlib
import importlib.metadata
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import urllib.request
import xml.etree.ElementTree as ET

from playwright.sync_api import sync_playwright


COMMIT = "5613813717c393fb5bcb405a83e63facdab1c998"
SOURCE_URL = f"https://codeload.github.com/VoxelCubes/Hand-TeX/tar.gz/{COMMIT}"
SOURCE_SHA256 = "a84b1464a83bc37df64c7b72b4eadee9ba1e67709819a274949d8b2cbcfed9d4"
MODULE = Path(__file__).resolve().parents[1]
ASSETS = MODULE / "frontend/js/recognition/assets"
CELL = 64
COLUMNS = 48
PADDING = 4
MATERIAL_COMMIT = "bd8cb85bd4bad964fe6918f79665bb40c3a8efef"
CLOCK_SOURCE = "scripts/symbol-overrides/clock.svg"
CLOCK_UPSTREAM_SHA256 = "22d5a7b0e4394b7d359436c6dbaefa72187ee3433867cf108cd2f4be31a1aa26"
CLOCK_SHA256 = "195008a6770dc270810b0fc7dac2406a9bd2ab220d6722f0deb7d7b0153e5e41"
MATERIAL_LICENSE_SHA256 = "58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def atomic_write(path, content):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        temporary.write(content)
        os.fchmod(temporary.fileno(), 0o644)
        temporary_path = Path(temporary.name)
    try:
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--chromium", type=Path)
    parser.add_argument("--output", type=Path, default=ASSETS)
    args = parser.parse_args()
    if args.archive:
        archive_bytes = args.archive.read_bytes()
    else:
        with urllib.request.urlopen(SOURCE_URL, timeout=60) as response:
            archive_bytes = response.read()
    if sha256(archive_bytes) != SOURCE_SHA256:
        raise ValueError("Hand-TeX source archive checksum does not match")

    labels_bytes = (ASSETS / "labels.json").read_bytes()
    labels = json.loads(labels_bytes)
    if len({label["command"] for label in labels}) != len(labels):
        raise ValueError("The symbol catalog contains duplicate commands")
    clock_bytes = (MODULE / CLOCK_SOURCE).read_bytes()
    material_license = (ASSETS / "SYMBOLS-MATERIAL-LICENSE").read_bytes()
    if sha256(clock_bytes) != CLOCK_SHA256:
        raise ValueError("The clock SVG checksum does not match")
    if sha256(material_license) != MATERIAL_LICENSE_SHA256:
        raise ValueError("The Material Icons license checksum does not match")

    prefix = f"Hand-TeX-{COMMIT}/"
    with tarfile.open(fileobj=io.BytesIO(archive_bytes)) as archive:
        def read_source(relative_path):
            member = archive.getmember(prefix + relative_path)
            if not member.isfile():
                raise ValueError(f"Expected a regular source file: {relative_path}")
            return archive.extractfile(member).read()

        license_bytes = read_source("LICENSE")
        metadata_bytes = read_source("handtex/data/symbol_metadata/symbols.json")
        symbols = {}
        for symbol in json.loads(metadata_bytes):
            key = (symbol["command"], symbol.get("package"))
            if key in symbols:
                raise ValueError(f"Ambiguous upstream command and package: {key}")
            symbols[key] = symbol

        sources = {}
        svg_images = []
        for label in labels:
            symbol = symbols[(label["command"], label.get("package"))]
            filename = f"symbols/svg/{symbol['filename']}.svg"
            svg_bytes = read_source(filename)
            # Hand-TeX's clock SVG depicts a slashed oval, so use the licensed
            # Material schedule icon for this command only.
            if label["command"] == "\\clock":
                filename = CLOCK_SOURCE
                svg_bytes = clock_bytes
            sources[filename] = sha256(svg_bytes)
            svg = ET.fromstring(svg_bytes)
            if not svg.get("viewBox"):
                raise ValueError(f"Missing SVG viewBox: {filename}")
            # The upstream viewBox is tightly cropped; add room inside each cell
            # so neighbouring CSS mask cells cannot bleed into the glyph.
            svg.set("width", str(CELL - 2 * PADDING))
            svg.set("height", str(CELL - 2 * PADDING))
            svg.set("preserveAspectRatio", "xMidYMid meet")
            svg_images.append(base64.b64encode(ET.tostring(svg)).decode())

    with sync_playwright() as playwright:
        options = {"headless": True}
        if args.chromium:
            options["executable_path"] = str(args.chromium)
        browser = playwright.chromium.launch(**options)
        chromium_version = browser.version
        try:
            page = browser.new_page()
            rendered = page.evaluate(
                """async ({images, cell, columns, padding}) => {
                  const canvas = document.createElement('canvas');
                  canvas.width = cell * columns;
                  canvas.height = cell * Math.ceil(images.length / columns);
                  const context = canvas.getContext('2d', {willReadFrequently: true});
                  const ink = [];
                  for (let index = 0; index < images.length; index++) {
                    const image = new Image();
                    image.src = `data:image/svg+xml;base64,${images[index]}`;
                    await image.decode();
                    const x = (index % columns) * cell;
                    const y = Math.floor(index / columns) * cell;
                    context.drawImage(image, x + padding, y + padding);
                    const rgba = context.getImageData(x, y, cell, cell).data;
                    let count = 0;
                    for (let pixel = 3; pixel < rgba.length; pixel += 4) {
                      if (rgba[pixel] > 0) count++;
                    }
                    if (!count) throw new Error(`Empty symbol at index ${index}`);
                    ink.push(count);
                  }
                  return {
                    png: canvas.toDataURL('image/png').split(',')[1],
                    width: canvas.width,
                    height: canvas.height,
                    minimumInkPixels: Math.min(...ink)
                  };
                }""",
                {"images": svg_images, "cell": CELL, "columns": COLUMNS, "padding": PADDING},
            )
        finally:
            browser.close()

    png_bytes = base64.b64decode(rendered["png"])
    atlas_metadata = json_bytes({
        "cell": CELL,
        "columns": COLUMNS,
        "commands": [label["command"] for label in labels],
    })
    provenance = {
        "description": "Locally rasterized Hand-TeX SVG glyphs with a Material Icons clock override; not original artwork.",
        "sourceRepository": "https://github.com/VoxelCubes/Hand-TeX",
        "sourceCommit": COMMIT,
        "sourceArchive": {"url": SOURCE_URL, "sha256": SOURCE_SHA256},
        "license": "GPL-3.0",
        "licenseSource": f"https://github.com/VoxelCubes/Hand-TeX/blob/{COMMIT}/LICENSE",
        "licenseSha256": sha256(license_bytes),
        "upstreamRenderingScript": f"https://github.com/VoxelCubes/Hand-TeX/blob/{COMMIT}/symbols/pre_renderer.py",
        "upstreamMetadataSha256": sha256(metadata_bytes),
        "labelsSha256": sha256(labels_bytes),
        "svgSourceCount": len(sources),
        "svgSourcesSha256": sha256(json_bytes(dict(sorted(sources.items())))),
        "overrides": [{
            "command": "\\clock",
            "source": CLOCK_SOURCE,
            "sha256": CLOCK_SHA256,
            "upstreamSha256": CLOCK_UPSTREAM_SHA256,
            "modification": "Clock hands changed to point to 12 and 3, with rounded ends.",
            "sourceUrl": f"https://raw.githubusercontent.com/google/material-design-icons/{MATERIAL_COMMIT}/src/action/schedule/materialicons/24px.svg",
            "license": "Apache-2.0",
            "licenseFile": "SYMBOLS-MATERIAL-LICENSE",
            "licenseSha256": MATERIAL_LICENSE_SHA256,
            "licenseSource": f"https://github.com/google/material-design-icons/blob/{MATERIAL_COMMIT}/LICENSE",
        }],
        "generator": "scripts/generate-symbol-atlas.py",
        "renderer": {
            "playwright": importlib.metadata.version("playwright"),
            "chromium": chromium_version,
            "cell": CELL,
            "padding": PADDING,
        },
        "validation": {
            "commands": len(labels),
            "nonemptyCells": len(labels),
            "minimumInkPixels": rendered["minimumInkPixels"],
            "width": rendered["width"],
            "height": rendered["height"],
        },
        "generatedFiles": {
            "sprites.png": sha256(png_bytes),
            "sprites.json": sha256(atlas_metadata),
        },
    }
    args.output.mkdir(parents=True, exist_ok=True)
    # Validate the entire atlas before replacing either live asset.
    for filename, content in (
        ("sprites.png", png_bytes),
        ("sprites.json", atlas_metadata),
        ("SYMBOLS-LICENSE", license_bytes),
        ("SYMBOLS-MATERIAL-LICENSE", material_license),
        ("sprites-provenance.json", json_bytes(provenance)),
    ):
        atomic_write(args.output / filename, content)
    print(json.dumps(provenance["validation"]))
    print(json.dumps(provenance["generatedFiles"]))


if __name__ == "__main__":
    main()
