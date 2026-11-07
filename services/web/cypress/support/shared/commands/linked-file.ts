export const interceptLinkedFile = () => {
  cy.intercept(
    { method: 'POST', url: '/project/*/linked_file' },
    cy
      .spy(req => {
        req.reply({ statusCode: 200, body: { success: true } })
      })
      .as('linked-file-request')
  )
}
