#!/usr/bin/env bash
#
# Scaffold smoke test: creates an app with `henri new`, installs it from the
# packed workspace packages (not from npm), lints it, builds it and boots it
# in production mode. The `scaffold` job in .github/workflows/ci.yml runs it;
# it works locally too:
#
#   scripts/smoke.sh                 # work dir .tmp/smoke, port 3000
#   SMOKE_PORT=3100 scripts/smoke.sh
#
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
work=${SMOKE_DIR:-$root/.tmp/smoke}
port=${SMOKE_PORT:-3000}
app=$work/smoke
tarballs=$work/tarballs
server_log=$work/server.log
server_pid=""

log() {
  printf '\n==> %s\n' "$*"
}

# @usehenri/disk keeps its mongod data in $TMPDIR/henri-mongo-<md5 of the app
# path>. `henri build` exits without stopping the store and `henri server` has
# no signal handler, so the mongod of this app can outlive both: stop it by
# its data path (never anything else running on the machine).
stop_mongod() {
  local hash
  hash=$(node -e "process.stdout.write(require('crypto').createHash('md5').update(process.argv[1]).digest('hex'))" "$app")
  pkill -f "henri-mongo-$hash" 2>/dev/null || true
}

cleanup() {
  if [ -n "$server_pid" ] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  stop_mongod
}
trap cleanup EXIT

rm -rf "$work"
mkdir -p "$tarballs"

# ---------------------------------------------------------------------------
# 1. Pack every public package. The app's pnpm-workspace.yaml then overrides
#    @usehenri/* and henri with the tarballs so that transitive workspace
#    dependencies (disk -> mongoose, henri -> cli, ...) resolve locally too.
# ---------------------------------------------------------------------------
log "packing the workspace packages into $tarballs"
overrides=""
henri_tarball=""
for dir in "$root"/packages/*/; do
  pkg=$(node -p "
    const p = require('$dir/package.json');
    p.private ? '' : [p.name, p.name.replace(/^@/, '').replace('/', '-') + '-' + p.version + '.tgz'].join(' ')
  ")
  [ -z "$pkg" ] && continue
  name=${pkg% *}
  file=${pkg#* }
  (cd "$dir" && pnpm pack --pack-destination "$tarballs" >/dev/null)
  [ -f "$tarballs/$file" ] || {
    echo "pnpm pack did not produce $tarballs/$file" >&2
    exit 1
  }
  overrides+="  '$name': file:$tarballs/$file"$'\n'
  [ "$name" = henri ] && henri_tarball=$tarballs/$file
done
printf '%s' "$overrides"

# ---------------------------------------------------------------------------
# 2. Scaffold with the workspace CLI, then install from the tarballs
# ---------------------------------------------------------------------------
log "henri new smoke --skip-install"
(cd "$work" && node "$root/packages/henri/bin/henri.js" new smoke --skip-install)

cd "$app"
printf '\n# Resolve the henri packages from the tarballs packed above\noverrides:\n%s' "$overrides" >>pnpm-workspace.yaml
node -e "
  const fs = require('fs');
  const file = 'config/default.json';
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.port = $port;
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
"

log "pnpm install (henri from $henri_tarball)"
pnpm add --save-dev "$henri_tarball"
pnpm ls --depth 0

# ---------------------------------------------------------------------------
# 3. Lint, build, boot, curl
# ---------------------------------------------------------------------------
log "pnpm lint"
pnpm lint

log "henri build"
pnpm exec henri build
stop_mongod

log "henri server --production"
pnpm exec henri server --production >"$server_log" 2>&1 &
server_pid=$!

status=""
for _ in $(seq 1 60); do
  status=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/" || true)
  [ "$status" = "200" ] && break
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$server_log"
    echo "henri server exited before answering" >&2
    exit 1
  fi
  sleep 1
done

cat "$server_log"

if [ "$status" != "200" ]; then
  echo "GET / did not answer 200 within 60s (last status: ${status:-none})" >&2
  exit 1
fi

# A store failure is logged but does not stop the server: make it fail here
if grep -q "failed to connect" "$server_log"; then
  echo "the default store did not start (see the log above)" >&2
  exit 1
fi

log "GET / -> 200"
