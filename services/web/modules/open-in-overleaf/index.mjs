import OpenInOverleafRouter from './app/src/OpenInOverleafRouter.mjs'

// Open in Overleaf module for Ayakaleaf Pro.
//
// The SaaS "Open in Overleaf" / Prefilled-Project API (the `/docs` endpoint
// documented on the public /devs page) is not shipped in the open-source build.
// This module reproduces the same contract — POST/GET /docs with snip /
// encoded_snip / snip_uri[] / zip_uri / engine / main_document — on top of the
// existing project-creation infrastructure, fetching external URLs through the
// SSRF-guarded linked-url-proxy. It also serves the /devs documentation page.
export default {
  router: OpenInOverleafRouter,
}
