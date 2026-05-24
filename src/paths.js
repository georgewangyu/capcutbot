import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const WORKSPACE_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

export function expandPath(value) {
    if (!value) return value;
    let expanded = value;
    if (expanded === '~' || expanded.startsWith('~/')) {
        expanded = path.join(os.homedir(), expanded.slice(2));
    }
    expanded = expanded.replaceAll('$HOME', os.homedir());
    expanded = expanded.replaceAll('$WORKSPACE', WORKSPACE_ROOT);
    return path.resolve(expanded);
}

export function defaultDraftsDir() {
    return expandPath(process.env.CAPCUTBOT_DRAFTS_DIR)
        || path.join(os.homedir(), 'Movies/CapCut/User Data/Projects/com.lveditor.draft');
}

export function resolveDraftPath(input, options = {}) {
    const raw = expandPath(input);
    const candidates = [];

    if (raw) {
        candidates.push(raw);
        if (!path.isAbsolute(input)) {
            candidates.push(path.join(defaultDraftsDir(), input));
        }
    }

    for (const candidate of candidates) {
        if (!candidate || !fs.existsSync(candidate)) continue;
        const stat = fs.statSync(candidate);
        if (stat.isDirectory()) {
            for (const filename of ['draft_info.json', 'draft_content.json']) {
                const draftFile = path.join(candidate, filename);
                if (fs.existsSync(draftFile)) {
                    return { projectDir: candidate, draftFile };
                }
            }
        }
        if (stat.isFile() && candidate.endsWith('.json')) {
            return { projectDir: path.dirname(candidate), draftFile: candidate };
        }
    }

    if (options.mustExist === false) {
        const fallback = path.isAbsolute(raw) ? raw : path.join(defaultDraftsDir(), input);
        return { projectDir: fallback, draftFile: path.join(fallback, 'draft_info.json') };
    }

    throw new Error(`Could not find CapCut draft from: ${input}`);
}

export function projectMediaPlaceholder() {
    return '##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##';
}
