# E2E reproduction — "Out of sync" + duplicated bib entry after file switch

Reviewer-reported bug (fixed 2026-08-28, `BIB_ORCID_TEMPLATES_PLAN.md` §P1):
edit an entry in the bibliography Visual view, switch to the main `.tex` tab,
switch back — the entry was duplicated in the list (client-side only; the
server document was always correct), the op stayed un-acked forever, and the
"Out of sync" modal appeared on the next interaction; a reload restored the
single, correct entry.

## Files

- `cdp.mjs` — minimal zero-dependency Chromium (CDP) driver: launches
  headless `chromium-browser` on a local port with a scratch profile and
  exposes `newTab` / `evalIn` / `type` / `url` helpers.
- `out-of-sync-repro.mjs` — the regression test: drives the deployed server
  through the reviewer's exact sequence and asserts the fixed behaviour
  (one entry, correct author, no discarded acks, no resend loop, no
  "Out of sync" modal). Exit code 0 = PASS.

## Run

```sh
OVERLEAF_USER="<email>" OVERLEAF_PASS="<pass>" \
OVERLEAF_BASE="https://psintern.neuro.uni-bremen.de" \
P1_PID="<project-id>" \
node test/e2e/out-of-sync-repro.mjs
```

Credentials come from the environment and are never written to disk or
printed (rule: never commit credentials). `chromium-browser` must be
available; CDP port/profile are overridable via `CDP_PORT` / `CDP_PROFILE`.

## Expectations

| State | Result |
| --- | --- |
| broken client (pre-fix) | list shows the entry **twice**; console shows `Received an ack for an op with an outdated version.` + `[inflightOpTimeout] Sending` loop + `pollSavedStatus: assuming not saved`; FAIL exits 1 |
| fixed client | exactly **one** entry with the new author; `PASS` on all checks; exit 0 |
