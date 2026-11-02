/**
 * ds-nav Library nav item (host slot: sidebar-ds-nav.tsx →
 * `importOverleafModules('dsNavLibraryLink')`, settings `dsNavLibraryLink`).
 *
 * Captured SaaS behavior: the dashboard ds-nav hosts the Library entry in
 * its lower section, beside the project Trash item; when the user is on
 * the library the host flips the Trash item to `/library/trashed` (its
 * own logic) and passes `active`/`inLibrary` down here.
 *
 * Props match the host contract exactly:
 *   active    — the Library page is the active page (not its trash view)
 *   inLibrary — we are anywhere in the library (library or library-trash)
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import classnames from 'classnames'
import { BookOpenText } from '@phosphor-icons/react'

export default function DsNavLibraryLink({
  active,
  inLibrary,
}: {
  active?: boolean
  inLibrary?: boolean
}) {
  const { t } = useTranslation()
  return (
    <a
      href="/library"
      className={classnames('ds-nav-page-switcher-item', {
        active: active ?? inLibrary,
      })}
      aria-current={active ? 'page' : undefined}
    >
      <BookOpenText size={20} />
      <span className="ds-nav-page-switcher-item-label">{t('Library')}</span>
    </a>
  )
}
