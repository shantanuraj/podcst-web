# syntax = docker/dockerfile:1

FROM flyio/flyctl:latest AS flyio
FROM debian:bullseye-slim

RUN apt-get update; apt-get install -y ca-certificates jq bash

COPY <<"EOF" /srv/deploy.sh
#!/bin/bash
set -e

# Collect all secrets into a list for --build-secret flags
# and into a file for the ALL_SECRETS bundle
deploy=(flyctl deploy --remote-only)
touch /srv/.secrets

# Get the list of secret names from Fly.io
# Note: flyctl secrets list --json requires a valid FLY_API_TOKEN
SECRET_NAMES=$(flyctl secrets list --json | jq -r ".[].name")

for secret in $SECRET_NAMES; do
  # Get the value from the current environment (injected by fly console)
  value="${!secret}"
  if [ -n "$value" ]; then
    echo "export ${secret}=\"${value}\"" >> /srv/.secrets
    deploy+=(--build-secret "${secret}=${value}")
  fi
done

# Add the ALL_SECRETS bundle which is used in the main Dockerfile
deploy+=(--build-secret "ALL_SECRETS=$(base64 --wrap=0 /srv/.secrets)")

echo "Starting deployment with collected secrets..."
"${deploy[@]}"
EOF

RUN chmod +x /srv/deploy.sh

COPY --from=flyio /flyctl /usr/bin

WORKDIR /build
COPY . .

