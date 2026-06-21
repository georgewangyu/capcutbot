#!/usr/bin/env node

import { Command } from 'commander';
import path from 'node:path';
import { cleanVoiceover, ffprobeDuration, hasCommand, parseRanges, transcribeAudio, transcriberConfig } from './audio.js';
import { draftSummary, duplicateDraftProject, listAudioSegments, listTextSegments, loadDraft, replaceText, replaceVoiceover, saveDraft, secondsToMicros } from './draft.js';
import { loadEnvFiles } from './env.js';
import { defaultDraftsDir, expandPath } from './paths.js';
import { printJson, printRows } from './output.js';

loadEnvFiles();

const program = new Command();

function parseNumber(value) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
    return parsed;
}

program
    .name('capcutbot')
    .description('Local CapCut desktop draft inspection and patching CLI')
    .version('0.1.0');

program
    .command('env')
    .description('Show resolved local CapCut bot tool state')
    .action(() => {
        const transcriber = transcriberConfig();
        printJson({
            draftsDir: defaultDraftsDir(),
            ffmpeg: hasCommand('ffmpeg'),
            ffprobe: hasCommand('ffprobe'),
            transcriberPython: transcriber.python,
            transcriberScript: transcriber.script,
            envFiles: ['capcutbot/.env', '~/.config/capcutbot/.env', 'shell environment'],
        });
    });

program
    .command('info <project>')
    .description('Summarize a CapCut draft by project name, directory, or draft JSON path')
    .option('--format <format>', 'Output format: table or json', 'json')
    .action((project, options) => {
        try {
            const { projectDir, draftFile, draft } = loadDraft(project);
            const summary = { projectDir, draftFile, ...draftSummary(draft) };
            printJson(summary);
        } catch (error) {
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command('duplicate <source> <target>')
    .description('Duplicate a CapCut draft folder by project name or path')
    .option('--dry-run', 'Print planned copy without creating the target project')
    .action((source, target, options) => {
        try {
            printJson(duplicateDraftProject(source, target, { dryRun: Boolean(options.dryRun) }));
        } catch (error) {
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command('texts <project>')
    .description('List text overlays and timings')
    .option('--format <format>', 'Output format: table or json', 'table')
    .action((project, options) => {
        try {
            const rows = listTextSegments(loadDraft(project).draft);
            if (options.format === 'json') return printJson(rows);
            printRows(rows, [
                { label: 'track', get: (row) => row.trackIndex },
                { label: 'start', get: (row) => row.startSeconds },
                { label: 'dur', get: (row) => row.durationSeconds },
                { label: 'text', get: (row) => row.text },
            ]);
        } catch (error) {
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command('replace-text <project>')
    .description('Replace a text material in a CapCut draft')
    .requiredOption('--text <text>', 'Replacement text')
    .option('--material-id <id>', 'Exact text material id to replace')
    .option('--match <text>', 'Existing text substring to match')
    .option('--first', 'Replace the first matching material when match is ambiguous')
    .option('--dry-run', 'Print planned patch without writing the draft')
    .action((project, options) => {
        try {
            const loaded = loadDraft(project);
            const result = replaceText(loaded.draft, {
                text: options.text,
                materialId: options.materialId,
                match: options.match,
                first: Boolean(options.first),
            });
            const save = saveDraft(loaded.draftFile, loaded.draft, {
                dryRun: Boolean(options.dryRun),
                backupLabel: 'capcutbot-pre-text',
            });
            printJson({ projectDir: loaded.projectDir, draftFile: loaded.draftFile, ...result, ...save });
        } catch (error) {
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command('audio <project>')
    .description('List audio segments and material paths')
    .option('--format <format>', 'Output format: table or json', 'table')
    .action((project, options) => {
        try {
            const rows = listAudioSegments(loadDraft(project).draft);
            if (options.format === 'json') return printJson(rows);
            printRows(rows, [
                { label: 'track', get: (row) => row.trackIndex },
                { label: 'start', get: (row) => row.startSeconds },
                { label: 'dur', get: (row) => row.durationSeconds },
                { label: 'type', get: (row) => row.type },
                { label: 'name', get: (row) => row.name },
            ]);
        } catch (error) {
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command('clean-voiceover <audio>')
    .description('Cut a messy voiceover into selected ranges using ffmpeg')
    .requiredOption('--ranges <ranges>', 'Comma-separated second ranges, e.g. 0.54-47.45,53.8-58.42')
    .requiredOption('--out <file>', 'Output audio file')
    .action((audio, options) => {
        try {
            const input = expandPath(audio);
            const output = expandPath(options.out);
            const result = cleanVoiceover(input, output, parseRanges(options.ranges));
            printJson(result);
        } catch (error) {
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command('replace-voiceover <project> <audio>')
    .description('Replace the first matching voiceover/record audio segment in a draft')
    .option('--match <text>', 'Audio material name/type/path text to match', 'voiceover')
    .option('--name <name>', 'New material name')
    .option('--filename <filename>', 'Filename to copy into audio_record/')
    .option('--duration <seconds>', 'Override audio duration in seconds', parseNumber)
    .option('--volume <number>', 'Override segment volume', parseNumber)
    .option('--extend-duration', 'Extend draft duration to the new voiceover length')
    .option('--keep-material-id', 'Keep the existing audio material id')
    .option('--dry-run', 'Print planned patch without writing draft or copying media')
    .action((project, audio, options) => {
        try {
            const loaded = loadDraft(project);
            const audioPath = expandPath(audio);
            const durationSeconds = options.duration ?? ffprobeDuration(audioPath);
            const result = replaceVoiceover(loaded.draft, loaded.projectDir, audioPath, {
                ...options,
                durationMicros: secondsToMicros(durationSeconds),
            });
            const save = saveDraft(loaded.draftFile, loaded.draft, {
                dryRun: Boolean(options.dryRun),
                backupLabel: 'capcutbot-pre-voiceover',
            });
            printJson({ projectDir: loaded.projectDir, draftFile: loaded.draftFile, ...result, ...save });
        } catch (error) {
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command('transcribe <audio>')
    .description('Transcribe an audio file through the local MLX Whisper helper')
    .option('--outdir <dir>', 'Transcript output directory', path.join(process.cwd(), 'transcripts'))
    .action((audio, options) => {
        try {
            const result = transcribeAudio(expandPath(audio), expandPath(options.outdir));
            printJson(result);
        } catch (error) {
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    });

program.parse();
