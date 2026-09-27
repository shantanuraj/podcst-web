# Reference listening corpus

The local X Minus One episode is a useful listening reference because it has
narration, music, noise, and pauses:

```text
/tmp/podcst-reference/x-minus-one--a-pail-of-air--1956-03-28.mp3
```

Keep the source outside the repository. Generate deterministic PCM copies for
local analysis and listening tests:

```sh
SOURCE=/tmp/podcst-reference/x-minus-one--a-pail-of-air--1956-03-28.mp3

ffmpeg -hide_banner -loglevel error -y \
  -i "$SOURCE" -ar 48000 -ac 1 -c:a pcm_s16le \
  /tmp/podcst-reference/a-pail-of-air.wav

ffmpeg -hide_banner -loglevel error -y \
  -i "$SOURCE" -af volume=-18dB -ar 48000 -ac 1 -c:a pcm_s16le \
  /tmp/podcst-reference/a-pail-of-air-minus18db.wav
```

Analyze the source and a controlled level variant:

```sh
cargo run --manifest-path audio-engine/Cargo.toml -- \
  analyze /tmp/podcst-reference/a-pail-of-air-minus18db.wav --json

cargo run --manifest-path audio-engine/Cargo.toml -- \
  process \
  /tmp/podcst-reference/a-pail-of-air-minus18db.wav \
  /tmp/podcst-reference/a-pail-of-air-processed.wav \
  --boost --adaptive-silence --limit --json
```

For a short A/B set around a known point in the episode:

```sh
audio-engine/reference/make-listening-clips.sh "$SOURCE" /tmp/podcst-reference/clips
```

The script creates original, level-reduced, boost-only, and adaptive-trimmed
30-second WAV files plus JSON timeline reports. It does not add media to git.

The `-18 dB` copy is useful for checking that normalization restores perceived
level without merely clipping. With the current default `+12 dB` gain cap it
will intentionally remain below the `-14 LUFS` target; the `-6 dB` copy is a
better target-tracking case.

The current experiment reports approximately:

| Input         | Input LUFS | Processed LUFS |               Processed true peak by FFmpeg |
| ------------- | ---------: | -------------: | ------------------------------------------: |
| `-6 dB` copy  |    `-26.0` |        `-15.0` |                                 `-1.1 dBFS` |
| `-18 dB` copy |    `-38.0` |        `-26.0` | not target-tracking because of the gain cap |

The current 30-second clip generated at the script's 300-second offset
condenses from 30.0 seconds to about 24.6 seconds with the default adaptive
settings. It retains a portion of each detected pause instead of deleting the
whole pause and applies an 8 ms boundary fade.

These are listening-test observations. Creating a level variant with FFmpeg
changes the PCM representation, so use it for relative behavior and listening
comparisons, not exact waveform equality.
