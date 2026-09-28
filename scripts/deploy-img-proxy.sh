#!/usr/bin/env bash
# Update an existing image-proxy installation; this does not provision a host.
set -euo pipefail

log() { printf '[img-proxy] %s\n' "$*"; }
die() { printf '[img-proxy] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  printf '%s\n' \
    'Usage: scripts/deploy-img-proxy.sh [--repo PATH] [--check]' \
    '' \
    'Fetch origin/main from the sibling img_proxy repository and deploy that exact commit.' \
    'Run as your normal user on the service host; activation requests sudo itself.' \
    '--repo PATH  Use another existing img_proxy checkout.' \
    '--check      Install frozen dependencies and run all tests without touching production.'
}

run_tests() {
  local directory=$1 cache=$2 bun=$3
  (
    cd "$directory"
    export PODCST_CACHE_DIR="$cache"
    "$bun" test
    "$bun" run test:socket
  )
}

# Executed once through sudo. Keep dependency installation and Git access outside
# this phase, and execute release tests as the service account, never as root.
activate() {
  [[ $(id -u) == 0 ]] || die 'The internal activation phase requires root.'
  [[ $# == 9 ]] || die 'Invalid activation arguments.'
  # Transaction state must survive Bash unwinding this function on errexit;
  # EXIT handlers cannot reliably access its local variables in that case.
  stage=$1 revision=$2 bun=$3 current=$4 releases=$5 units=$6 lock=$7
  local_health=$8 public_health=$9
  service=podcst-img-proxy.service timer=podcst-img-proxy-prewarm.timer
  prewarm=podcst-img-proxy-prewarm.service
  names=("$service" "$prewarm" "$timer")
  release='' test_cache='' switch_dir='' previous='' state=''
  armed=0 committed=0 timer_active=0 rollback_failed=0

  [[ $revision =~ ^[0-9a-f]{40}$ ]] || die 'Invalid release revision.'
  [[ -L $current && -d $current ]] || die "$current must be an existing, valid release symlink."
  [[ -f $units/$service ]] || die "Missing installed $service."
  id svc-podcst >/dev/null
  # All cooperating deployments share this lock, including different operators.
  exec 9>"$lock"
  flock -n 9 || die 'Another image-proxy deployment is running.'
  previous=$(readlink -f "$current")
  [[ -d $previous ]] || die 'The previous release is unavailable.'

  healthy() {
    local url=$1
    curl --noproxy '*' --fail --silent --show-error --connect-timeout 2 --max-time 5 \
      "$url" >"$state/health.json" 2>/dev/null &&
      python3 -c 'import json, sys; sys.exit(json.load(sys.stdin).get("status") != "ok")' \
        <"$state/health.json" 2>/dev/null
  }

  wait_healthy() {
    local url=$1 attempt
    for attempt in {1..20}; do
      if systemctl is-active --quiet "$service" && healthy "$url"; then return 0; fi
      sleep 1
    done
    return 1
  }

  point_to() {
    ln -s "$1" "$switch_dir/current" && mv -Tf "$switch_dir/current" "$current"
  }

  rollback() {
    log "Restoring $previous and the previous systemd units."
    # Explicitly check every command: rollback is called from an EXIT trap, so
    # recovery must continue even if one of its steps fails.
    for name in "${names[@]}"; do
      if [[ -e $state/units/$name || -L $state/units/$name ]]; then
        cp -a --remove-destination "$state/units/$name" "$units/$name" || rollback_failed=1
      else
        rm -f -- "$units/$name" || rollback_failed=1
      fi
    done
    rm -f -- "$switch_dir/current" || rollback_failed=1
    point_to "$previous" || rollback_failed=1
    systemctl daemon-reload || rollback_failed=1
    systemctl restart "$service" || rollback_failed=1
    if (( timer_active )); then systemctl start "$timer" || rollback_failed=1; fi
    wait_healthy "$local_health" || rollback_failed=1
    if (( rollback_failed )); then
      printf '[img-proxy] ROLLBACK NEEDS ATTENTION. Backup: %s\n' "$state" >&2
    else
      log 'Previous release restored and healthy.'
    fi
  }

  cleanup_activation() {
    local status=$?
    trap - EXIT INT TERM
    set +e
    if (( armed && !committed )); then
      rollback
      (( status != 0 )) || status=1
    fi
    [[ -z $test_cache ]] || rm -rf -- "$test_cache"
    [[ -z $switch_dir ]] || rm -rf -- "$switch_dir"
    # Keep failed activated releases and their unit backups for diagnosis.
    if (( !armed )) && [[ -n $release ]]; then rm -rf -- "$release"; fi
    exit "$status"
  }
  trap cleanup_activation EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  install -d -o root -g root -m 0755 "$releases"
  release=$(mktemp -d "$releases/${revision:0:12}.XXXXXX")
  cp -a "$stage/." "$release/"
  chown -R root:svc-podcst "$release"
  chmod -R go-w "$release"
  chmod 0750 "$release"
  printf '%s\n' "$revision" >"$release/.deploy-revision"
  for name in "${names[@]}"; do
    [[ -f $release/systemd/$name && ! -L $release/systemd/$name ]] || die "Missing release unit: $name"
  done
  systemd-analyze verify "${names[@]/#/$release/systemd/}"

  test_cache=$(mktemp -d /tmp/podcst-deploy-tests.XXXXXX)
  chown svc-podcst:svc-podcst "$test_cache"
  log "Testing $revision as svc-podcst (including the ~26-second socket test)."
  runuser -u svc-podcst -- env PODCST_CACHE_DIR="$test_cache" \
    /bin/bash -c 'set -e; cd "$1"; "$2" test; "$2" run test:socket' _ "$release" "$bun"

  [[ $(readlink -f "$current") == "$previous" ]] || die 'Installed release changed during testing; retry the deployment.'
  if systemctl is-active --quiet "$timer"; then timer_active=1; fi
  state="$release/.deploy-state"
  install -d -m 0700 "$state" "$state/units"
  printf '%s\n' "$previous" >"$state/previous-release"
  printf '%s\n' "$timer_active" >"$state/timer-was-active"
  for name in "${names[@]}"; do
    if [[ -e $units/$name || -L $units/$name ]]; then cp -a "$units/$name" "$state/units/"; fi
  done
  switch_dir=$(mktemp -d "$(dirname "$current")/.img-proxy-switch.XXXXXX")

  # From here every failure (including an interrupt) restores the release AND
  # unit files. Do not replace the cache or touch Caddy, drop-ins or enablement.
  armed=1
  if (( timer_active )); then systemctl stop "$timer"; fi
  if systemctl is-active --quiet "$prewarm"; then systemctl stop "$prewarm"; fi
  for name in "${names[@]}"; do install -m 0644 "$release/systemd/$name" "$units/$name"; done
  point_to "$release"
  systemctl daemon-reload
  systemctl restart "$service"
  wait_healthy "$local_health" || die "Local health check failed: $local_health"
  wait_healthy "$public_health" || die "Public health check failed: $public_health"
  if (( timer_active )); then systemctl start "$timer"; fi
  committed=1
  log "LIVE: $revision ($release)"
  log "Previous release: $previous"
  log "Previous units and rollback metadata: $state"
  log 'Persistent cache and timer enablement preserved; no prewarm run was forced.'
  exit 0
}

main() {
  local script_dir script repo check=0 revision
  work='' # Used by the EXIT trap, including after an errexit function unwind.
  script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
  script="$script_dir/$(basename -- "${BASH_SOURCE[0]}")"
  repo=${IMG_PROXY_REPO:-"$script_dir/../../img_proxy"}
  local bun=${IMG_PROXY_BUN:-/usr/local/bin/bun}
  # Defaults match img_proxy's tracked units. Overrides also allow isolated
  # integration tests; changing live paths requires matching systemd units.
  local current=${IMG_PROXY_CURRENT:-/opt/img_proxy}
  local releases=${IMG_PROXY_RELEASES:-/opt/img_proxy-releases}
  local units=${IMG_PROXY_UNIT_DIR:-/etc/systemd/system}
  local lock=${IMG_PROXY_LOCK:-/run/lock/podcst-img-proxy-deploy.lock}
  local local_health=${IMG_PROXY_LOCAL_HEALTH:-http://127.0.0.1:3102/health}
  local public_health=${IMG_PROXY_PUBLIC_HEALTH:-https://assets.podcst.app/health}
  while (( $# )); do
    case $1 in
      --repo) [[ $# -ge 2 ]] || die '--repo requires a path'; repo=$2; shift 2 ;;
      --check) check=1; shift ;;
      --help|-h) usage; return ;;
      *) die "Unknown option: $1" ;;
    esac
  done
  [[ $(id -u) != 0 ]] || die 'Run as your normal user, not with sudo.'
  [[ -x $bun && $bun == /* ]] || die "Bun must be an executable absolute path: $bun"
  git -C "$repo" rev-parse --git-dir >/dev/null
  if (( !check )); then
    local command
    for command in sudo systemctl systemd-analyze flock runuser curl python3; do
      command -v "$command" >/dev/null || die "Required command not found: $command"
    done
  fi

  log "Fetching origin/main from $repo (your working tree is not modified)."
  git -C "$repo" fetch origin refs/heads/main
  revision=$(git -C "$repo" rev-parse --verify 'FETCH_HEAD^{commit}')
  work=$(mktemp -d /tmp/podcst-img-proxy-deploy.XXXXXX)
  trap 'rm -rf -- "$work"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  mkdir "$work/release"
  git -C "$repo" archive "$revision" | tar -x -C "$work/release"
  [[ -f $work/release/src/index.ts && -f $work/release/bun.lock ]] || die 'Not an img_proxy release.'
  log "Installing locked production dependencies for $revision without lifecycle scripts."
  (cd "$work/release" && "$bun" install --production --frozen-lockfile --ignore-scripts)
  if (( check )); then
    run_tests "$work/release" "$work/test-cache" "$bun"
    log "CHECK PASSED: $revision. Production was not changed."
  else
    sudo /bin/bash "$script" --activate "$work/release" "$revision" "$bun" \
      "$current" "$releases" "$units" "$lock" "$local_health" "$public_health"
  fi
  exit 0
}

if [[ ${1:-} == --activate ]]; then
  shift
  activate "$@"
else
  main "$@"
fi
