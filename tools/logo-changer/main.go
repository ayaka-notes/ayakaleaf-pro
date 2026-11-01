package main

import (
	"bytes"
	"encoding/binary"
	"encoding/xml"
	"errors"
	"fmt"
	"image"
	"image/png"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/srwiley/oksvg"
	"github.com/srwiley/rasterx"
)

type svgSize struct {
	ViewBox string `xml:"viewBox,attr"`
	Width   string `xml:"width,attr"`
	Height  string `xml:"height,attr"`
}

type iconSpec struct {
	Name            string
	Width, Height   int
	WhiteBackground bool
}

var (
	attributeColor = regexp.MustCompile(`(fill|stroke)="(#[0-9a-fA-F]{3,6}|rgb\([^)]+\))"`)
	styleColor     = regexp.MustCompile(`(fill|stroke):\s*(#[0-9a-fA-F]{6}|rgb\([^)]+\))`)
	colorAttr      = regexp.MustCompile(`color="(#[0-9a-fA-F]{3,6}|rgb\([^)]+\))"`)
	viewBoxValue   = regexp.MustCompile(`[-+]?([0-9]*\.?[0-9]+)([eE][-+]?[0-9]+)?`)
)

func main() {
	if err := generate(); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func generate() error {
	for _, name := range []string{"logo.svg", "logo_full.svg"} {
		if _, err := os.Stat(name); err != nil {
			return fmt.Errorf("required source %q: %w", name, err)
		}
	}
	if err := os.MkdirAll("img/ol-brand", 0o755); err != nil {
		return err
	}

	logo, err := os.ReadFile("logo.svg")
	if err != nil {
		return err
	}
	if err := os.WriteFile("favicon.svg", logo, 0o644); err != nil {
		return err
	}
	if err := generateFaviconVariants("favicon.svg"); err != nil {
		return err
	}

	for _, conversion := range []struct{ input, output, color string }{
		{"logo.svg", "logo_sw.svg", "#000000"},
		{"logo.svg", "mask-favicon.svg", "#000000"},
		{"logo_full.svg", "img/ol-brand/overleaf-black.svg", "#000000"},
		{"logo.svg", "img/ol-brand/overleaf-o-white.svg", "#FFFFFF"},
		{"logo_full.svg", "img/ol-brand/overleaf-white.svg", "#FFFFFF"},
		{"logo.svg", "img/ol-brand/overleaf-o-grey.svg", "#808080"},
	} {
		if err := convertColors(conversion.input, conversion.output, conversion.color); err != nil {
			return err
		}
	}

	for _, spec := range []iconSpec{
		{"android-chrome-512x512.png", 512, 512, false},
		{"android-chrome-192x192.png", 192, 192, false},
		{"apple-touch-icon.png", 180, 180, true},
		{"favicon-16x16.png", 16, 16, false},
		{"favicon-32x32.png", 32, 32, false},
		{"overleaf_og_logo.png", 256, 256, false},
	} {
		if err := renderPNG(logo, spec); err != nil {
			return fmt.Errorf("render %s: %w", spec.Name, err)
		}
	}
	if err := writeICO("favicon.ico", "favicon-32x32.png"); err != nil {
		return err
	}
	if err := renderPNGFromFile("logo_full.svg", "logo-horizontal.png", 410, 180, false); err != nil {
		return err
	}

	for _, copySpec := range []struct{ source, target string }{
		{"overleaf_og_logo.png", "img/ol-brand/overleaf_og_logo.png"},
		{"logo-horizontal.png", "img/ol-brand/logo-horizontal.png"},
		{"logo.svg", "img/ol-brand/overleaf-o.svg"},
		{"logo_full.svg", "img/ol-brand/overleaf.svg"},
		{"logo_full.svg", "img/ol-brand/overleaf-a-ds-solution-mallard.svg"},
		{"logo_full.svg", "img/ol-brand/overleaf-green.svg"},
		{"logo.svg", "img/ol-brand/overleaf-o-dark.svg"},
	} {
		if err := copyFile(copySpec.source, copySpec.target); err != nil {
			return err
		}
	}
	mallard, err := os.ReadFile("img/ol-brand/overleaf-a-ds-solution-mallard.svg")
	if err != nil {
		return err
	}
	dark := strings.NewReplacer("#0000ff", "#FFFFFF", "#0000FF", "#FFFFFF", "#00aa00", "#13C965", "#00AA00", "#13C965").Replace(string(mallard))
	return os.WriteFile("img/ol-brand/overleaf-a-ds-solution-mallard-dark.svg", []byte(dark), 0o644)
}

func convertColors(input, output, target string) error {
	content, err := os.ReadFile(input)
	if err != nil {
		return err
	}
	text := string(content)
	text = attributeColor.ReplaceAllStringFunc(text, func(match string) string {
		parts := attributeColor.FindStringSubmatch(match)
		if strings.EqualFold(parts[2], "#fff") || strings.EqualFold(parts[2], "#ffffff") {
			return match
		}
		return parts[1] + `="` + target + `"`
	})
	text = styleColor.ReplaceAllString(text, `$1:`+target)
	text = colorAttr.ReplaceAllStringFunc(text, func(match string) string {
		parts := colorAttr.FindStringSubmatch(match)
		if strings.EqualFold(parts[1], "#fff") || strings.EqualFold(parts[1], "#ffffff") {
			return match
		}
		return `color="` + target + `"`
	})
	return os.WriteFile(output, []byte(text), 0o644)
}

func generateFaviconVariants(input string) error {
	content, err := os.ReadFile(input)
	if err != nil {
		return err
	}
	width, height, err := dimensions(content)
	if err != nil {
		return err
	}
	size := min(width, height) / 3
	x := width - size - size*0.1
	y := height - size - size*0.1
	variants := map[string]string{
		"favicon-compiled.svg":  fmt.Sprintf(`<circle cx="%g" cy="%g" r="%g" fill="#22c55e"/><path d="M %g %g L %g %g L %g %g" stroke="white" stroke-width="%g" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`, size/2, size/2, size/2, size*.25, size*.5, size*.4, size*.65, size*.75, size*.3, size*.15),
		"favicon-error.svg":     fmt.Sprintf(`<circle cx="%g" cy="%g" r="%g" fill="#ef4444"/><line x1="%g" y1="%g" x2="%g" y2="%g" stroke="white" stroke-width="%g" stroke-linecap="round"/><line x1="%g" y1="%g" x2="%g" y2="%g" stroke="white" stroke-width="%g" stroke-linecap="round"/>`, size/2, size/2, size/2, size*.3, size*.3, size*.7, size*.7, size*.15, size*.7, size*.3, size*.3, size*.7, size*.15),
		"favicon-compiling.svg": fmt.Sprintf(`<circle cx="%g" cy="%g" r="%g" fill="#e5e7eb"/>`, size/2, size/2, size/2),
	}
	for name, overlay := range variants {
		pos := bytes.LastIndex(content, []byte("</svg>"))
		if pos < 0 {
			return errors.New("favicon source has no closing svg tag")
		}
		result := append([]byte{}, content[:pos]...)
		result = fmt.Appendf(result, `<g transform="translate(%g, %g)">%s</g>`, x, y, overlay)
		result = append(result, content[pos:]...)
		if err := os.WriteFile(name, result, 0o644); err != nil {
			return err
		}
	}
	return nil
}

func dimensions(content []byte) (float64, float64, error) {
	var root svgSize
	if err := xml.Unmarshal(content, &root); err != nil {
		return 0, 0, err
	}
	values := viewBoxValue.FindAllString(root.ViewBox, -1)
	if len(values) >= 4 {
		width, _ := strconv.ParseFloat(values[2], 64)
		height, _ := strconv.ParseFloat(values[3], 64)
		return width, height, nil
	}
	return parseLength(root.Width), parseLength(root.Height), nil
}

func parseLength(value string) float64 {
	value = strings.TrimSuffix(value, "px")
	result, _ := strconv.ParseFloat(value, 64)
	return result
}

func renderPNG(content []byte, spec iconSpec) error {
	icon, err := oksvg.ReadIconStream(bytes.NewReader(content))
	if err != nil {
		return err
	}
	return renderIcon(icon, spec.Name, spec.Width, spec.Height, spec.WhiteBackground)
}

func renderPNGFromFile(input, output string, width, height int, white bool) error {
	content, err := os.ReadFile(input)
	if err != nil {
		return err
	}
	icon, err := oksvg.ReadIconStream(bytes.NewReader(content))
	if err != nil {
		return err
	}
	return renderIcon(icon, output, width, height, white)
}

func renderIcon(icon *oksvg.SvgIcon, output string, width, height int, white bool) error {
	imageOut := image.NewRGBA(image.Rect(0, 0, width, height))
	if white {
		for index := range imageOut.Pix {
			imageOut.Pix[index] = 0xff
		}
	}
	icon.SetTarget(0, 0, float64(width), float64(height))
	icon.Draw(rasterx.NewDasher(width, height, rasterx.NewScannerGV(width, height, imageOut, imageOut.Bounds())), 1)
	file, err := os.Create(output)
	if err != nil {
		return err
	}
	defer file.Close()
	return png.Encode(file, imageOut)
}

func writeICO(output, pngName string) error {
	data, err := os.ReadFile(pngName)
	if err != nil {
		return err
	}
	file, err := os.Create(output)
	if err != nil {
		return err
	}
	defer file.Close()
	for _, value := range []uint16{0, 1, 1} {
		if err := binary.Write(file, binary.LittleEndian, value); err != nil {
			return err
		}
	}
	entry := make([]byte, 16)
	entry[0], entry[1] = 32, 32
	binary.LittleEndian.PutUint16(entry[4:6], 1)
	binary.LittleEndian.PutUint16(entry[6:8], 32)
	binary.LittleEndian.PutUint32(entry[8:12], uint32(len(data)))
	binary.LittleEndian.PutUint32(entry[12:16], 22)
	if _, err := file.Write(entry); err != nil {
		return err
	}
	_, err = file.Write(data)
	return err
}

func copyFile(source, target string) error {
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	return os.WriteFile(target, data, 0o644)
}

func min(first, second float64) float64 {
	if first < second {
		return first
	}
	return second
}
