---
doc_schema: "doc-frontmatter-v1"
doc_id: "capcutbot/README"
doc_type: "readme"
doc_status: "active"
title: "capcutbot - CapCut Draft Automation Client"
description: "CLI for inspecting and safely patching local CapCut desktop drafts."
memory_eligible: false
memory_priority: "low"
doc_tags:
  - "domain:social-media"
  - "tool:capcutbot"
  - "type:readme"
---
# capcutbot - CapCut Draft Automation Client

Local CLI for inspecting and safely patching CapCut desktop drafts.

The first version is focused on George's short-form editing workflow: inspect a
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

List draft audio tracks:

```bash
node src/cli.js audio "AI VERSION TEMPLATE"
```

Transcribe a raw voiceover with the local MLX Whisper helper:

```bash
node src/cli.js transcribe /path/to/raw-voiceover.wav --outdir /tmp/capcutbot-transcripts
```

Cut a cleaned voiceover from selected transcript ranges:

```bash
node src/cli.js clean-voiceover /path/to/raw-voiceover.wav \
  --ranges 0.54-47.45,53.8-58.42,64.93-80.23,87.29-109.9 \
  --out /tmp/move_paycheck_voiceover_clean.aac
```

Replace the voiceover in a draft:

```bash
node src/cli.js replace-voiceover "AI VERSION TEMPLATE" /tmp/move_paycheck_voiceover_clean.aac \
  --name "move paycheck voiceover clean" \
  --extend-duration
```

Use `--dry-run` first when testing a new draft shape:

```bash
node src/cli.js replace-voiceover "AI VERSION TEMPLATE" /tmp/move_paycheck_voiceover_clean.aac \
  --name "move paycheck voiceover clean" \
  --extend-duration \
  --dry-run
```

## Safety Rules

- Close the CapCut project before applying mutations. CapCut can overwrite direct
  draft JSON edits while a project is open.
- Every draft write creates a timestamped `.bak` beside the draft JSON.
- The bot only makes deterministic draft patches. Creative edit decisions should
  still live in the editing runbook or agent notes.
- Prefer transcript-backed voiceover ranges over guessing from the waveform.

## Current Scope

Supported now:

- Draft summary.
- Text overlay timing inventory.
- Audio segment inventory.
- MLX Whisper transcription bridge.
- ffmpeg voiceover range cleanup.
- Single voiceover replacement with project-local media copy and backup.

Planned next:

- Retiming overlays from a transcript-backed edit decision list.
- Proof-asset manifest checks.
- Missing media/path linting.
- Pop SFX alignment reports.

## Goals

- Keep draft inspection and patching deterministic.
- Preserve backups and dry-run behavior as the default safety layer.
- Build toward proof-led edit planning rather than generic one-click video AI.
