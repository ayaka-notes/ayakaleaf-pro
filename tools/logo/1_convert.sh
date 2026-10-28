#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

python3 check_dependency.py

mkdir -p img/ol-brand

echo "============================================================"
echo "Logo Conversion Script"
echo "============================================================"
echo ""

# 1. Validation Checks
if [ ! -f "logo.svg" ] || [ ! -f "logo_full.svg" ]; then
    echo "ERROR: Required SVG files (logo.svg or logo_full.svg) not found!"
    exit 1
fi

echo "✓ Found source SVGs"

# 2. Generate Favicons
cp logo.svg favicon.svg
python3 generate_favicons.py favicon.svg

# 3. Create Black/White/Grey versions
echo "Creating black/white versions..."
python3 create_sw_versions.py logo.svg logo_sw.svg "#000000"
python3 create_sw_versions.py logo.svg mask-favicon.svg "#000000"
python3 create_sw_versions.py logo_full.svg img/ol-brand/overleaf-black.svg "#000000"
python3 create_sw_versions.py logo.svg img/ol-brand/overleaf-o-white.svg "#FFFFFF"
python3 create_sw_versions.py logo_full.svg img/ol-brand/overleaf-white.svg "#FFFFFF"
python3 create_sw_versions.py logo.svg img/ol-brand/overleaf-o-grey.svg "#808080"

# 4. Generate standard icons (creates overleaf_og_logo.png)
echo "Generating standard icons from logo.svg..."
python3 generate_icons.py logo.svg

# 5. Generate additional logos (FIX: Moved up so logo-horizontal.png exists before copying)
echo "Generating logo-horizontal.png from logo_full.svg..."
python3 generate_additional_logos.py logo_full.svg logo-horizontal.png 410 180 --export-area-drawing

# 6. Final File Operations (Copying generated assets to destination)
echo "Finalizing assets..."
cp -f overleaf_og_logo.png img/ol-brand/
cp -f logo-horizontal.png img/ol-brand/
cp -f logo.svg img/ol-brand/overleaf-o.svg
cp -f logo_full.svg img/ol-brand/overleaf.svg
cp -f logo_full.svg img/ol-brand/overleaf-a-ds-solution-mallard.svg
cp -f logo_full.svg img/ol-brand/overleaf-green.svg
cp -f logo.svg img/ol-brand/overleaf-o-dark.svg

# 7. Inline Python for Dark Mallard Variant
python3 - <<'PY'
from pathlib import Path
p = Path('img/ol-brand/overleaf-a-ds-solution-mallard.svg')
out = Path('img/ol-brand/overleaf-a-ds-solution-mallard-dark.svg')
if p.exists():
    s = p.read_text(encoding='utf-8')
    s = s.replace('#0000ff', '#FFFFFF').replace('#0000FF', '#FFFFFF')
    s = s.replace('#00aa00', '#13C965').replace('#00AA00', '#13C965')
    s = s.replace('fill:#0000ff', 'fill:#FFFFFF').replace('fill:#0000FF', 'fill:#FFFFFF')
    s = s.replace('stroke:#0000ff', 'stroke:#FFFFFF').replace('stroke:#0000FF', 'stroke:#FFFFFF')
    s = s.replace('fill:#00aa00', 'fill:#13C965').replace('fill:#00AA00', 'fill:#13C965')
    s = s.replace('stroke:#00aa00', 'stroke:#13C965').replace('stroke:#00AA00', 'stroke:#13C965')
    out.write_text(s, encoding='utf-8')
    print(f"✓ Created {out}")
else:
    import sys
    print(f"✗ Reference mallard file not found: {p}")
    sys.exit(1)
PY

echo ""
echo "============================================================"
echo "✓ All logos generated successfully!"
echo "============================================================"
