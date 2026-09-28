#!/bin/bash
set -euo pipefail

: "${SRCROOT:?}"
: "${TARGET_BUILD_DIR:?}"
: "${UNLOCALIZED_RESOURCES_FOLDER_PATH:?}"
: "${CONFIGURATION:?}"

build_repository="$SRCROOT/.."
build_revision="$(/usr/bin/git -C "$build_repository" rev-parse --verify HEAD)"
build_worktree_status="$(/usr/bin/git --no-optional-locks -C "$build_repository" status --porcelain=v1 --untracked-files=normal)"
build_worktree_dirty=false
if [[ -n "$build_worktree_status" ]]; then
    build_worktree_dirty=true
fi
build_date="$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')"
build_resource_directory="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH"
/bin/mkdir -p "$build_resource_directory"
build_metadata_file="$(/usr/bin/mktemp "$build_resource_directory/.AudioLabBuild.XXXXXX")"
trap '/bin/rm -f "$build_metadata_file"' EXIT

/usr/bin/plutil -create xml1 -- "$build_metadata_file"
/usr/bin/plutil -insert revision -string "$build_revision" -- "$build_metadata_file"
/usr/bin/plutil -insert workingTreeDirty -bool "$build_worktree_dirty" -- "$build_metadata_file"
/usr/bin/plutil -insert builtAt -string "$build_date" -- "$build_metadata_file"
/usr/bin/plutil -insert configuration -string "$CONFIGURATION" -- "$build_metadata_file"
/usr/bin/plutil -convert json -- "$build_metadata_file"
/bin/mv -f "$build_metadata_file" "$build_resource_directory/AudioLabBuild.json"
