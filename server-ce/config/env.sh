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