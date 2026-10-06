// The /docs endpoint of the open-in-overleaf module, submitted the way an
// external site does: a plain form, no CSRF token, no redirects followed.

export type Params = Record<string, string | string[]>

// Form encoded like a browser does, arrays as name[]=a&name[]=b
export function formBody(params: Params) {
  const form = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) form.append(`${name}[]`, item)
    } else {
      form.append(name, value)
    }
  }
  return form.toString()
}

export function submitDocs(params: Params, method: 'GET' | 'POST' = 'POST') {
  const body = formBody(params)
  return cy.request({
    method,
    url: method === 'GET' ? `/docs?${body}` : '/docs',
    body: method === 'POST' ? body : undefined,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    failOnStatusCode: false,
    followRedirect: false,
  })
}

// Submits and returns the id of the project it redirects to
export function openInOverleaf(
  params: Params,
  method: 'GET' | 'POST' = 'POST'
): Cypress.Chainable<string> {
  return submitDocs(params, method).then(response => {
    expect(response.status).to.equal(302)
    const match = /^\/project\/([0-9a-f]{24})$/.exec(
      response.redirectedToUrl!.replace(Cypress.config('baseUrl')!, '')
    )
    expect(match, response.redirectedToUrl).to.not.equal(null)
    return match![1]
  })
}

export function dataUrl(mime: string, content: string) {
  return `data:${mime};base64,${btoa(content)}`
}
