# CapCutBot Vision

`capcutbot` should be a deterministic local CLI for inspecting and safely
patching CapCut desktop drafts.

## Product Thesis

The useful product is not generic video automation. The useful product is an
operator tool that understands local draft state, shows timing and media facts,
and applies reversible edits only when the decision is explicit and
proof-backed.

## Goals

- Keep draft inspection and mutation deterministic.
- Preserve backups, dry-run behavior, and local path checks.
- Make transcript-backed edit decisions easier to apply.
- Build toward proof-asset manifests and timing linting before creative
  automation.

## Non-Goals

- Do not pretend to be a one-click creative editor.
- Do not patch open CapCut projects without warning.
- Do not infer edit decisions from vague heuristics when transcript evidence is
  available.
