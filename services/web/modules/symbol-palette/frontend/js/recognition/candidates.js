import symbols from '../data/symbols.json'
import config from './model-config.json'

const knownSymbols = new Map(symbols.map(symbol => [symbol.command, symbol]))

export function toPaletteSymbols(candidates) {
  return candidates
    .filter(
      candidate =>
        !config.excludedPackages.includes(candidate.package) &&
        !candidate.command.startsWith('\\text')
    )
    .slice(0, config.resultCount)
    // Results are drawn from the sprite sheet, so they need no character
    .map(
      candidate =>
        knownSymbols.get(candidate.command) || {
          codepoint: '',
          command: candidate.command,
          description: candidate.command,
          character: '',
          notes: candidate.package
            ? `\\usepackage{${candidate.package}}`
            : undefined,
        }
    )
}
