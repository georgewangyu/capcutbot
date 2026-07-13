import { spawnSync } from 'node:child_process';

export function isCapCutRunning(options = {}) {
    const platform = options.platform || process.platform;
    if (platform !== 'darwin') return false;
    const run = options.run || spawnSync;
    const result = run('pgrep', ['-x', 'CapCut'], { stdio: 'ignore' });
    return result?.status === 0;
}

export function warnIfCapCutRunning(options = {}) {
    if (!isCapCutRunning(options)) return false;
    const write = options.write || console.error;
    const target = options.target ? ` ${options.target}` : '';
    write(`Info: CapCut is running; continuing with${target}. If this exact draft is open in CapCut, a later autosave may overwrite external changes.`);
    return true;
}
