/**
 * /library root (page auto-entry; template-gallery precedent).
 *
 * Chrome: SAME design-system layout as /project (LIBRARY_PLAN D-C4 /
 * SaaS capture): compact DefaultNavbar on top, left sidebar with the
 * library/projects/templates page switcher and the shared lower section
 * (theme toggle + account), footer + cookie banner. The page content is
 * my Library app inside `project-ds-nav-main` so the core DS stylesheets
 * (main-style.css) position it exactly like the project list.
 *
 * Provider split (like project-list-root): the chrome's theme hooks
 * (`useActiveOverallTheme` → SplitTest + UserSettings contexts) run in
 * `LibraryChrome`, INSIDE the provider elements.
 *
 * The context owns the Library/Trash view state (client-side switch);
 * the initial view comes from the `ol-libraryView` meta tag set by the
 * page routes (libraryPage → 'library', libraryTrashPage → 'trash').
 */
import React from 'react'
import CookieBanner from '@/shared/components/cookie-banner'
import DefaultNavbar from '@/shared/components/navbar/default-navbar'
import { DsNavPageSwitcher } from '../../../deps/ce-ui/js/ds-nav-page-switcher'
import { SidebarLowerSection } from '@/shared/components/sidebar/sidebar-lower-section'
import SystemMessages from '@/shared/components/system-messages'
import { SplitTestProvider } from '@/shared/context/split-test-context'
import { UserSettingsProvider } from '@/shared/context/user-settings-context'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'
import useThemedPage from '@/shared/hooks/use-themed-page'
import getMeta from '@/utils/meta'
import overleafLogo from '@/shared/svgs/overleaf-a-ds-solution-mallard.svg'
import overleafLogoDark from '@/shared/svgs/overleaf-a-ds-solution-mallard-dark.svg'
import { LibraryProvider } from './library-context'
import type { LibraryView } from './library-context'
import LibraryPage from './library-page'

function initialView(): LibraryView {
  if (typeof document === 'undefined') return 'library'
  const meta = document.querySelector('meta[name="ol-libraryView"]')
  return meta?.getAttribute('content') === 'trash' ? 'trash' : 'library'
}

function LibraryChrome({ initialView }: { initialView: LibraryView }) {
  const activeOverallTheme = useActiveOverallTheme()
  // Apply THE user's overall theme to the page (project list & IDE do the
  // same; without this the page falls back to the server default instead
  // of following the Dark/Light/System setting).
  useThemedPage()
  const navbarProps = getMeta('ol-navbar')

  return (
    <div className="project-ds-nav-page website-redesign library-enabled">
      <SystemMessages />
      <DefaultNavbar
        {...navbarProps}
        overleafLogo={
          activeOverallTheme === 'dark' ? overleafLogoDark : overleafLogo
        }
        showCloseIcon
      />
      <div className="project-list-wrapper">
        <div className="project-list-sidebar-wrapper-react d-none d-md-flex">
          <DsNavPageSwitcher activePage="library" showLogo={false} />
          <hr className="ds-nav-page-switcher-divider" />
          {/* Spacer pushes the lower section (account + brand) to the
              bottom, exactly like the /project sidebar (SidebarDsNav). */}
          <nav className="flex-grow flex-shrink" aria-hidden="true" />
          <div className="ds-nav-sidebar-lower">
            <SidebarLowerSection showThemeToggle />
          </div>
        </div>
        <div className="project-ds-nav-content-and-messages">
          <div className="project-ds-nav-content">
            <div className="project-ds-nav-main">
              <main aria-labelledby="main-content">
                <LibraryProvider initialView={initialView}>
                  <LibraryPage />
                </LibraryProvider>
              </main>
            </div>
          </div>
          <CookieBanner />
        </div>
      </div>
    </div>
  )
}

export default function LibraryRoot() {
  // The meta tag is static per page load; read it once.
  const view = React.useMemo(() => initialView(), [])
  return (
    <SplitTestProvider>
      <UserSettingsProvider>
        <LibraryChrome initialView={view} />
      </UserSettingsProvider>
    </SplitTestProvider>
  )
}
