# Undo/redo architecture review — bib visual editor

Date: 2026-11-05 (TODO bdca3409 / board #7)
Status: **decision = keep `BibHistory`, absorb the reconciliation pattern; do NOT migrate to CM6 `isHistory`**

## Question

Should the visual .bib editor's undo/redo stay on the module's custom `BibHistory`
(full-document string stack + DOM-event toolbar wiring), or migrate to
CodeMirror's native history (`isHistory`) as yu-i-i's editor (overleaf-cep @ ca8fd03)
assumes? Board #6 (per-field commits) depends on the answer because its
`historyUserEvent` design must group with whichever undo system is authoritative.

## Verified facts (this repo)

1. **CM6 native history is not active anywhere in this host.**
   No `isHistory` import or usage exists in `services/web`
   (grep over `services/web/frontend/js` and `services/web/modules` — zero hits).
   The app is OT-synchronized; the CM6 view is a projection of the document.

2. **The OT layer has a first-class 'undo' transaction origin.**
   `services/web/frontend/js/features/source-editor/extensions/realtime.ts:520`
   maps transactions carrying `Transaction.userEvent === 'undo'` to origin
   `'undo'` (line 283 branches `fromUndo = origin === 'undo' || 'reject'`).
   i.e. *host-level* undo (when it exists) reaches views as transactions tagged
   'undo', and the sync pipeline special-cases them.

3. **Our undo surface is the module's own.**
   - Toolbar buttons dispatch `BIB_UNDO_EVENT` / `BIB_REDO_EVENT`
     (`frontend/js/components/bib-editor-panel.tsx:689-711`).
   - The plugin's `moveHistory()` dispatches a full-document replacement
     (`frontend/js/extensions/bib-editor-extension.ts:285+`) **without** a
     `userEvent` annotation → the OT pipeline treats it as an ordinary edit.
   - `BibHistory` (lines 91-177) is a bounded (100) string stack with 700 ms
     coalescing, file-swap detection (`looksLikeSameDocument`, 64-char shared
     boundary → reset), and state events for the toolbar.

4. **yu-i-i's extension never creates history.** It *listens* for
   `isUserEvent('undo'|'redo')` transactions to drive incremental re-projection
   (`applyIncrementalChange`) and identity remapping, and reports
   `canUndo/canRedo` via `undoDepth(view.state)` (which is 0 without
   `isHistory`). In our host — where 'undo' transactions come from the host
   layer or don't come at all — that part of their design is inert for
   *producing* undo; their toolbar-less UX assumes the surrounding editor
   supplies it. Overleaf CE as shipped here does not.

## Candidate designs

| Criterion | Keep `BibHistory` (ours) | CM6 `isHistory` (their assumption) |
|---|---|---|
| Undo surface in CE host | explicit toolbar buttons (SaaS parity) — works today | none unless we enable `isHistory` **and** add buttons; app Ctrl+Z is OS/editor default only |
| OT collaboration | moveHistory = plain edit op; peer sees "document rewritten to previous text" | **local-only stack in a collab editor**: remote edits split/diverge CM history (classic CM6+OT conflict); their "works with any extension" benefit does not survive sync |
| Host history coexistence | single system (verified: no other history in this host) | two systems if the host ever enables tagg'd 'undo' transactions (realtime.ts already special-cases them) |
| Identity reconciliation | today: full reparse on any doc change; identity by key only | their change: `getEntryIdentityChanges` (ChangeSet mapping) — **portable onto our stack** |
| SaaS toolbar requirement | satisfied by design | not satisfied (no host buttons) |
| Maintenance | custom ~200 lines, tested (`bib-history.test.mjs`), file-swap handled | less code in the module, but config coupling to CM6 history semantics across versions (our own comment: "CM6 major differences make transaction metadata unreliable across versions") |

## Decision

**Keep `BibHistory`.** In an OT-synchronized host, a component-local undo stack
scoped to the open file is the pragmatic correct surface, and native CM6 history
is the wrong model for a view that is a projection of shared document state.
Port from their codebase instead:

1. **Identity reconciliation on every documented change** (their
   `bib-editor-identity.ts` — ChangeSet-based old→new occurrence mapping,
   insert-at-start and start-replacement edge cases) so selection, previews and
   caches reconcile instead of relying on key equality. This works identically
   on top of `BibHistory` (it observes transactions, not the history engine)
   and is a prerequisite for #6's duplicate-key-safe per-field commits.
2. **Tag history moves**: when `moveHistory()` applies, dispatch with
   `Transaction.userEvent.of(direction === -1 ? 'undo' : 'redo')` so the OT
   pipeline's first-class 'undo' origin (realtime.ts) applies and any listener
   (including our future identity reconciler) can distinguish undo-applied
   changes from user edits. Verify against e2e `out-of-sync-repro.mjs` when
   changing.
3. **Drop "native undo" from #6's scope.** #6's per-field commits should
   annotate `input.type|input.complete` for *coalescing* in our stack (already
   supported via the 700 ms window) rather than assume `isHistory`.

## Rejected

- Migrating to `isHistory`: wrong collaboration model (fact 2/3), no toolbar
  surface in CE, and it would silently double-history the moment a host-level
  'undo' transaction source appears.
- Removing `BibHistory` in favor of app/OT undo: Overleaf CE ships no
  editor-level undo command in this tree (verified), so the visual editor
  would have no undo at all.

## Risks / out of scope

- **Peer-shared undo** (one peer's undo reverting another's edit) is a
  project-history/OT feature, out of scope for this module.
- If a future host releases editor-level undo (tagged 'undo' transactions
  reaching the view), `BibHistory` and it would be *two* surfaces: revisit
  then, keeping the toolbar as the single UI but sourcing it from the host
  (the identity-reconciliation import above stays valid).
- `moveHistory`'s full-document replacement is heavy for very large .bib files;
  .bib files are small in practice. Accept.
