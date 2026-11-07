export const interceptFileUpload = () => {
  cy.intercept(
    { method: 'POST', url: /\/project\/.*\/upload/ },
    cy
      .spy(req => {
        const folderMatch = req.url.match(
          /project\/.*\/upload\?folder_id=[a-f0-9]{24}/
        )
        if (folderMatch) {
          req.reply({ statusCode: 200, body: { success: true } })
        } else {
          req.reply({ statusCode: 500, body: { success: false } })
        }
      })
      .as('uploadRequest')
  )
}
