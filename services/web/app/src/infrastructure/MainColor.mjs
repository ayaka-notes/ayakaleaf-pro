const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function normalizeMainColor(value) {
  if (typeof value !== 'string') {
    return null
  }

  const color = value.trim()
  if (!HEX_COLOR_REGEX.test(color)) {
    return null
  }

  if (color.length === 4) {
    const [, red, green, blue] = color
    return `#${red}${red}${green}${green}${blue}${blue}`.toLowerCase()
  }

  return color.toLowerCase()
}

export function buildMainColorCss(value) {
  const mainColor = normalizeMainColor(value)
  if (!mainColor) {
    return null
  }

  const palette = buildPalette(mainColor)

  return `:root {
  --ol-main-color: ${mainColor};
  --green-10: ${palette[10]};
  --green-20: ${palette[20]};
  --green-30: ${palette[30]};
  --green-40: ${palette[40]};
  --green-50: ${palette[50]};
  --green-60: ${palette[60]};
  --green-70: ${palette[70]};
  --green-bright: ${palette[50]};
  --green-bright-tint-50: ${palette.brightTint50};
  --bg-accent-01: var(--green-50);
  --bg-accent-02: var(--green-60);
  --bg-accent-03: var(--green-10);
  --content-positive: var(--green-50);
  --content-positive-dark: var(--green-40);
  --link-web: var(--green-60);
  --link-web-hover: var(--green-70);
  --link-web-visited: var(--green-60);
  --link-web-dark: var(--green-30);
  --link-web-hover-dark: var(--green-40);
  --link-web-visited-dark: var(--green-40);
}`
}

function buildPalette(mainColor) {
  return {
    10: mix(mainColor, '#ffffff', 0.1),
    20: mix(mainColor, '#ffffff', 0.3),
    30: mix(mainColor, '#ffffff', 0.5),
    40: mix(mainColor, '#ffffff', 0.7),
    50: mainColor,
    60: mix(mainColor, '#000000', 0.82),
    70: mix(mainColor, '#000000', 0.66),
    brightTint50: mix(mainColor, '#ffffff', 0.5),
  }
}

function mix(color, backgroundColor, weight) {
  const rgb = hexToRgb(color)
  const backgroundRgb = hexToRgb(backgroundColor)

  return rgbToHex({
    red: mixChannel(rgb.red, backgroundRgb.red, weight),
    green: mixChannel(rgb.green, backgroundRgb.green, weight),
    blue: mixChannel(rgb.blue, backgroundRgb.blue, weight),
  })
}

function mixChannel(value, backgroundValue, weight) {
  return Math.round(value * weight + backgroundValue * (1 - weight))
}

function hexToRgb(color) {
  const value = color.slice(1)

  return {
    red: parseInt(value.slice(0, 2), 16),
    green: parseInt(value.slice(2, 4), 16),
    blue: parseInt(value.slice(4, 6), 16),
  }
}

function rgbToHex({ red, green, blue }) {
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
}

function toHex(value) {
  return value.toString(16).padStart(2, '0')
}
