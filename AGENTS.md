# CapCutBot Agent Instructions

## Mission

`capcutbot` is a local CLI for inspecting and safely patching CapCut desktop
drafts. Keep it deterministic, reversible, and grounded in local draft state.

## Working Rules

1. Prefer deterministic inspection and patching over creative automation claims.
2. Preserve backup creation and dry-run safety when changing draft JSON.
3. Keep transcript-backed or proof-backed edit decisions explicit rather than
   inferred from vague heuristics.

## Validation

```bash
npm run env
npm test
```
