#!/bin/bash

# Ronzen - start script
#
# Builds the frontend and serves it from the backend, so the page and the API
# share one origin on a single port. For working on the frontend with live
# reload, run the backend and `npm --prefix frontend run dev` separately (see
# the README).

set -e

cd "$(dirname "$0")"

echo "Building frontend..."
npm --prefix frontend run build

echo ""
echo "Starting Ronzen on http://${HOST:-127.0.0.1}:${PORT:-8001}"
echo "(bound to loopback: reachable from this machine only)"
echo ""

exec uv run python -m backend.main
