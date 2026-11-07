# tools/containers — language tool backends

Docker backends for the LanguageTool web module
(`services/web/modules/languagetool`). Both containers expose the
LanguageTool v2 wire API on port **8010**, so Overleaf can use either one:
point `LANGUAGE_TOOL_HOST` (or `LANGUAGE_TOOL_URL`) at the running
container and set `LANGUAGE_TOOL_ENABLED=true` on the overleaf container.

| Directory    | Backend                                                          | Notes |
| ------------ | ---------------------------------------------------------------- | ----- |
| `languagetool/` | [erikvl87/languagetool](https://github.com/erikvl87/languagetool) Java server (multi-language, n-gram models) | `./ngrams` data dir; `download_ngrams.sh` fetches the models (~15 GB main set) |
| `grammar-llm/` | Grammar-LLM: same port + `/v2/*` API, backed by a GRMR-V3-G4B fine-tuned LLM (local `node-llama-cpp` or an OpenAI-compatible API) | English-only; model lives in a volume, auto-downloaded on first start. See its `README.md` |

## Compose files — intentionally general

Each directory ships **two generic composes** (no deployment-specific paths,
ports, or network names hardcoded):

- `compose.yaml` — standalone service on the host (`LTOOL_PORT` to change the
  host binding; defaults to `127.0.0.1:8010`).
- `compose-stack/compose.yaml` — attaches the service to the main Overleaf
  stack's external network (default `overleaf-network`, override with
  `LTOOL_NETWORK`) and advertises `container_name: languagetool` +
  `hostname: languagetool`, so Overleaf resolves it by name
  (`http://languagetool:8010`) without host port exposure.

All interesting options are environment overrides (`LTOOL_*` for the
languagetool service, `GRAMMAR_LLM_*` for grammar-llm) — see the commented
blocks in each compose for the full list.

## Switching backends

Because both speak the same wire API on the same port/paths, admins can swap
containers with a one-line service change (and `LANGUAGE_TOOL_HOST` if the
service name changes). Caveats:

- `languagetool` is multi-language; `grammar-llm` is English-only.
- The web module filters TYPOS-category results while the Hunspell
  spellchecker is active; `grammar-llm` reports `rule.category.id = GRAMMAR`
  (never `TYPOS`), so its results are never hidden by that filter.

## Wires into Overleaf (services/web)

- `config/settings.defaults.js` — registers the module's editor extension +
  Settings section **unconditionally**: that list is consumed at webpack
  build time by the `import-overleaf-module` babel macro, so it must not be
  gated on an env flag (that would drop the chunks even for enabled
  deployments).
- Runtime visibility is env-driven (`LANGUAGE_TOOL_ENABLED=true` on the
  overleaf container): the router registers, `languageToolAvailable` is
  exposed, and the Settings section renders — including its label. When the
  flag is off at container start, the section hook returns `null` (label
  hidden) and the editor extension stays dormant.
- `modules/languagetool/README.md` — full module contract, endpoints, env
  table.

**Build note:** after changing anything under `modules/languagetool/`
or its two slot registrations, the image's webpack build stage must run
again (the production bundle bakes in the slot imports at build time).
