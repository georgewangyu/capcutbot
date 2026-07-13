# CapCut Draft Model Notes

CapCut desktop projects are local folders under the user draft directory. The bot
currently targets `draft_info.json`, which contains project-level metadata,
track arrays, and material arrays.

Important invariants:

- `tracks[]` contains timeline segments. Segment timing is stored in microseconds.
- `materials.audios[]`, `materials.texts[]`, and `materials.videos[]` hold the
  referenced media metadata.
- A segment references its material by `segment.material_id`.
- Replacing audio safely means updating both the segment timing and the matching
  audio material metadata.
- Draft media copied into the project usually lives under folders like
  `audio_record/` and is referenced through CapCut's draft-path placeholder.
- CapCut can overwrite direct JSON edits to the exact draft it is actively
  autosaving. CapCutBot may still create or patch a separately named draft while
  the app is open; it reports the running state without blocking the operation.

Current editing bias:

- Use the bot for deterministic JSON surgery and media cutting.
- Use the editing agent/runbook for creative decisions: what to cut, what proof
  assets matter, and how overlays should be retimed.
- Keep every mutation backed up before writing.
