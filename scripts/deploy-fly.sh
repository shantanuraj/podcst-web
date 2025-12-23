#!/bin/bash
set -e

# Ensure we have a FLY_API_TOKEN
# It will check if it's already set, otherwise try to get it from 'fly auth token'
if [ -z "$FLY_API_TOKEN" ]; then
    echo "Fetching FLY_API_TOKEN..."
    # 'fly auth token' is deprecated, but 'fly tokens create deploy' requires more arguments.
    # We'll stick to 'fly auth token' for now if it works, or try to handle the token better.
    FLY_API_TOKEN=$(fly auth token 2>/dev/null || fly tokens create deploy -x 1h --json | jq -r .token)
fi

if [ -z "$FLY_API_TOKEN" ]; then
    echo "Error: Could not find FLY_API_TOKEN. Please login with 'fly auth login' or set the FLY_API_TOKEN env var."
    exit 1
fi

echo "Deploying via ephemeral builder machine..."
# Explicitly specifying CPU kind and size to avoid "invalid CPU kind" errors
flyctl console --dockerfile Dockerfile.builder \
    -C "/srv/deploy.sh" \
    --env=FLY_API_TOKEN=$FLY_API_TOKEN \
    --vm-cpukind shared \
    --vm-memory 1024 \
    --vm-cpus 1

