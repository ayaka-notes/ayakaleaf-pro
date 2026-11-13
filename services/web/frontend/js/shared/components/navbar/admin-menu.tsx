import type { DefaultNavbarMetadata } from '@/shared/components/types/default-navbar-metadata'
import NavDropdownMenu from '@/shared/components/navbar/nav-dropdown-menu'
import NavDropdownLinkItem from '@/shared/components/navbar/nav-dropdown-link-item'
import { useSendProjectListMB } from '@/features/project-list/components/project-list-events'

export default function AdminMenu({
  canDisplayAdminMenu,
  canDisplayAdminRedirect,
  canDisplayProjectUrlLookup,
  canDisplaySplitTestMenu,
  canDisplaySurveyMenu,
  canDisplayScriptLogMenu,
  canDisplayStatusMenu,
  adminUrl,
}: Pick<
  DefaultNavbarMetadata,
  | 'canDisplayAdminMenu'
  | 'canDisplayAdminRedirect'
  | 'canDisplayProjectUrlLookup'
  | 'canDisplaySplitTestMenu'
  | 'canDisplaySurveyMenu'
  | 'canDisplayScriptLogMenu'
  | 'canDisplayStatusMenu'
  | 'adminUrl'
>) {
  const sendProjectListMB = useSendProjectListMB()
  return (
    <NavDropdownMenu
      title="Admin"
      className="subdued"
      onToggle={nextShow => {
        if (nextShow) {
          sendProjectListMB('menu-expand', {
            item: 'admin',
            location: 'top-menu',
          })
        }
      }}
    >
      {canDisplayAdminMenu ? (
        <>
          <NavDropdownLinkItem href="/admin">Manage Site</NavDropdownLinkItem>
          <NavDropdownLinkItem href="/admin/user">
            Manage Users
          </NavDropdownLinkItem>
        </>
      ) : null}
      {canDisplayStatusMenu ? (
        <NavDropdownLinkItem href="/admin/status" openInNewWindow>
          Instance Status
        </NavDropdownLinkItem>
      ) : null}
      {canDisplayProjectUrlLookup ? (
        <NavDropdownLinkItem href="/admin/project">
          Project/Object Lookup
        </NavDropdownLinkItem>
      ) : null}
      {canDisplayAdminRedirect && adminUrl ? (
        <NavDropdownLinkItem href={adminUrl}>
          Switch to Admin
        </NavDropdownLinkItem>
      ) : null}
      {canDisplaySplitTestMenu ? (
        <NavDropdownLinkItem href="/admin/split-test">
          Manage Feature Flags
        </NavDropdownLinkItem>
      ) : null}
      {canDisplaySurveyMenu ? (
        <NavDropdownLinkItem href="/admin/survey">
          Manage Surveys
        </NavDropdownLinkItem>
      ) : null}
      {canDisplayScriptLogMenu ? (
        <NavDropdownLinkItem href="/admin/script-logs">
          View Script Logs
        </NavDropdownLinkItem>
      ) : null}
    </NavDropdownMenu>
  )
}
