#!/usr/bin/env python3
import subprocess
import sys
import os
from pathlib import Path

# Detected ImageMagick command (either 'magick' for IM v7 or 'convert' for IM v6)
IMAGEMAGICK_CMD = None

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
        sys.exit(1)
    
    print("✓ All dependencies found\n")
    return True

if __name__ == "__main__":
    check_dependencies()
