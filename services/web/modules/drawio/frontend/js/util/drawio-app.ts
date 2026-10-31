/**
 * Overleaf host constraints for the vendored draw.io app (AK-11 follow-up,
 * owner 2026-10-13: "New, Open from, Open Recent, Save As, Share, Rename,
 * Make Copy are contradicting that this is an editor for the file that this
 * was opened for. These need to go. Save is only allowed to save into the
 * overleaf file tree with the pre-created file.").
 *
 * The vendored app (public/static/drawio, PROVENANCE.txt) is a standalone
 * product: its File menu manages draw.io's own files (device downloads,
 * share links, libraries, external providers). None of that storage exists
 * in this deployment — the diagram lives in the Overleaf document that
 * opened the editor, and the VIEWER (drawio-viewer.tsx) keeps that document
 * in sync (autosave) and turns File>Save / Ctrl+S into a sync flush.
 *
 * This module enforces that in the (same-origin) app window:
 *
 *   - the share button, the "Change User" avatar and the multi-page tab bar
 *     are removed; the "Unsaved changes. Click here to save." alert is
 *     replaced by the autosave status text — the change IS already saved
 *     into the Overleaf document;
 *   - File-menu rows that would leave the embedded editor (new/open/save as/
 *     share/rename/make a copy/import/export/embed/publish/libraries/
 *     properties/page setup/print/close) are stripped from rendered menus
 *     AND their clicks are intercepted in the capture phase;
 *   - "Save" (row or Ctrl/Cmd+S) is intercepted in the capture phase and
 *     re-routed to onFlushSave() — the viewer pulls the app's current state
 *     into the Overleaf document; normal Overleaf autosave persists it.
 *
 * The pure helpers (normalizeMenuLabel / isBlockedFileMenuLabel) are
 * DOM-free so they run in the unit test environment.
 */

import { parseDrawioFile } from './drawio-protocol'

/** Labels that appear in the app's File menu but have no place here. */
export const BLOCKED_FILE_MENU_LABELS: ReadonlySet<string> = new Set([
  'new',
  'open',
  'open from',
  'open recent',
  'save as',
  'share',
  'rename',
  'make a copy',
  'import from',
  'export as',
  'embed',
  'publish',
  'new library',
  'open library from',
  'edit library',
  'save library',
  'properties',
  'page setup',
  'print',
  'close',
  'exit',
  // View → "Page Tabs" would re-open the removed multi-page bar (single
  // page only: one .drawio file exports as one svg/pdf/png).
  'page tabs',
  // Extras → "Plugins..." loads remote code into the session (blocked at
  // boot via plugins=0 as well; the row is stripped for good measure).
  'plugins',
])

/** "Make a Copy..." / "Save as…" / "Save As" → "make a copy" / "save as". */
export function normalizeMenuLabel (raw: string): string {
  return raw
    .replace(/\.{3,}|…/g, '') // trailing (or long) ellipsis
    .replace(/\s*\.{1,2}$/g, '') // short trailing dots
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function isBlockedFileMenuLabel (raw: string): boolean {
  const label = normalizeMenuLabel(raw)
  return label.length > 0 && BLOCKED_FILE_MENU_LABELS.has(label)
}

export interface HostAppConstraints {
  /** Text for the "unsaved changes" alert replacement (already translated). */
  savedText: string
  /** Called when the app's own Save (menu row or Ctrl/Cmd+S) is triggered. */
  onFlushSave: () => void
}

function relevantNode (node: Node): boolean {
  if (node.nodeType !== 1) return false
  const el = node as Element
  const cls = String(el.className ?? el.tagName ?? '').toLowerCase()
  return (
    cls.includes('gestatusalert') ||
    cls.includes('gebuttoncontainer') ||
    cls.includes('getabcontainer') ||
    cls.includes('mxpopupmenu') ||
    (el.tagName === 'BUTTON' &&
      String(el.getAttribute('title') ?? '').toLowerCase() === 'share') ||
    (el.tagName === 'A' &&
      String(el.getAttribute('title') ?? '').toLowerCase() === 'change user')
  )
}

/**
 * Enforce the embedded-editor constraints inside the app window.
 * Idempotent (guarded flag). Installs capture-phase click/keydown
 * interceptors plus a MutationObserver that re-applies the DOM removals
 * whenever the app re-renders one of the relevant nodes.
 */
export function applyOverleafHostConstraints (
  win: Window & {
    MutationObserver?: new (cb: (m: { type: string; attributeName?: string; addedNodes: { [i: number]: Node } }) => void) => {
      observe: (target: Node, options: unknown) => void
      disconnect: () => void
    }
  },
  opts: HostAppConstraints,
): void {
  const doc = win.document
  if (!doc || (doc as Record<string, unknown>).__overleafDrawioConstraints) {
    return
  }
  ;(doc as Record<string, unknown>).__overleafDrawioConstraints = true

  const strip = (): void => {
    // (owner 2026-10-13 round 2: "remove the File menu item completely")
    // The standalone app's File menu has no legitimate target here — the
    // Overleaf file in the tree IS the diagram and autosave handles it.
    doc.querySelectorAll('.geMenubar > *').forEach(el => {
      if (String(el.textContent ?? '').trim().toLowerCase() === 'file') {
        el.remove()
      }
    })
    // (owner: "the share should not be there") — menubar + any dialog copy
    doc
      .querySelectorAll('button[title="Share"], a[title="Share"]')
      .forEach(el => el.remove())
    doc
      .querySelectorAll('a[title="Change User"]')
      .forEach(el => {
        ;(el as HTMLElement).style.display = 'none'
      })
    // multi-page bar: a .drawio here exports as ONE svg/pdf/png — pages
    // would silently drop content; single page only (owner follow-up)
    doc
      .querySelectorAll('.geTabContainer')
      .forEach(el => {
        ;(el as HTMLElement).style.display = 'none'
      })
    // "Unsaved changes. Click here to save." — the change is already
    // autosaved into the Overleaf document: replace the invitation.
    doc.querySelectorAll('div.geStatusAlert').forEach(el => {
      const text = (el as HTMLElement).textContent ?? ''
      if (/(^|\s)unsaved changes/i.test(text)) {
        ;(el as HTMLElement).textContent = opts.savedText
        ;(el as HTMLElement).title = opts.savedText
        el.removeAttribute('data-action')
        el.querySelectorAll('img').forEach(img => img.remove())
      }
    })
    // any currently open File menu: strip the blocked rows
    doc.querySelectorAll('table.mxPopupMenu tr.mxPopupMenuItem').forEach(row => {
      const cells = row.querySelectorAll('td')
      if (cells.length < 2) return
      const label = (cells.item(1)?.textContent ?? '').trim()
      if (isBlockedFileMenuLabel(label)) row.remove()
    })
  }

  // Capture-phase click interception. The app registers its handlers in the
  // bubble phase, so this runs first:
  //  - "Save" row  → flush the sync into the Overleaf document
  //  - blocked row → drop the event (no dialog, no external call)
  doc.addEventListener(
    'click',
    (event: Event) => {
      const target = event.target as Element | null
      if (!target || typeof target.closest !== 'function') return

      const row = target.closest('tr.mxPopupMenuItem')
      if (row) {
        const cells = row.querySelectorAll('td')
        const label = (cells.item(1)?.textContent ?? '').trim()
        const norm = normalizeMenuLabel(label)
        if (norm === 'save') {
          event.preventDefault()
          event.stopPropagation()
          opts.onFlushSave()
          return
        }
        if (isBlockedFileMenuLabel(label)) {
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }

      if (target.closest('div.geStatusAlert, .geStatus')) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    true,
  )

  // Capture-phase keydown: Ctrl/Cmd+S flushes the sync; the file-management
  // shortcuts (open/new/save-as/print) are dropped. The app's own key
  // bindings are bubble-phase, so this wins.
  doc.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = String(event.key ?? '').toLowerCase()
      if (key === 's') {
        event.preventDefault()
        event.stopPropagation()
        if (!event.shiftKey) opts.onFlushSave()
        return
      }
      if (key === 'o' || key === 'n' || key === 'p') {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    true,
  )

  strip()

  // Re-apply when the app re-renders one of the relevant surfaces (the
  // share button is (re)created per load; the status alert re-appears per
  // edit; the popups are built per open). Cheap gate: only node types the
  // app uses for those surfaces, so canvas redraw batches are skipped.
  const MO = win.MutationObserver
  if (MO && doc.body) {
    const observer = new MO(mutations => {
      let hit = false
      for (const m of mutations) {
        if (m.type === 'attributes') {
          if (
            (m.attributeName ?? '').match(/^(class|data-action|title|style)$/)
          ) {
            hit = true
          }
          continue
        }
        for (const node of Array.from(m.addedNodes)) {
          if (relevantNode(node)) hit = true
        }
      }
      if (hit) strip()
    })
    observer.observe(doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-action', 'title', 'style'],
    })
  }
}
