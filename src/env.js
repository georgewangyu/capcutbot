import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WORKSPACE_ROOT } from './paths.js';

export function loadEnvFiles() {
    const candidates = [
        path.join(WORKSPACE_ROOT, 'capcutbot/.env'),
        path.join(os.homedir(), '.config/capcutbot/.env'),
        process.env.CAPCUTBOT_ENV_FILE,
    ].filter(Boolean);

    for (const file of candidates) {
        if (!fs.existsSync(file)) continue;
        const content = fs.readFileSync(file, 'utf8');
        for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const equalsIndex = trimmed.indexOf('=');
            if (equalsIndex <= 0) continue;
            const key = trimmed.slice(0, equalsIndex).trim();
            const rawValue = trimmed.slice(equalsIndex + 1).trim();
            if (process.env[key] !== undefined) continue;
            process.env[key] = unquote(rawValue)
                .replaceAll('$HOME', os.homedir())
                .replaceAll('$WORKSPACE', WORKSPACE_ROOT);
        }
    }
}

function unquote(value) {
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}
