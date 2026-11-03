document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('active-projects-container')
  const tabLink = document.querySelector('a[href="#active-projects"]')
  const tabPane = document.getElementById('active-projects')

  if (!container || !tabPane) return

  let isLoaded = false
  let isLoading = false

  function loadActiveProjects() {
    if (isLoaded || isLoading) return

    isLoading = true

    // show loading only if tab is visible
    if (tabPane.classList.contains('active')) {
      container.innerHTML = '<p class="text-muted">Loading...</p>'
    }

    fetch('/admin/active-projects')
      .then(res => res.json())
      .then(data => {
        container.innerHTML = renderTable(data)
        isLoaded = true
      })
      .catch(() => {
        container.innerHTML =
          '<p class="text-danger">Failed to load active projects</p>'
      })
      .finally(() => {
        isLoading = false
      })
  }

  // preload immediately when /admin page opens
  loadActiveProjects()

  // ensure data is loaded when tab is opened
  if (tabLink) {
    tabLink.addEventListener('shown.bs.tab', () => {
      if (!isLoaded) loadActiveProjects()
    })
  }
})

function renderTable(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return `
      <div class="alert alert-success">
        <span style="color: green;">✔</span>
        <strong> Great news!</strong>
        No projects are currently being edited.
      </div>
    `
  }

  const rows = data.map((project, projectIndex) => {
    const users = project.activeUsers || []

    const mailto = users
      .map(u => u.email)
      .filter(Boolean)
      .join(',')

    const projectName = mailto
      ? `<a href="mailto:${mailto}" style="text-decoration:none;">${project.name}</a>`
      : project.name

    const stripedStyle = projectIndex % 2 === 1
      ? 'background-color: var(--bs-table-striped-bg);'
      : ''

    const usersHtml = users.length
      ? users.map(user => `
          <div>
            ${
              user.email
                ? `<a href="mailto:${user.email}" style="text-decoration:none;">${user.name}</a>`
                : user.name
            }
          </div>
        `).join('')
      : '<em>None detected</em>'

    return `
      <div style="
        display:grid;
        grid-template-columns:70% 30%;
        column-gap:1rem;
        ${stripedStyle}
        padding:0.5rem 0;
      ">
        <div style="background:inherit;">
          ${projectName}
        </div>
        <div style="background:inherit;">
          ${usersHtml}
        </div>
      </div>
    `
  }).join('')

  return `
    <p class="small">
      <strong>${data.length}</strong> project(s) currently being edited
    </p>

    <div style="
      display:grid;
      grid-template-columns:70% 30%;
      column-gap:1rem;
      font-weight:bold;
      padding-bottom:0.5rem;
      border-bottom:1px solid var(--bs-border-color);
    ">
      <div>Project Name</div>
      <div>Active User</div>
    </div>

    ${rows}
  `
}
