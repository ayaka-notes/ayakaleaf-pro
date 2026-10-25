#!/usr/bin/env python3
"""
Create black/white versions of SVG logos.

This script converts all non-transparent and non-white colors to a specified color
(default: black), creating modified versions of the logos.

Usage:
    python create_sw_versions.py <input.svg> <output.svg> [color]
    python create_sw_versions.py logo.svg logo_sw.svg
    python create_sw_versions.py logo.svg logo_sw.svg "#FF0000"
"""

import re
import sys
import os


def style_to_color(style_content, target_color):
    """Convert colors in style attributes to target color."""
    # Replace fill colors
    style_content = re.sub(
        r'fill:\s*#[0-9a-fA-F]{6}',
        f'fill:{target_color}',
        style_content
    )
    style_content = re.sub(
        r'fill:\s*rgb\([^)]+\)',
        f'fill:{target_color}',
        style_content
    )
    
    # Replace stroke colors
    style_content = re.sub(
        r'stroke:\s*#[0-9a-fA-F]{6}',
        f'stroke:{target_color}',
        style_content
    )
    style_content = re.sub(
        r'stroke:\s*rgb\([^)]+\)',
        f'stroke:{target_color}',
        style_content
    )
    
    return style_content


def convert_to_target_color(svg_content, target_color="#000000"):
    """
    Convert SVG colors to target color, keeping transparent and white as-is.
    
    Args:
        svg_content: String containing SVG XML content
        target_color: Target color (default: #000000 for black)
    
    Returns:
        Modified SVG content with colors converted to target color
    """
    # Handle fill and stroke attributes
    svg_content = re.sub(
        r'(fill|stroke)="(#(?!ffffff|FFFFFF|fff|FFF)[0-9a-fA-F]{6}|#(?!fff|FFF)[0-9a-fA-F]{3}|rgb\([^)]+\))"',
        rf'\1="{target_color}"',
        svg_content
    )
    
    # Handle style attributes
    def replace_style(match):
        style_content = match.group(1)
        style_content = style_to_color(style_content, target_color)
        return f'style="{style_content}"'
    
    svg_content = re.sub(
        r'style="([^"]+)"',
        replace_style,
        svg_content
    )
    
    # Handle color attributes (less common)
    svg_content = re.sub(
        r'color="(#(?!ffffff|FFFFFF|fff|FFF)[0-9a-fA-F]{6}|rgb\([^)]+\))"',
        f'color="{target_color}"',
        svg_content
    )
    
    return svg_content


def process_svg_file(input_file, output_file, target_color="#000000"):
    """
    Read SVG file, convert colors to target color, and save.
    
    Args:
        input_file: Path to input SVG file
        output_file: Path to output SVG file
        target_color: Target color (default: #000000)
    """
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            svg_content = f.read()
        
        # Convert colors
        modified_content = convert_to_target_color(svg_content, target_color)
        
        # Write output
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(modified_content)
        
        print(f"✓ Created {output_file} with color {target_color}")
        return True
        
    except FileNotFoundError:
        print(f"✗ Error: {input_file} not found")
        return False
    except Exception as e:
        print(f"✗ Error processing {input_file}: {e}")
        return False


def main():
    """Main entry point."""
    if len(sys.argv) < 3:
        print("=" * 60)
        print("ERROR: Invalid usage!")
        print("=" * 60)
        print()
        print("Usage:")
        print("  python create_sw_versions.py <input.svg> <output.svg> [color]")
        print()
        print("Examples:")
        print("  python create_sw_versions.py logo.svg logo_sw.svg")
        print("  python create_sw_versions.py logo.svg logo_red.svg \"#FF0000\"")
        print("  python create_sw_versions.py logo_full.svg logo_full_sw.svg \"#000000\"")
        print()
        print("Default color: #000000 (black)")
        print("=" * 60)
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_file = sys.argv[2]
    target_color = sys.argv[3] if len(sys.argv) > 3 else "#000000"
    
    # Check if input file exists
    if not os.path.isfile(input_file):
        print("=" * 60)
        print("ERROR: Input file not found!")
        print("=" * 60)
        print()
        print(f"The file '{input_file}' does not exist.")
        print()
        print(f"Current directory: {os.getcwd()}")
        print("=" * 60)
        sys.exit(1)
    
    # Validate color format
    if not re.match(r'^#[0-9a-fA-F]{6}$', target_color):
        print("=" * 60)
        print("WARNING: Invalid color format!")
        print("=" * 60)
        print()
        print(f"Color '{target_color}' may not be valid.")
        print("Expected format: #RRGGBB (e.g., #000000, #FF0000)")
        print()
        print("Proceeding anyway...")
        print("=" * 60)
        print()
    
    print(f"Converting: {input_file} -> {output_file}")
    print(f"Target color: {target_color}")
    print()
    
    if process_svg_file(input_file, output_file, target_color):
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
