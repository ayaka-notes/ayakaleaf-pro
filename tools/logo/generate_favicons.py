#!/usr/bin/env python3
"""
Generate favicon variants with status indicators (compiled, compiling, error)
Usage: python generate_favicons.py favicon.svg
"""

import sys
from pathlib import Path

def create_compiled_icon(size):
    """Create a green checkmark icon"""
    circle = f'<circle cx="{size/2}" cy="{size/2}" r="{size/2}" fill="#22c55e"/>'
    check_path = f'<path d="M {size*0.25} {size*0.5} L {size*0.4} {size*0.65} L {size*0.75} {size*0.3}" stroke="white" stroke-width="{size*0.15}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
    return f'{circle}{check_path}'

def create_compiling_icon(size):
    """Create rotating arrows icon (circular progress)"""
    circle = f'<circle cx="{size/2}" cy="{size/2}" r="{size/2}" fill="#e5e7eb"/>'
    r = size * 0.3
    cx, cy = size/2, size/2
    stroke_w = size * 0.06
    arrow_len = stroke_w * 2
    
    # Two SHORT arcs with arrow heads, forming an open circle
    # Arc 1: short arc at top-right (about 90 degrees)
    arc1 = f'<path d="M {cx} {cy-r} A {r} {r} 0 0 1 {cx+r} {cy}" stroke="black" stroke-width="{stroke_w}" fill="none" stroke-linecap="round"/>'
    # Arrow head for arc1 (pointing downward/clockwise at right side)
    arrow1 = f'<path d="M {cx+r-arrow_len} {cy-arrow_len} L {cx+r} {cy} L {cx+r+arrow_len} {cy-arrow_len}" stroke="black" stroke-width="{stroke_w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
    
    # Arc 2: short arc at bottom-left (about 90 degrees)
    arc2 = f'<path d="M {cx} {cy+r} A {r} {r} 0 0 1 {cx-r} {cy}" stroke="black" stroke-width="{stroke_w}" fill="none" stroke-linecap="round"/>'
    # Arrow head for arc2 (pointing upward/clockwise at left side)
    arrow2 = f'<path d="M {cx-r-arrow_len} {cy+arrow_len} L {cx-r} {cy} L {cx-r+arrow_len} {cy+arrow_len}" stroke="black" stroke-width="{stroke_w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
    
    return f'{circle}{arc1}{arrow1}{arc2}{arrow2}'

def create_error_icon(size):
    """Create a red X icon"""
    circle = f'<circle cx="{size/2}" cy="{size/2}" r="{size/2}" fill="#ef4444"/>'
    x1 = f'<line x1="{size*0.3}" y1="{size*0.3}" x2="{size*0.7}" y2="{size*0.7}" stroke="white" stroke-width="{size*0.15}" stroke-linecap="round"/>'
    x2 = f'<line x1="{size*0.7}" y1="{size*0.3}" x2="{size*0.3}" y2="{size*0.7}" stroke="white" stroke-width="{size*0.15}" stroke-linecap="round"/>'
    return f'{circle}{x1}{x2}'

def extract_dimensions(svg_content):
    """Extract width and height from SVG content"""
    # Try to find viewBox
    if 'viewBox=' in svg_content:
        start = svg_content.find('viewBox=')
        quote = svg_content[start + 8]
        start = start + 9
        end = svg_content.find(quote, start)
        viewbox = svg_content[start:end]
        parts = viewbox.split()
        return float(parts[2]), float(parts[3])
    
    # Try to find width and height attributes
    width = 100
    height = 100
    if 'width=' in svg_content:
        start = svg_content.find('width=')
        quote = svg_content[start + 6]
        start = start + 7
        end = svg_content.find(quote, start)
        width = float(svg_content[start:end].replace('px', ''))
    
    if 'height=' in svg_content:
        start = svg_content.find('height=')
        quote = svg_content[start + 7]
        start = start + 8
        end = svg_content.find(quote, start)
        height = float(svg_content[start:end].replace('px', ''))
    
    return width, height

def add_overlay_to_svg(input_file, output_file, overlay_creator):
    """Add an overlay icon to the SVG in the lower right corner"""
    with open(input_file, 'r') as f:
        svg_content = f.read()
    
    # Extract dimensions
    width, height = extract_dimensions(svg_content)
    
    # Calculate overlay size and position (1/3 of the icon size)
    overlay_size = min(width, height) / 3
    overlay_x = width - overlay_size - (overlay_size * 0.1)
    overlay_y = height - overlay_size - (overlay_size * 0.1)
    
    # Create overlay group
    overlay_svg = f'<g transform="translate({overlay_x}, {overlay_y})">\n  {overlay_creator(overlay_size)}\n</g>'
    
    # Find the closing </svg> tag and insert overlay before it
    closing_tag = '</svg>'
    insert_pos = svg_content.rfind(closing_tag)
    
    if insert_pos == -1:
        print(f"Error: Could not find closing </svg> tag in {input_file}")
        return
    
    # Insert the overlay
    new_content = svg_content[:insert_pos] + overlay_svg + '\n' + svg_content[insert_pos:]
    
    # Write output
    with open(output_file, 'w') as f:
        f.write(new_content)
    
    print(f"Created: {output_file}")

def main():
    if len(sys.argv) != 2:
        print("Usage: python generate_favicons.py favicon.svg")
        sys.exit(1)
    
    input_file = Path(sys.argv[1])
    
    if not input_file.exists():
        print(f"Error: {input_file} not found")
        sys.exit(1)
    
    base_name = input_file.stem
    output_dir = input_file.parent
    
    # Generate the three variants
    add_overlay_to_svg(
        input_file,
        output_dir / f"{base_name}-compiled.svg",
        create_compiled_icon
    )
    
    add_overlay_to_svg(
        input_file,
        output_dir / f"{base_name}-compiling.svg",
        create_compiling_icon
    )
    
    add_overlay_to_svg(
        input_file,
        output_dir / f"{base_name}-error.svg",
        create_error_icon
    )
    
    print("\nAll favicon variants created successfully!")

if __name__ == "__main__":
    main()