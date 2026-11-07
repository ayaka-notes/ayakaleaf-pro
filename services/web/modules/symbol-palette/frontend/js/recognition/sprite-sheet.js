import metadata from './assets/sprites.json'
import atlasUrl from './assets/sprites.png'

const spriteSheet = {
  atlasUrl,
  columns: metadata.columns,
  rows: Math.ceil(metadata.commands.length / metadata.columns),
  index: new Map(metadata.commands.map((command, index) => [command, index])),
}

spriteSheet.getStyle = command => {
  const index = spriteSheet.index.get(command)
  if (index === undefined) return null
  const image = `url("${spriteSheet.atlasUrl}")`
  const size = `${spriteSheet.columns * 32}px ${spriteSheet.rows * 32}px`
  const position = `-${(index % spriteSheet.columns) * 32}px -${Math.floor(index / spriteSheet.columns) * 32}px`
  return {
    display: 'inline-block',
    width: 32,
    height: 32,
    backgroundColor: 'currentColor',
    maskImage: image,
    maskRepeat: 'no-repeat',
    maskSize: size,
    maskPosition: position,
    maskMode: 'alpha',
    WebkitMaskImage: image,
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskSize: size,
    WebkitMaskPosition: position,
  }
}

export default spriteSheet
