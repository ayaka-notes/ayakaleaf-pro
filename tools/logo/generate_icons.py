#!/usr/bin/env python3
"""
Icon Generator Tool

This script generates various icon sizes from an SVG file using Inkscape,
and creates a favicon.ico file using ImageMagick.

Usage:
    python generate_icons.py <input_svg_file>
    python generate_icons.py logo.svg
"""

import subprocess
import sys
import os
from pathlib import Path

# Detected ImageMagick command (either 'magick' for IM v7 or 'convert' for IM v6)
IMAGEMAGICK_CMD = None


def run_command(command, description):
    """
    Execute a shell command and handle errors.
    
    Args:
        command: List of command arguments
        description: Human-readable description of the command
    """
    print(f"Running: {description}")
    try:
        result = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True
        )
        print(f"✓ {description} completed successfully")
        return True
    except subprocess.CalledProcessError as e:
        print(f"✗ Error during {description}:")
        print(f"  {e.stderr}")
        return False
    except FileNotFoundError:
        print(f"✗ Error: Required tool not found for {description}")
        print(f"  Make sure the command '{command[0]}' is installed and in your PATH")
        return False


def check_file_exists(filepath):
    """Check if a file exists."""
    if not os.path.isfile(filepath):
        print(f"\n{'='*60}")
        print("ERROR: Input file not found!")
        print(f"{'='*60}")
        print(f"\nThe file '{filepath}' does not exist.\n")
        print("Requirements:")
        print(f"  1. Create or place '{filepath}' in the current directory")
        print(f"  2. Ensure the file is a valid SVG file")
        print(f"\nCurrent directory: {os.getcwd()}")
        print(f"{'='*60}\n")
        return False
    return True


def check_dependencies():
    """Check if required tools are installed."""
    print("Checking dependencies...")
    
    # Core dependency we always require
    dependencies = {
        "inkscape": "Inkscape (for PNG generation)"
    }
    
    missing = []
    
    # Check inkscape
    for cmd, description in dependencies.items():
        try:
            subprocess.run(
                [cmd, "--version"],
                check=True,
                capture_output=True,
                text=True
            )
            print(f"  ✓ {description} - found")
        except (subprocess.CalledProcessError, FileNotFoundError):
            print(f"  ✗ {description} - NOT FOUND")
            missing.append(cmd)
    
    # Detect ImageMagick: prefer 'magick' (ImageMagick 7), fall back to 'convert' (ImageMagick 6)
    global IMAGEMAGICK_CMD
    IMAGEMAGICK_CMD = None
    for cmd in ("magick", "convert"):
        try:
            subprocess.run([cmd, "--version"], check=True, capture_output=True, text=True)
            IMAGEMAGICK_CMD = cmd
            print(f"  ✓ ImageMagick ({cmd}) - found")
            break
        except (subprocess.CalledProcessError, FileNotFoundError):
            continue

    if IMAGEMAGICK_CMD is None:
        print(f"  ✗ ImageMagick - NOT FOUND (tried 'magick' and 'convert')")
        missing.append("ImageMagick ('magick' or 'convert')")

    if missing:
        print(f"\n{'='*60}")
        print("ERROR: Missing required dependencies!")
        print(f"{'='*60}")
        print("\nThe following tools are required but not found:")
        for tool in missing:
            print(f"  - {tool}")
        print("\nInstallation instructions:")
        print("\n  Ubuntu/Debian:")
        print("    sudo apt install inkscape imagemagick")
        print("\n  macOS:")
        print("    brew install inkscape imagemagick")
        print("\n  Windows:")
        print("    Download from:")
        print("    - https://inkscape.org/")
        print("    - https://imagemagick.org/")
        print(f"{'='*60}\n")
        return False
    
    print("✓ All dependencies found\n")
    return True


def generate_icons(svg_file):
    """
    Generate all icon sizes from an SVG file.
    
    Args:
        svg_file: Path to the input SVG file
    """
    print(f"Generating icons from: {svg_file}\n")
    
    # Define icon configurations
    # Format: (filename, width, height, background)
    icons = [
        ("android-chrome-512x512.png", 512, 512, "--export-background-opacity=0"),
        ("android-chrome-192x192.png", 192, 192, "--export-background-opacity=0"),
        ("apple-touch-icon.png", 180, 180, "--export-background=#FFFFFF"),
        ("favicon-16x16.png", 16, 16, "--export-background-opacity=0"),
        ("favicon-32x32.png", 32, 32, "--export-background-opacity=0"),
        ("overleaf_og_logo.png", 256, 256, "--export-background-opacity=0"),
    ]
    
    success_count = 0
    
    # Generate PNG files using Inkscape
    for filename, width, height, background in icons:
        command = [
            "inkscape",
            f"--export-filename={filename}",
            f"--export-width={width}",
            f"--export-height={height}",
            background,
            svg_file
        ]
        
        if run_command(command, f"Generating {filename}"):
            success_count += 1
        else:
            print(f"Warning: Failed to generate {filename}")
    
    print(f"\n{success_count}/{len(icons)} PNG icons generated successfully\n")
    
    # Generate favicon.ico using ImageMagick
    if check_file_exists("favicon-32x32.png"):
        if IMAGEMAGICK_CMD is None:
            print("\n✗ Cannot generate favicon.ico: no ImageMagick command detected")
            return False

        command = [
            IMAGEMAGICK_CMD,
            "favicon-32x32.png",
            "favicon.ico"
        ]
        
        if run_command(command, "Generating favicon.ico"):
            print("\n✓ All icons generated successfully!")
            return True
        else:
            print("\nWarning: PNG icons generated, but favicon.ico creation failed")
            return False
    else:
        print("\n✗ Cannot generate favicon.ico: favicon-32x32.png not found")
        return False


def main():
    """Main entry point."""
    if len(sys.argv) != 2:
        print(f"\n{'='*60}")
        print("ERROR: Invalid usage!")
        print(f"{'='*60}")
        print("\nUsage: python generate_icons.py <input_svg_file>")
        print("\nExample:")
        print("  python generate_icons.py logo.svg")
        print(f"{'='*60}\n")
        sys.exit(1)
    
    svg_file = sys.argv[1]
    
    print("=" * 60)
    print("Icon Generator Tool")
    print("=" * 60)
    print()
    
    # Check if input file exists FIRST
    if not check_file_exists(svg_file):
        sys.exit(1)
    
    # Check if required tools are installed
    if not check_dependencies():
        sys.exit(1)
    
    # Proceed with icon generation
    success = generate_icons(svg_file)
    
    print("=" * 60)
    
    if success:
        print("\nGenerated files:")
        print("  - android-chrome-512x512.png (512×512, transparent)")
        print("  - android-chrome-192x192.png (192×192, transparent)")
        print("  - apple-touch-icon.png (180×180, white background)")
        print("  - favicon-16x16.png (16×16, transparent)")
        print("  - favicon-32x32.png (32×32, transparent)")
        print("  - overleaf_og_logo.png (256×256, transparent)")
        print("  - favicon.ico")
        sys.exit(0)
    else:
        print("\n✗ Icon generation completed with errors")
        sys.exit(1)


if __name__ == "__main__":
    main()
