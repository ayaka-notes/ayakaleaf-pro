#!/usr/bin/env python3
"""
Generate logo PNG from SVG using Inkscape.

This script generates a PNG file from an SVG with specified dimensions and options.

Usage:
    python generate_additional_logos.py <input.svg> <output.png> <width> <height> [options]
    
Examples:
    python generate_additional_logos.py logo_full.svg logo-horizontal.png 410 180 --export-area-drawing
"""

import subprocess
import sys
import os


def main():
    """Main entry point."""
    if len(sys.argv) < 5:
        print("=" * 60)
        print("ERROR: Invalid usage!")
        print("=" * 60)
        print()
        print("Usage:")
        print("  python generate_additional_logos.py <input.svg> <output.png> <width> <height> [options]")
        print()
        print("Example:")
        print("  python generate_additional_logos.py logo_full.svg logo-horizontal.png 410 180 --export-area-drawing")
        print()
        print("Common options:")
        print("  --export-area-drawing    Export the bounding box of all objects")
        print("  --export-area-page       Export the page area (default)")
        print("=" * 60)
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_file = sys.argv[2]
    
    # Parse dimensions
    try:
        width = int(sys.argv[3])
        height = int(sys.argv[4])
    except ValueError:
        print(f"ERROR: Invalid dimensions - width='{sys.argv[3]}', height='{sys.argv[4]}'")
        print("Width and height must be integers.")
        sys.exit(1)
    
    # Check if input file exists
    if not os.path.isfile(input_file):
        print(f"ERROR: Input file '{input_file}' not found")
        print(f"Current directory: {os.getcwd()}")
        sys.exit(1)
    
    # Build Inkscape command
    command = [
        "inkscape",
        f"--export-filename={output_file}",
        f"--export-width={width}",
        f"--export-height={height}",
        "--export-background-opacity=0"
    ]
    
    # Add extra options (e.g., --export-area-drawing)
    if len(sys.argv) > 5:
        command.extend(sys.argv[5:])
    
    # Add input file
    command.append(input_file)
    
    # Run Inkscape
    print(f"Generating {output_file} ({width}×{height}) from {input_file}")
    
    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
        print(f"✓ {output_file} created successfully")
        sys.exit(0)
    except subprocess.CalledProcessError as e:
        print(f"✗ Error: {e.stderr}")
        sys.exit(1)
    except FileNotFoundError:
        print("✗ Error: Inkscape not found")
        print("Install: sudo apt install inkscape  (or brew install inkscape)")
        sys.exit(1)


if __name__ == "__main__":
    main()
