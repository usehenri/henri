#!/usr/bin/env bash
#
# Scaffold smoke test: creates an app with `henri new`, installs it from the
# packed workspace packages (not from npm), lints it, builds it and boots it
# in production mode. The `scaffold` job in .github/workflows/ci.yml runs it
# once per renderer; it works locally too:
#
#   scripts/smoke.sh                        # inertia, work dir .tmp/smoke, port 3000
#   SMOKE_PORT=3100 scripts/smoke.sh
#   SMOKE_RENDERER=react scripts/smoke.sh   # the frozen Next.js engine
#
set -euo pipefail

renderer=${SMOKE_RENDERER:-inertia}

case "$renderer" in
inertia | react) ;;
*)
  echo "SMOKE_RENDERER must be inertia or react (got '$renderer')" >&2
  exit 1
  ;;
esac

root=$(cd "$(dirname "$0")/.." && pwd)
work=${SMOKE_DIR:-$root/.tmp/smoke-$renderer}
port=${SMOKE_PORT:-3000}
app=$work/smoke
tarballs=$work/tarballs
server_log=$work/server.log
server_pid=""

# The page extension the generators write, and the file `henri build` leaves
# behind, per renderer
if [ "$renderer" = inertia ]; then
  page_ext=jsx
  build_marker=app/views/dist/client/.vite/manifest.json
else
  page_ext=js
  build_marker=app/views/.next/BUILD_ID
fi

log() {
  printf '\n==> %s\n' "$*"
}

# @usehenri/disk keeps its mongod data in $TMPDIR/henri-mongo-<md5 of the app
# path>. `henri build` exits without stopping the store, and a server killed
# before it drains never stops it either, so the mongod of this app can
# outlive both: stop it by its data path (never anything else running on the
# machine).
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
log "henri new smoke --skip-install --renderer $renderer"
(cd "$work" && node "$root/packages/henri/bin/henri.js" new smoke --skip-install --renderer "$renderer")

# The scaffold is the sample of the renderer: `henri new` writes its pages
for page in index new edit show _form; do
  [ -f "$app/app/views/pages/tasks/$page.$page_ext" ] || {
    echo "henri new did not scaffold app/views/pages/tasks/$page.$page_ext" >&2
    exit 1
  }
done

cd "$app"

# The account flows: `henri generate authentication` turns them on in the
# configuration and writes the pages, the controller, the mailer, the user
# model and the tests. Everything below (lint, build, boot) then covers them.
log "henri generate authentication"
node "$root/packages/henri/bin/henri.js" generate authentication

printf '\n# Resolve the henri packages from the tarballs packed above\noverrides:\n%s' "$overrides" >>pnpm-workspace.yaml
node -e "
  const fs = require('fs');
  const file = 'config/default.json';
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.port = $port;
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
"

# `henri new` declares henri as a dependency; the override above points it at
# the packed tarball, so nothing has to be added by hand
log "pnpm install (henri from $henri_tarball)"
pnpm install
pnpm ls --depth 0

# ---------------------------------------------------------------------------
# 3. Lint, build, boot, curl
# ---------------------------------------------------------------------------
log "pnpm lint"
pnpm lint

# A scaffolded application has to pass its own audit with nothing to say at
# all, which is what --fail-on=low asks for. If it ever does not, the
# scaffold is what is wrong, not the audit. --no-deps keeps the smoke test
# offline: the advisories are the Security workflow's job.
log "henri audit"
pnpm exec henri audit --no-deps --fail-on=low

# The description of what the scaffold exposes, from a real install: the
# command has to ship, run without a database and produce a document the
# scaffolded resource is actually in.
log "henri openapi"
pnpm exec henri openapi --out openapi.json
node -e '
  const doc = require("./openapi.json");
  const wanted = ["/tasks", "/tasks/{id}", "/livez"];
  const missing = wanted.filter((route) => !doc.paths[route]);

  if (doc.openapi !== "3.1.0" || missing.length > 0) {
    console.error("henri openapi wrote no usable document:", doc.openapi, missing);
    process.exit(1);
  }

  const { coverage } = doc.info["x-henri"];

  console.log(
    `  ${coverage.operations} operations, ${coverage.described} described, ${coverage.unknown} not`
  );
'
rm openapi.json

log "henri build"
pnpm exec henri build
stop_mongod

if [ ! -e "$app/$build_marker" ]; then
  echo "henri build did not write $build_marker" >&2
  exit 1
fi

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

# ---------------------------------------------------------------------------
# 4. The document is rendered on the server, by the engine, with the data the
#    controller sent, and it is styled by the stylesheet the build produced.
# ---------------------------------------------------------------------------
home=$(curl -s "http://127.0.0.1:$port/")

# The welcome page, rendered on the server (not an empty root the browser
# would fill in): its heading and its tailwind classes are in the document
if ! printf '%s' "$home" | grep -q 'class="mx-auto w-full max-w-3xl'; then
  echo "GET / did not carry the tailwind classes of the welcome page" >&2
  exit 1
fi

if ! printf '%s' "$home" | grep -q '>Welcome<'; then
  echo "GET / was not server rendered (no <h1>Welcome</h1> in the document)" >&2
  exit 1
fi

# The controller's data reached the page: main#home renders '/' with the
# tasks, and the page prints how many there are next to the heading
if ! printf '%s' "$home" | grep -q '>Tasks<'; then
  echo "GET / did not render the data main#home sent" >&2
  exit 1
fi

if [ "$renderer" = inertia ]; then
  # The Inertia client boots from the page object embedded in the document
  if ! printf '%s' "$home" | grep -q 'data-page='; then
    echo "GET / carries no Inertia page object" >&2
    exit 1
  fi
fi

# The scaffolded resource is served too: its pages went through the build
tasks_status=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/tasks" || true)
tasks=$(curl -s "http://127.0.0.1:$port/tasks")

if [ "$tasks_status" != "200" ]; then
  echo "GET /tasks answered $tasks_status, not 200" >&2
  exit 1
fi

if ! printf '%s' "$tasks" | grep -q 'New Task'; then
  echo "GET /tasks did not render the scaffolded index page" >&2
  exit 1
fi

log "GET / and GET /tasks -> server rendered pages with their data"

# The stylesheet the build wrote, linked by the document and served
css=$(printf '%s' "$home" | sed -n 's/.*<link rel="stylesheet" href="\([^"]*\.css\)".*/\1/p' | head -1)

if [ -z "$css" ]; then
  echo "GET / did not link a stylesheet" >&2
  exit 1
fi

stylesheet=$(curl -s "http://127.0.0.1:$port$css")

if ! printf '%s' "$stylesheet" | grep -q 'prefers-color-scheme'; then
  echo "$css is not the compiled tailwind stylesheet (no dark mode rules)" >&2
  exit 1
fi

# Tailwind only emits a class it found in a page: these come from the
# scaffolded tasks pages, so the @source globs still cover what is generated
for class in 'overflow-x-auto' 'whitespace-nowrap'; do
  if ! printf '%s' "$stylesheet" | grep -q "$class"; then
    echo "$css does not carry the .$class rule of the scaffolded pages" >&2
    exit 1
  fi
done

log "GET $css -> compiled tailwind, the scaffolded classes included"

# ---------------------------------------------------------------------------
# 5. The account flows the generator wired: the signup page renders, an
#    account can be created, and a reset request answers the same for an
#    address that exists and one that does not.
# ---------------------------------------------------------------------------
signup_status=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/signup")

if [ "$signup_status" != "200" ]; then
  echo "GET /signup answered $signup_status" >&2
  exit 1
fi

created=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","name":"Ada","password":"a-long-enough-password"}' \
  "http://127.0.0.1:$port/signup")

if [ "$created" != "201" ]; then
  echo "POST /signup answered $created, expected 201" >&2
  exit 1
fi

known=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com"}' "http://127.0.0.1:$port/password/forgot")
unknown=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"email":"nobody@example.com"}' "http://127.0.0.1:$port/password/forgot")

if [ "$known" != "$unknown" ]; then
  echo "a reset request tells a known address from an unknown one:" >&2
  echo "  known:   $known" >&2
  echo "  unknown: $unknown" >&2
  exit 1
fi

log "the account flows answer: /signup, and a reset request that says nothing"

# ---------------------------------------------------------------------------
# 6. The probes an orchestrator asks, and a SIGTERM that drains: the server
#    stops accepting, finishes what it is serving and exits by itself.
# ---------------------------------------------------------------------------
for probe in /livez /readyz /healthz /_henri/health; do
  probe_status=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port$probe" || true)

  if [ "$probe_status" != "200" ]; then
    echo "GET $probe answered $probe_status, expected 200" >&2
    exit 1
  fi
done

log "GET /livez, /readyz, /healthz and /_henri/health -> 200"

kill -TERM "$server_pid"

for _ in $(seq 1 30); do
  kill -0 "$server_pid" 2>/dev/null || break
  sleep 1
done

if kill -0 "$server_pid" 2>/dev/null; then
  echo "the server did not exit within 30s of SIGTERM" >&2
  exit 1
fi

# The exit code here is the `pnpm exec` wrapper's, which the signal kills, so
# what henri did is read from its log instead. The wrapper dies as soon as it
# forwards the signal, while henri is still draining and stopping its
# modules, so the log is what says the shutdown finished -- not the pid.
wait "$server_pid" 2>/dev/null || true
server_pid=""

for _ in $(seq 1 30); do
  grep -q "exiting application" "$server_log" && break
  sleep 1
done

for line in "SIGTERM received" "no longer accepting connections" "exiting application"; do
  if ! grep -q "$line" "$server_log"; then
    cat "$server_log"
    echo "the shutdown never said '$line'" >&2
    exit 1
  fi
done

if grep -q "unable to stop within" "$server_log"; then
  cat "$server_log"
  echo "the shutdown hit its deadline instead of finishing" >&2
  exit 1
fi

after=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/" || true)

if [ "$after" = "200" ]; then
  echo "the port still answers after the shutdown" >&2
  exit 1
fi

log "SIGTERM -> drained, stopped and let go of the port"

# ---------------------------------------------------------------------------
# 7. The same build with `"csp": { "nonce": true }`: every response draws a
#    nonce, the header names it, the renderer writes it on every script of
#    the document, and the next response draws another one. A nonce that is
#    named and not written would refuse the page's own scripts, which is why
#    this is checked against a booted application and not only in a unit
#    test.
# ---------------------------------------------------------------------------
log "henri server --production, with csp.nonce"
node -e "
  const fs = require('fs');
  const file = 'config/default.json';
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.csp = { nonce: true };
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
"

nonce_log=$work/server-nonce.log
pnpm exec henri server --production >"$nonce_log" 2>&1 &
server_pid=$!

status=""
for _ in $(seq 1 60); do
  status=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/" || true)
  [ "$status" = "200" ] && break
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$nonce_log"
    echo "henri server exited before answering with csp.nonce on" >&2
    exit 1
  fi
  sleep 1
done

if [ "$status" != "200" ]; then
  cat "$nonce_log"
  echo "GET / did not answer 200 with csp.nonce on (last: ${status:-none})" >&2
  exit 1
fi

nonce_of() {
  curl -sS -D "$work/headers-$1" -o "$work/page-$1.html" "http://127.0.0.1:$port/"
  tr -d '\r' <"$work/headers-$1" |
    sed -n 's/^[Cc]ontent-[Ss]ecurity-[Pp]olicy: //p' |
    sed -n "s/.*'nonce-\([A-Za-z0-9_-]*\)'.*/\1/p"
}

first=$(nonce_of first)
second=$(nonce_of second)

if [ -z "$first" ]; then
  cat "$work/headers-first"
  echo "the Content-Security-Policy names no nonce" >&2
  exit 1
fi

if [ "$first" = "$second" ]; then
  echo "two responses carried the same nonce ($first)" >&2
  exit 1
fi

if ! grep -q "nonce=\"$first\"" "$work/page-first.html"; then
  echo "the nonce of the header ($first) is nowhere in the document" >&2
  exit 1
fi

# Every script of the document carries it: one that does not is a script the
# browser refuses, since 'unsafe-inline' is gone from script-src
unnonced=$(grep -oE '<script[^>]*>' "$work/page-first.html" | grep -vc 'nonce=' || true)

if [ "$unnonced" != "0" ]; then
  grep -oE '<script[^>]*>' "$work/page-first.html" | grep -v 'nonce=' >&2
  echo "$unnonced script tags carry no nonce" >&2
  exit 1
fi

if tr -d '\r' <"$work/headers-first" |
  sed -n 's/^[Cc]ontent-[Ss]ecurity-[Pp]olicy: //p' |
  grep -qE "script-src[^;]*'unsafe-inline'"; then
  echo "script-src still allows 'unsafe-inline' with a nonce in play" >&2
  exit 1
fi

kill -TERM "$server_pid"
wait "$server_pid" 2>/dev/null || true
server_pid=""

log "csp.nonce -> $first, then $second, both written on every script"
