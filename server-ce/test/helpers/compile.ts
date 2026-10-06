export function stopCompile(options: { delay?: number } = {}) {
  const { delay = 0 } = options
  cy.wait(delay)
  cy.log('Stop compile')
  cy.findByRole('button', { name: 'Toggle compile options menu' }).click()
  cy.findByRole('menuitem', { name: 'Stop compilation' })
    .should('not.have.class', 'disabled')
    .and('not.have.attr', 'aria-disabled', 'true')
    .click()
}

/**
 * Throttles compiles to stay below the server side compile rate limit, and
 * waits until a triggered compile has finished.
 */
export function prepareWaitForNextCompileSlot() {
  let lastCompile = 0
  function queueReset() {
    cy.then(() => {
      lastCompile = Date.now()
    })
  }
  function waitForCompileRateLimitCoolOff() {
    cy.then(() => {
      cy.log('Wait for recompile rate-limit to cool off')
      const msSinceLastCompile = Date.now() - lastCompile
      // The server allows one compile per second, counted from when the
      // request arrives, which is later than our timestamp. Keep a margin.
      cy.wait(Math.max(0, 2_000 - msSinceLastCompile))
      queueReset()
    })
  }
  function waitForCompile(triggerCompile: () => void) {
    waitForCompileRateLimitCoolOff()
    cy.then(() => {
      let compilingVisible: () => void
      const waitForCompilingVisible = new Promise<void>(resolve => {
        compilingVisible = resolve
      })
      cy.intercept(
        {
          method: 'POST',
          pathname: /\/project\/[a-fA-F0-9]{24}\/compile$/,
          times: 1,
        },
        async req => {
          await waitForCompilingVisible
          req.continue()
        }
      ).as('recompile')
      triggerCompile()
      cy.log('Wait for compile to finish')
      cy.findByRole('button', { name: 'Compiling…' }).then(() =>
        compilingVisible()
      )
      cy.wait('@recompile')
      cy.findByRole('button', { name: 'Compiling…' }).should('not.exist')
      cy.findByRole('button', { name: 'Recompile' }).should('be.visible')
    })
  }
  function recompile() {
    waitForCompile(() => {
      cy.findByRole('button', { name: 'Recompile' }).click()
    })
  }
  return {
    waitForCompileRateLimitCoolOff,
    waitForCompile,
    recompile,
  }
}
