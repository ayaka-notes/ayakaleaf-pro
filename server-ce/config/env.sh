export CHAT_HOST=127.0.0.1
export CLSI_HOST=127.0.0.1
export DOCSTORE_HOST=127.0.0.1
export DOCUMENT_UPDATER_HOST=127.0.0.1
export DOCUPDATER_HOST=127.0.0.1
export FILESTORE_HOST=127.0.0.1
export HISTORY_V1_HOST=127.0.0.1
export LINKED_URL_PROXY_HOST=127.0.0.1
export NOTIFICATIONS_HOST=127.0.0.1
export PROJECT_HISTORY_HOST=127.0.0.1
export REALTIME_HOST=127.0.0.1
export WEB_HOST=127.0.0.1
export WEB_API_HOST=127.0.0.1

# If SANDBOXED_COMPILES_SIBLING_CONTAINERS is set to true, 
# we need to set the TEXLIVE_IMAGE_USER to www-data so that the
# sandboxed compiles container can access the files 
# created by the web container.
if [ "${SANDBOXED_COMPILES_SIBLING_CONTAINERS:-}" = "true" ]; then
  export TEXLIVE_IMAGE_USER=www-data
fi
# clsi-cache keeps the outputs of the last compiles: the editor shows the
# previous PDF right after opening a project, clsi restores its compile
# directory from the cache, and projects created from templates start out
# with a PDF. It runs on this host next to clsi, so outputs are hard-linked
# from the clsi output directory instead of being downloaded. Set it to an
# empty string to force http downloads (e.g. when running clsi elsewhere).
# Set CLSI_CACHE_ENABLED=false to turn it off.
if [ "${CLSI_CACHE_ENABLED:-true}" = "true" ]; then
  export CLSI_CACHE_SHARD="${CLSI_CACHE_SHARD:-clsi-cache-local}"
  export CLSI_CACHE_INSTANCES="${CLSI_CACHE_INSTANCES:-[{\"url\":\"http://127.0.0.1:3044\",\"shard\":\"${CLSI_CACHE_SHARD}\"}]}"
  export CLSI_CACHE_CURRENT_SHARDS="${CLSI_CACHE_CURRENT_SHARDS:-1}"
  export CLSI_CACHE_DESIRED_SHARDS="${CLSI_CACHE_DESIRED_SHARDS:-1}"
  export CLSI_CACHE_DATA_PATH="${CLSI_CACHE_DATA_PATH:-/var/lib/overleaf/data/clsi-cache}"
  export CLSI_CACHE_LOCAL_CLSI_OUTPUT_DIR="${CLSI_CACHE_LOCAL_CLSI_OUTPUT_DIR-/var/lib/overleaf/data/output}"
fi
