#!/bin/bash
set -eu

fail() { printf '%s\n' "$1" >&2; exit 1; }
export PATH="/opt/homebrew/opt/gnu-sed/libexec/gnubin:$HOME/.docker/bin:/opt/homebrew/bin:/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export DOCKER_CONTEXT=desktop-linux
cd -- "$1" || fail 'Cannot open the selected Toolkit folder.'
command -v docker >/dev/null || fail 'Install Docker Desktop for Apple Silicon and enable its CLI.'
sed --version >/dev/null 2>&1 || fail 'GNU sed is required by Toolkit. Install it with brew install gnu-sed.'

if ! docker info >/dev/null 2>&1; then
  /usr/bin/open -gj -b com.docker.docker || fail 'Cannot open Docker Desktop.'
  deadline=$((SECONDS + 180))
  until docker info >/dev/null 2>&1; do
    (( SECONDS < deadline )) || fail 'Docker did not become ready. Check Docker Desktop and try again.'
    sleep 2
  done
fi

local_url() {
  local bindings binding
  bindings=$(bin/docker-compose port sharelatex 80 2>/dev/null) || return 1
  while IFS= read -r binding; do
    if [[ $binding =~ ^(127\.0\.0\.1|0\.0\.0\.0):([0-9]{1,5})$ ]]; then
      printf 'http://localhost:%s\n' "${BASH_REMATCH[2]}"
      return 0
    fi
  done <<< "$bindings"
  return 1
}
healthy() {
  [[ $(curl --noproxy '*' --max-time 3 -s -o /dev/null -w '%{http_code}' "$1/status") == 200 ]]
}

if url=$(local_url) && healthy "$url"; then
  printf '%s\n' "$url"
  exit 0
fi
bin/docker-compose up -d >/dev/null 2>&1 || fail 'Cannot start the stack. Run bin/docker-compose up -d in the selected Toolkit folder for diagnostics.'
url=$(local_url) || fail 'No local IPv4 HTTP port is published for sharelatex:80. Reverse-proxy deployments are not supported by this launcher.'
deadline=$((SECONDS + 180))
until healthy "$url"; do
  (( SECONDS < deadline )) || fail 'The web service did not become ready. Check the sharelatex container logs.'
  sleep 2
done
printf '%s\n' "$url"
