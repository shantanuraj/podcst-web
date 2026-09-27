#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fixture="$DERIVED_FILE_DIR/progressive-vbr.mp3"
ffmpeg -v error -f lavfi -i 'anoisesrc=color=pink:sample_rate=48000:duration=90:seed=17:amplitude=0.15' -c:a libmp3lame -q:a 4 -id3v2_version 0 -y "$fixture"
surround="$DERIVED_FILE_DIR/fallback-surround.m4a"
ffmpeg -v error -f lavfi -i 'aevalsrc=0.2*sin(2*PI*440*t)|0|0|0|0|0:s=48000:d=1' -c:a aac -b:a 384k -ac 6 -channel_layout 5.1 -y "$surround"
mkdir -p "$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH"
cp "$fixture" "$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/progressive-vbr.mp3"
cp "$surround" "$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/fallback-surround.m4a"
