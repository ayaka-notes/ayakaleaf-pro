import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookBookmark, CaretDown, Folder, Link as LinkIcon } from '@phosphor-icons/react'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'
import getMeta from '@/utils/meta'
import { getJSON } from '@/infrastructure/fetch-json'
import overleafLogo from '@/shared/svgs/overleaf-a-ds-solution-mallard.svg'
import overleafLogoDark from '@/shared/svgs/overleaf-a-ds-solution-mallard-dark.svg'

type ActivePage = 'library' | 'projects' | 'templates'

type TemplateCategory = { key: string; name: string }

/**
 * New 3 (2026-08-28): the Templates item carries sub-items — all
 * ENABLED template categories (admin-managed: Manage Extensions →
 * Templates; fetched from /api/template/categories). First click
 * expands the sub-list; a second click navigates to /templates.
 */
function useTemplateCategories(enabled: boolean) {
  const [categories, setCategories] = useState<TemplateCategory[]>([])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    void getJSON<TemplateCategory[]>('/api/template/categories')
      .then(cats => {
        if (alive) setCategories(cats || [])
      })
      .catch(() => {
        /* the gallery may be offline/blocked — no sub-items */
      })
    return () => {
      alive = false
    }
  }, [enabled])
  return categories
}

export function DsNavPageSwitcher({
  activePage,
  showLogo = true,
  onLibraryClick,
  onProjectsClick,
}: {
  activePage: ActivePage
  showLogo?: boolean
  onLibraryClick?: React.MouseEventHandler
  onProjectsClick?: React.MouseEventHandler
}) {
  const { t } = useTranslation()
  const appName = getMeta('ol-ExposedSettings')?.appName ?? 'Overleaf'
  const templatesEnabled =
    getMeta('ol-ExposedSettings')?.templatesEnabled ?? false
  const activeOverallTheme = useActiveOverallTheme()
  const categories = useTemplateCategories(
    templatesEnabled && activePage === 'templates'
  )
  const [subOpen, setSubOpen] = useState(false)

  return (
    <>
      {showLogo && (
        <div className="ds-nav-page-switcher-logo">
          <a href="/" aria-label={appName}>
            <img
              src={
                activeOverallTheme === 'dark' ? overleafLogoDark : overleafLogo
              }
              alt="Overleaf, A Digital Science Solution"
              height={59}
              width={130}
            />
          </a>
        </div>
      )}
      <ul
        className={`list-unstyled ds-nav-page-switcher-items${!showLogo ? ' ds-nav-page-switcher-items--no-logo' : ''}`}
      >
        <li>
          <a
            href="/library"
            className={`ds-nav-page-switcher-item${activePage === 'library' ? ' active' : ''}`}
            aria-current={activePage === 'library' ? 'page' : undefined}
            onClick={
              onLibraryClick
                ? e => {
                    e.preventDefault()
                    onLibraryClick(e)
                  }
                : undefined
            }
          >
            <BookBookmark size={24} />
            <span>{t('library')}</span>
          </a>
        </li>
        <li>
          <a
            href="/project"
            className={`ds-nav-page-switcher-item${activePage === 'projects' ? ' active' : ''}`}
            aria-current={activePage === 'projects' ? 'page' : undefined}
            onClick={
              onProjectsClick
                ? e => {
                    e.preventDefault()
                    onProjectsClick(e)
                  }
                : undefined
            }
          >
            <Folder size={24} />
            <span>{t('projects')}</span>
          </a>
        </li>
        {templatesEnabled && (
          <li className="ds-nav-page-switcher-with-sub">
            <a
              href="/templates"
              className={`ds-nav-page-switcher-item${activePage === 'templates' ? ' active' : ''}`}
              aria-current={activePage === 'templates' ? 'page' : undefined}
              aria-expanded={subOpen || undefined}
              onClick={e => {
                // R9 item 4 (2026-08-29) + original intent:
                //  - header CLOSED  → toggle the category sub-menu open (no
                //    navigation, no page reload);
                //  - header OPEN    → close it — a PURE state toggle: no
                //    navigation, no anchor follow, no page reload.
                //    /templates itself is one click away (navigate then the
                //    header stays available for the sub-menu).
                e.preventDefault()
                setSubOpen(!subOpen)
              }}
            >
              <LinkIcon size={24} />
              <span>{t('templates')}</span>
              {categories.length > 0 && (
                <CaretDown
                  size={14}
                  weight="bold"
                  className={`ds-nav-page-switcher-caret${subOpen ? ' is-open' : ''}`}
                />
              )}
            </a>
            {subOpen && categories.length > 0 && (
              <ul className="ds-nav-page-switcher-sub">
                {categories.map(c => (
                  <li key={c.key}>
                    <a
                      href={`/templates/${c.key}`}
                      className="ds-nav-page-switcher-sub-item"
                    >
                      {c.name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )}
      </ul>
    </>
  )
}
