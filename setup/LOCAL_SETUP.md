# Local Setup

Install dependencies:

```bash
npm install
```

Check the local environment:

```bash
node src/cli.js env
```

Expected local tools:

- `ffmpeg` and `ffprobe` for voiceover cutting and duration measurement.
- The MLX Whisper helper in `../georgeskills/scripts/transcription/` for fast
  local transcription.
- CapCut desktop drafts under
  `~/Movies/CapCut/User Data/Projects/com.lveditor.draft`.

Override paths through shell env:

```env
CAPCUTBOT_DRAFTS_DIR="$HOME/Movies/CapCut/User Data/Projects/com.lveditor.draft"
CAPCUTBOT_TRANSCRIBER="$WORKSPACE/georgeskills/scripts/transcription/mlx_transcriber.py"
CAPCUTBOT_TRANSCRIBER_PYTHON="$WORKSPACE/georgeskills/scripts/transcription/venv/bin/python"
```
