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
