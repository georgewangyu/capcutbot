import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expandPath, WORKSPACE_ROOT } from './paths.js';

export function hasCommand(command) {
    const result = spawnSync('which', [command], { encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : '';
}

export function ffprobeDuration(file) {
    const result = spawnSync('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        file,
    ], { encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(`ffprobe failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }
    const duration = Number.parseFloat(result.stdout.trim());
    if (!Number.isFinite(duration)) throw new Error(`Could not parse ffprobe duration for ${file}`);
    return duration;
}

export function parseRanges(value) {
    if (!value) throw new Error('Missing --ranges value');
    return value.split(',').map((part) => {
        const [startRaw, endRaw] = part.split('-');
        const start = Number.parseFloat(startRaw);
        const end = Number.parseFloat(endRaw);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
            throw new Error(`Invalid range "${part}". Expected start-end seconds, like 0.54-47.45`);
        }
        return { start, end };
    });
}

export function cleanVoiceover(input, output, ranges) {
    if (!ranges.length) throw new Error('At least one range is required');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const filters = ranges
        .map((range, index) => `[0:a]atrim=start=${range.start}:end=${range.end},asetpts=PTS-STARTPTS[a${index}]`)
        .join(';');
    const concatInputs = ranges.map((_, index) => `[a${index}]`).join('');
    const filterComplex = `${filters};${concatInputs}concat=n=${ranges.length}:v=0:a=1[out]`;
    const result = spawnSync('ffmpeg', [
        '-hide_banner',
        '-y',
        '-i', input,
        '-filter_complex', filterComplex,
        '-map', '[out]',
        '-c:a', 'aac',
        '-b:a', '192k',
        output,
    ], { encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(`ffmpeg failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }
    return { output, durationSeconds: ffprobeDuration(output) };
}

export function transcriberConfig() {
    return {
        python: expandPath(process.env.CAPCUTBOT_TRANSCRIBER_PYTHON)
            || path.join(WORKSPACE_ROOT, 'georgeskills/scripts/transcription/venv/bin/python'),
        script: expandPath(process.env.CAPCUTBOT_TRANSCRIBER)
            || path.join(WORKSPACE_ROOT, 'georgeskills/scripts/transcription/mlx_transcriber.py'),
    };
}

export function transcribeAudio(input, outdir) {
    const config = transcriberConfig();
    if (!fs.existsSync(config.python)) throw new Error(`Transcriber Python not found: ${config.python}`);
    if (!fs.existsSync(config.script)) throw new Error(`Transcriber script not found: ${config.script}`);
    fs.mkdirSync(outdir, { recursive: true });
    const result = spawnSync(config.python, [config.script, input, '--outdir', outdir], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0) {
        throw new Error(`transcriber failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim(), outdir };
}
