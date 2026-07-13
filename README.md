# capcutbot - CapCut Draft Automation Client

Local CLI for inspecting and safely patching CapCut desktop drafts.

The first version is focused on short-form editing workflows: inspect a
template, list text/audio timing, transcribe messy voiceover, cut a clean
voiceover with explicit ranges, and replace the draft voiceover with a backed-up
JSON patch.

## Status

This repo is runnable today for local draft inspection, transcript-assisted
voiceover cleanup, and bounded deterministic patching.

## Architecture

```text
capcutbot/
|-- src/
|   |-- cli.js      # Unified CLI
|   |-- audio.js    # ffmpeg/ffprobe and MLX transcription helpers
|   |-- draft.js    # CapCut draft JSON inspection and mutation helpers
|   |-- output.js   # Table/JSON output
|   `-- paths.js    # Workspace, draft, and placeholder path resolution
|-- research/
|   `-- DRAFT_MODEL.md
|-- setup/
|   `-- LOCAL_SETUP.md
|-- test/
|   `-- draft.test.js
|-- README.md
`-- .env.example
```

## Installation

```bash
npm install
```

## Validation

```bash
npm run env
npm test
```

## Usage

Check local tool paths:

```bash
node src/cli.js env
```

Inspect a CapCut project by name:

```bash
node src/cli.js info "AI VERSION TEMPLATE"
```

List draft text overlays:

```bash
node src/cli.js texts "AI VERSION TEMPLATE"
```

Duplicate a draft into a new project folder:

```bash
node src/cli.js duplicate "AI VERSION TEMPLATE" "AI VERSION TEMPLATE - next reel"
```

Replace a text overlay by material id:

```bash
node src/cli.js replace-text "AI VERSION TEMPLATE - next reel" \
  --material-id "TEXT-MATERIAL-ID" \
  --text $'5 AI Skills I\nWish I Knew Last Year'
```

Update an existing text overlay's content, timing, or position while preserving
its CapCut style:

```bash
node src/cli.js update-text-overlay "Example Project" \
  --match "Template heading" \
  --text "Updated heading" \
  --start 21.54 \
  --duration 41.493 \
  --x 0.18 \
  --y -0.18 \
  --first
```

Reposition or resize an existing video overlay without replacing its media:

```bash
node src/cli.js update-video-overlay "Example Project" \
  --material-id "VIDEO-MATERIAL-ID" \
  --scale 0.82 \
  --x 0 \
  --y 0.28 \
  --dry-run
```

Clone a styled text overlay from a template draft, including its referenced
extra materials, at an exact target time:

```bash
node src/cli.js add-text-overlay "Example Project" \
  --source "Styled Overlay Template" \
  --source-text "Template heading" \
  --text "Updated heading" \
  --start 4.0 \
  --duration 1.5 \
  --dry-run
```

Add a positioned video overlay by cloning a known-good video segment/material
shape from the target draft or another draft. Use `--source` when the target's
only video is a compound clip. Omit the transform flags to inherit the archetype
transform:

```bash
node src/cli.js add-video-overlay "Example Project" /path/to/overlay.mp4 \
  --source "Known Good Overlay Draft" \
  --archetype-material-id "VIDEO-MATERIAL-ID" \
  --start 4.0 \
  --duration 1.5 \
  --scale 0.7 \
  --x -0.25 \
  --y 0.2 \
  --dry-run
```

List draft audio tracks:

```bash
node src/cli.js audio "AI VERSION TEMPLATE"
```

Add a sound effect by cloning a known-good audio archetype from another draft.
The media is copied into the target project only when `--dry-run` is removed:

```bash
node src/cli.js add-audio-overlay "Example Project" /path/to/effect.mp3 \
  --source "Audio Overlay Template" \
  --archetype-material-id "AUDIO-MATERIAL-ID" \
  --start 9.633333 \
  --duration 0.366667 \
  --volume 0.29690104722976685 \
  --type sound \
  --dry-run
```

Transcribe a raw voiceover with the local MLX Whisper helper:

```bash
node src/cli.js transcribe /path/to/raw-voiceover.wav --outdir /tmp/capcutbot-transcripts
```

`--outdir` is required so generated transcripts are written to an explicit
private working directory rather than into the source checkout.

Cut a cleaned voiceover from selected transcript ranges:

```bash
node src/cli.js clean-voiceover /path/to/raw-voiceover.wav \
  --ranges 0.54-47.45,53.8-58.42,64.93-80.23,87.29-109.9 \
  --out /tmp/clean-voiceover.aac
```

Replace the voiceover in a draft:

```bash
node src/cli.js replace-voiceover "AI VERSION TEMPLATE" /tmp/clean-voiceover.aac \
  --name "clean voiceover" \
  --extend-duration
```

Use `--dry-run` first when testing a new draft shape:

```bash
node src/cli.js replace-voiceover "AI VERSION TEMPLATE" /tmp/clean-voiceover.aac \
  --name "clean voiceover" \
  --extend-duration \
  --dry-run
```

## Safety Rules

- Create a brand-new versioned draft for every CapCutBot mutation batch. Never
  patch a draft after it has been opened in CapCut; duplicate the saved version
  for the next pass.
- CapCut may remain open on another project while CapCutBot assembles the
  unopened target. Do not open the target until the graph and Media indexes are
  complete and verified. Restart only if discovery or first-open read-back
  shows that the current session retained stale metadata.
- Once CapCut opens and saves a generated version, freeze it against bot writes.
  Read back the graph and indexes; perform later work in another new version.
- Keep the creator source and latest verified bot version. Move superseded bot
  versions to Trash only after the successor passes open/save read-back.
- Every draft write creates a timestamped `.bak` beside the draft JSON.
- Modern CapCut timeline projects keep matching root and nested graph files;
  CapCutBot updates and backs up all canonical copies together.
- The bot only makes deterministic draft patches. Creative edit decisions should
  still live in the editing runbook or agent notes.
- Prefer transcript-backed voiceover ranges over guessing from the waveform.

## Current Scope

Supported now:

- Draft summary.
- Text overlay timing inventory.
- Draft duplication into a new project folder.
- Text material replacement with dry-run and backup support.
- Audio segment inventory.
- MLX Whisper transcription bridge.
- ffmpeg voiceover range cleanup.
- Single voiceover replacement with project-local media copy and backup.
- Full-frame video overlay insertion with exact timing and project-local media copy.
- Compound/nested video archetype rejection; use `--source` with a known-good ordinary overlay draft when the target contains only a compound A-cut.
- Cross-draft styled text overlay cloning with referenced material remapping.
- Cross-draft audio overlay insertion with exact timing, volume, referenced-material remapping, and project-local media copy.
- Audio-overlay localization to an existing `capcutbot_media/` file, avoiding volatile CapCut cache references.

```bash
node src/cli.js localize-audio-overlay-media "PROJECT" \
  --material-id AUDIO_MATERIAL_ID \
  --filename transition-pop.mp3
```

Planned next:

- Retiming overlays from a transcript-backed edit decision list.
- Proof-asset manifest checks.
- Missing media/path linting.
- Pop SFX alignment reports.

## Goals

- Keep draft inspection and patching deterministic.
- Preserve backups and dry-run behavior as the default safety layer.
- Build toward proof-led edit planning rather than generic one-click video AI.
