# CapCutBot Agent Instructions

## Mission

`capcutbot` is a local CLI for inspecting and safely patching CapCut desktop
drafts. Keep it deterministic, reversible, and grounded in local draft state.

## Working Rules

1. Prefer deterministic inspection and patching over creative automation claims.
2. Preserve backup creation and dry-run safety when changing draft JSON.
3. Keep transcript-backed or proof-backed edit decisions explicit rather than
   inferred from vague heuristics.
4. Write every mutation batch to a brand-new versioned draft. CapCut may stay
   open on another project, but keep the new version unopened until its graph
   and media indexes are complete and verified. Once opened, freeze it against
   bot writes; later work duplicates it again. Restart only when discovery or
   first-open read-back proves it necessary. Trash superseded versions after
   the successor passes
   open/save graph and media-index read-back, retaining the creator source and
   latest verified version.

## Validation

```bash
npm run env
npm test
```
