/*
 * Intentionally empty stub (vendored draw.io bundle, see PROVENANCE.txt).
 *
 * app.min.js loads this file at startup to enable the Microsoft OneDrive
 * integration ("M365Client"). This offline Overleaf deployment has no
 * OneDrive credentials and no external-save storage of any kind (the
 * draw.io module's save policy is: the Overleaf document only), so the
 * integration must stay disabled.
 *
 * Without this file the app gets a 404 (HTML error page → rejected by
 * strict MIME checking) and logs console errors on every boot. With it,
 * the app boots cleanly and simply logs "M365Client disabled:
 * OneDriveClient is not a constructor" — the desired state.
 */
