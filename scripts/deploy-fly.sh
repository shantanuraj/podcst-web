#!/usr/bin/env bash
set -euo pipefail

exec flyctl deploy --remote-only "$@"
