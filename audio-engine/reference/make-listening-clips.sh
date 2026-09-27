#!/bin/sh
set -eu

source=${1:-/tmp/podcst-reference/x-minus-one--a-pail-of-air--1956-03-28.mp3}
output=${2:-/tmp/podcst-reference/clips}
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
mkdir -p "$output"

ffmpeg -hide_banner -loglevel error -y \
  -ss 300 -t 30 -i "$source" -ar 48000 -ac 1 -c:a pcm_s16le \
  "$output/original.wav"

ffmpeg -hide_banner -loglevel error -y \
  -ss 300 -t 30 -i "$source" -af volume=-6dB -ar 48000 -ac 1 -c:a pcm_s16le \
  "$output/minus6db.wav"

cargo run --release --quiet --manifest-path "$root/audio-engine/Cargo.toml" -- \
  process "$output/minus6db.wav" "$output/minus6db-boost-limit.wav" \
  --boost --limit --json > "$output/minus6db-boost-limit.json"

cargo run --release --quiet --manifest-path "$root/audio-engine/Cargo.toml" -- \
  process "$output/minus6db.wav" "$output/minus6db-adaptive.wav" \
  --boost --adaptive-silence --limit --json > "$output/minus6db-adaptive.json"

printf '%s\n' "$output"
