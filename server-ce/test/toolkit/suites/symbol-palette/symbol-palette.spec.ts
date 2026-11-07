import { login } from '../../../helpers/login'
import {
  createProject,
  openProject,
  projectName,
} from '../../../helpers/project'
import { ADMIN_EMAIL, ensureAdminExists } from '../../../helpers/users'

const alpha = 'Lowercase Greek letter alpha'
const beta = 'Lowercase Greek letter beta'

// Insert > Symbol toggles the palette. The compact editor toolbar can move
// its own symbol button into overflow, the menu is always there.
function togglePalette() {
  cy.findByRole('button', { name: 'Insert', exact: true }).click()
  cy.findByRole('menuitem', { name: 'Symbol', exact: true }).click()
}

function palette() {
  return cy.get('.symbol-palette-container')
}

function openPalette() {
  togglePalette()
  palette().should('be.visible')
  cy.findByRole('searchbox', { name: 'Search' }).should('be.focused')
}

function categoryTab(name: string) {
  return cy
    .findByRole('tablist', { name: 'Symbol Categories' })
    .findByRole('tab', { name })
}

function searchSymbols(query: string) {
  cy.findByRole('searchbox', { name: 'Search' }).clear().type(query)
}

type Point = [number, number]

function drawToggle() {
  return cy.findByRole('button', { name: 'Draw a symbol' })
}

function canvas() {
  return cy.get('canvas.symbol-palette-draw-canvas')
}

function results() {
  return cy.findByRole('listbox', { name: 'Recognised symbols' })
}

// The model loads once per palette; recognition only starts after that.
function openDrawMode() {
  openPalette()
  drawToggle().click()
  canvas().should('be.visible')
  cy.findByText('Loading model…', { timeout: 60_000 }).should('not.exist')
  cy.findByText('Recognition unavailable').should('not.exist')
}

// Draws strokes given in fractions of the canvas, like a pen would.
function draw(strokes: Point[][]) {
  canvas().then($canvas => {
    const { width, height } = $canvas[0].getBoundingClientRect()
    for (const stroke of strokes) {
      const [first, ...rest] = stroke.map(
        ([x, y]) => [x * width, y * height] as Point
      )
      const options = { pointerId: 1, button: 0, buttons: 1, force: true }
      canvas().trigger('pointerdown', ...first, options)
      for (const point of rest) {
        canvas().trigger('pointermove', ...point, options)
      }
      canvas().trigger('pointerup', ...(rest.at(-1) ?? first), {
        ...options,
        buttons: 0,
      })
    }
  })
}

function circle(cx: number, cy: number, r: number): Point[] {
  return Array.from({ length: 33 }, (_, i) => {
    const angle = (i / 32) * 2 * Math.PI
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]
  })
}

function line(from: Point, to: Point): Point[] {
  return Array.from({ length: 11 }, (_, i) => [
    from[0] + ((to[0] - from[0]) * i) / 10,
    from[1] + ((to[1] - from[1]) * i) / 10,
  ])
}

// The figure eight on its side
function infinity(): Point[] {
  return Array.from({ length: 49 }, (_, i) => {
    const t = (i / 48) * 2 * Math.PI
    const scale = 0.35 / (1 + Math.sin(t) ** 2)
    return [0.5 + scale * Math.cos(t), 0.5 + scale * Math.sin(t) * Math.cos(t)]
  })
}

before(function () {
  ensureAdminExists()
})

describe('symbol palette', function () {
  beforeEach(function () {
    login(ADMIN_EMAIL)
    createProject(projectName('Symbols')).then(openProject)
  })

  for (const { kind, query } of [
    { kind: 'LaTeX command', query: '\\alpha' },
    { kind: 'description', query: 'lowercase greek letter alpha' },
    { kind: 'character alias', query: 'α' },
  ]) {
    it(`searches symbols by ${kind}`, function () {
      openPalette()
      searchSymbols(query)
      // Search is debounced; retry the rendered results rather than sleep.
      cy.findByRole('listbox', { name: 'Symbols' }).within(() => {
        cy.findByRole('option', { name: alpha }).should('be.visible')
        cy.findByRole('option', { name: beta }).should('not.exist')
      })
    })
  }

  it('shows no results for an unknown symbol and restores symbols when cleared', function () {
    openPalette()
    searchSymbols('no-such-symbol-e2e')
    cy.findByText('No symbols found').should('be.visible')
    cy.findByRole('listbox', { name: 'Symbols' }).should('not.exist')

    cy.findByRole('searchbox', { name: 'Search' }).clear()
    cy.findByText('No symbols found').should('not.exist')
    cy.findByRole('option', { name: alpha }).should('be.visible')
    cy.findByRole('option', { name: beta }).should('be.visible')
  })

  it('inserts clicked symbols at the editor cursor and advances it', function () {
    const marker = '% symbol palette: '
    cy.findByText('\\maketitle').parent().type(`{end}\n${marker}`)
    openPalette()

    searchSymbols('\\alpha')
    cy.findByRole('option', { name: beta }).should('not.exist')
    cy.findByRole('option', { name: alpha }).click()
    cy.get('.cm-content')
      .should('contain.text', `${marker}\\alpha`)
      .and('be.focused')

    // Clicking a symbol keeps the palette open; searching must preserve the
    // editor selection so the next symbol follows the first one.
    searchSymbols('\\beta')
    cy.findByRole('option', { name: alpha }).should('not.exist')
    cy.findByRole('option', { name: beta }).click()
    cy.get('.cm-content')
      .should('contain.text', `${marker}\\alpha\\beta`)
      .and('be.focused')
  })

  it('opens and closes from the Insert menu, the close button and Escape', function () {
    openPalette()
    togglePalette()
    palette().should('not.exist')

    openPalette()
    palette().findByRole('button', { name: 'Close' }).click()
    palette().should('not.exist')
    cy.get('.cm-content').should('be.focused')

    openPalette()
    cy.findByRole('option', { name: alpha }).focus().type('{esc}')
    palette().should('not.exist')
    cy.get('.cm-content').should('be.focused')
  })

  it('switches between the symbol categories', function () {
    openPalette()
    categoryTab('Greek').should('have.attr', 'aria-selected', 'true')
    cy.findByRole('option', { name: alpha }).should('be.visible')

    for (const { category, symbol } of [
      { category: 'Arrows', symbol: 'Rightward arrow' },
      { category: 'Operators', symbol: 'Division' },
      { category: 'Relations', symbol: 'Not equal' },
      { category: 'Misc', symbol: 'Infinity' },
    ]) {
      categoryTab(category).click()
      categoryTab(category).should('have.attr', 'aria-selected', 'true')
      categoryTab('Greek').should('have.attr', 'aria-selected', 'false')
      cy.findByRole('tabpanel', { name: category }).within(() => {
        cy.findByRole('option', { name: symbol }).should('be.visible')
      })
      cy.findByRole('option', { name: alpha }).should('not.exist')
    }
  })

  it('moves between categories with the arrow, Home and End keys', function () {
    openPalette()
    categoryTab('Greek').click().type('{rightarrow}')
    categoryTab('Arrows')
      .should('have.attr', 'aria-selected', 'true')
      .and('be.focused')
      .type('{end}')
    categoryTab('Misc')
      .should('have.attr', 'aria-selected', 'true')
      .and('be.focused')
      .type('{rightarrow}')
    // Wraps around at both ends
    categoryTab('Greek')
      .should('have.attr', 'aria-selected', 'true')
      .type('{leftarrow}')
    categoryTab('Misc')
      .should('have.attr', 'aria-selected', 'true')
      .type('{home}')
    categoryTab('Greek').should('have.attr', 'aria-selected', 'true')
    cy.findByRole('option', { name: alpha }).should('be.visible')
  })

  it('searches across all categories and returns to the open one when cleared', function () {
    openPalette()
    categoryTab('Arrows').click()
    searchSymbols('\\alpha')
    cy.findByRole('option', { name: alpha }).should('be.visible')
    cy.findByRole('option', { name: 'Rightward arrow' }).should('not.exist')

    cy.findByRole('searchbox', { name: 'Search' }).clear()
    categoryTab('Arrows').should('have.attr', 'aria-selected', 'true')
    cy.findByRole('option', { name: 'Rightward arrow' }).should('be.visible')
    cy.findByRole('option', { name: alpha }).should('not.exist')
  })

  it('picks a symbol with the keyboard and closes the palette', function () {
    const marker = '% keyboard: '
    cy.findByText('\\maketitle').parent().type(`{end}\n${marker}`)
    openPalette()

    // The first symbol takes the focus, the arrow keys move it along
    cy.findByRole('option', { name: alpha })
      .should('have.attr', 'aria-selected', 'true')
      .focus()
      .type('{rightarrow}')
    cy.findByRole('option', { name: beta })
      .should('be.focused')
      .and('have.attr', 'aria-selected', 'true')
      .type('{leftarrow}')
    cy.findByRole('option', { name: alpha })
      .should('be.focused')
      .type('{rightarrow}')
    cy.findByRole('option', { name: beta }).should('be.focused').type('{enter}')

    palette().should('not.exist')
    cy.get('.cm-content')
      .should('contain.text', `${marker}\\beta`)
      .and('be.focused')
  })

  it('shows the command of a symbol on hover', function () {
    openPalette()
    cy.findByRole('option', { name: alpha }).trigger('mouseover')
    cy.findByRole('tooltip').within(() => {
      cy.findByText(alpha)
      cy.findByText('\\alpha')
    })
  })
})

describe('symbol palette draw mode', function () {
  beforeEach(function () {
    login(ADMIN_EMAIL)
    createProject(projectName('Draw')).then(openProject)
  })

  it('switches between the symbols and the canvas', function () {
    openPalette()
    drawToggle().should('have.attr', 'aria-pressed', 'false').click()
    drawToggle().should('have.attr', 'aria-pressed', 'true')
    canvas().should('be.visible')
    cy.findByText(
      'Draw a symbol in the box on the right, then choose the matching command from the results shown here.'
    )
    cy.findByRole('button', { name: 'Clear' }).should('be.disabled')
    // The categories do not apply to drawing
    cy.findByRole('tablist', { name: 'Symbol Categories' })
      .findAllByRole('tab')
      .each(tab => cy.wrap(tab).should('be.disabled'))
    cy.findByRole('option', { name: alpha }).should('not.exist')

    drawToggle().click()
    drawToggle().should('have.attr', 'aria-pressed', 'false')
    canvas().should('not.exist')
    cy.findByRole('option', { name: alpha }).should('be.visible')
  })

  it('leaves draw mode when the search box takes the focus', function () {
    openPalette()
    drawToggle().click()
    canvas().should('be.visible')
    cy.findByRole('searchbox', { name: 'Search' }).focus()
    canvas().should('not.exist')
    drawToggle().should('have.attr', 'aria-pressed', 'false')
    cy.findByRole('option', { name: alpha }).should('be.visible')
  })

  // Results are labelled with the description of the symbol
  for (const { name, strokes, labels } of [
    {
      name: 'the empty set',
      strokes: [circle(0.5, 0.5, 0.3), line([0.25, 0.85], [0.75, 0.15])],
      labels: ['Empty set', 'Diameter sign'],
    },
    {
      name: 'a cross as times',
      strokes: [line([0.3, 0.3], [0.7, 0.7]), line([0.7, 0.3], [0.3, 0.7])],
      labels: ['Cross product, multiplication'],
    },
  ]) {
    it(`recognises ${name}`, function () {
      openDrawMode()
      draw(strokes)
      results()
        .findAllByRole('option')
        .should('have.length.within', 1, 10)
        .then($options => {
          const found = [...$options].map(o => o.getAttribute('aria-label'))
          expect(found, 'recognised symbols').to.satisfy((list: string[]) =>
            list.some(label => labels.includes(label))
          )
        })
    })
  }

  it('recognises infinity and inserts it at the editor cursor', function () {
    const marker = '% drawn: '
    cy.findByText('\\maketitle').parent().type(`{end}\n${marker}`)
    openDrawMode()
    draw([infinity()])
    results().findByRole('option', { name: 'Infinity' }).click()
    cy.get('.cm-content').should('contain.text', `${marker}\\infty`)
  })

  it('clears the canvas and its results', function () {
    openDrawMode()
    draw([infinity()])
    results().findAllByRole('option').should('have.length.at.least', 1)
    cy.findByRole('button', { name: 'Clear' }).should('be.enabled').click()
    results().should('not.exist')
    cy.findByText(/Draw a symbol in the box on the right/)
    cy.findByRole('button', { name: 'Clear' }).should('be.disabled')
  })
})
