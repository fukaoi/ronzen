#!/bin/bash

# LLM Council - production start script
#
# Builds the frontend and serves it from the backend, so the page and the API
# share one origin. Point a Cloudflare Tunnel at http://localhost:8001 and put
# a Cloudflare Access policy on the hostname: that single policy then covers
# the page, the API and the uploaded images.

set -e

cd "$(dirname "$0")"

echo "Building frontend..."
npm --prefix frontend run build

echo ""
echo "Starting LLM Council on http://${HOST:-127.0.0.1}:${PORT:-8001}"
echo "(bound to loopback - expose it with a tunnel, not by opening the port)"
echo ""

exec uv run python -m backend.main
