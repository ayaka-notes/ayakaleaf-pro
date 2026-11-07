import { postWithCsrf } from './request'

// Git access to projects through git-bridge, with the git CLI of the Cypress
// container, the way users clone and push.

// Creates a personal access token for the logged in user, like "Generate
// token" in the account settings.
export function createGitToken(): Cypress.Chainable<string> {
  cy.visit('/user/settings')
  return postWithCsrf('/oauth/personal-access-tokens', {}).then(response => {
    expect(response.status).to.equal(200)
    return response.body.accessToken as string
  })
}

export function gitUrl(projectId: string, token: string) {
  return `http://git:${token}@sharelatex/git/${projectId}`
}

// Runs git in a fresh working copy folder, never failing the test by itself.
export function git(command: string) {
  return cy.exec(
    `export GIT_TERMINAL_PROMPT=0 HOME=/tmp/git-home && ${command}`,
    { failOnNonZeroExit: false, timeout: 60_000 }
  )
}

// A run-unique folder for a working copy
export function workingCopy(name: string) {
  return `/tmp/git-e2e/${name}-${Date.now()}`
}

export function gitClone(projectId: string, token: string, dir: string) {
  return git(`rm -rf ${dir} && git clone ${gitUrl(projectId, token)} ${dir}`)
}

// Commits every change in the working copy and pushes.
export function gitCommitAllAndPush(dir: string, message: string) {
  return git(
    `cd ${dir} && git add -A && ` +
      `git -c user.name=e2e -c user.email=e2e@example.com commit -q -m '${message}' && ` +
      'git push'
  )
}

// Writes a file, creating its folder, commits it and pushes.
export function gitCommitAndPush(
  dir: string,
  file: string,
  content: string,
  message: string
) {
  git(
    `cd ${dir} && mkdir -p $(dirname ${file}) && printf '%s' '${content.replaceAll("'", "'\\''")}' > ${file}`
  )
  return gitCommitAllAndPush(dir, message)
}
