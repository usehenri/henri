#!/usr/bin/env bash
#
# The dynamic half of the audit: an OWASP ZAP baseline scan against a henri
# application that is already running.
#
# `henri audit` reads files; this reads answers. It is what tells you that the
# Content-Security-Policy survived the renderer, that the session cookie
# carries the attributes it is supposed to and that an error page keeps its
# stack to itself -- none of which a static check can honestly claim.
#
#   scripts/zap-baseline.sh                       # http://127.0.0.1:3000
#   scripts/zap-baseline.sh http://127.0.0.1:3101
#   ZAP_MINUTES=5 scripts/zap-baseline.sh         # spider for longer
#
# The scan is passive: it crawls, it reads the answers, it attacks nothing.
# `.github/zap/rules.tsv` decides what fails; everything else is a warning,
# because a scan that fails on a rule nobody acts on gets turned off.
#
# Needs Docker. The same scan runs weekly in .github/workflows/security.yml
# against the showcase.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="${1:-http://127.0.0.1:3000}"
minutes="${ZAP_MINUTES:-1}"
image="ghcr.io/zaproxy/zaproxy:stable"

# The scan runs in a container: 127.0.0.1 there is the container, not the host
inside="${target/127.0.0.1/host.docker.internal}"
inside="${inside/localhost/host.docker.internal}"

if ! curl --silent --show-error --fail --max-time 10 --output /dev/null "$target"; then
  echo "Nothing answers on $target. Start the application first:" >&2
  echo "  pnpm --filter @usehenri/showcase exec henri server --production" >&2
  exit 1
fi

echo "Scanning $target (as $inside from the container), spidering for ${minutes}m"

docker run --rm -t \
  --add-host=host.docker.internal:host-gateway \
  --volume "$root/.github/zap:/zap/wrk:ro" \
  "$image" zap-baseline.py \
  -t "$inside" \
  -c rules.tsv \
  -m "$minutes" \
  -I
