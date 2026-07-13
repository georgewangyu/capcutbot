#!/usr/bin/env node

import { Command } from 'commander';
import path from 'node:path';
import { cleanVoiceover, ffprobeDuration, ffprobeVideoMetadata, hasCommand, parseRanges, transcribeAudio, transcriberConfig } from './audio.js';
import { addAudioOverlayFromDraft, addTextOverlayFromDraft, addVideoOverlay, draftSummary, duplicateDraftProject, importProjectVideoMedia, listAudioSegments, listTextSegments, loadDraft, localizeAudioOverlayMedia, refreshVideoOverlayMetadata, removeTextOverlays, repairProjectVideoMediaIndex, replaceText, replaceVoiceover, saveDraft, secondsToMicros, updateAudioOverlay, updateTextOverlay, updateVideoOverlay } from './draft.js';
import { loadEnvFiles } from './env.js';
import { warnIfCapCutRunning } from './capcut.js';
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
            if (!options.dryRun) warnIfCapCutRunning({ target });
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
            if (!options.dryRun) warnIfCapCutRunning({ target: project });
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
    .command('add-text-overlay <project>')
    .description('Clone a styled text overlay from another draft with exact timing')
    .requiredOption('--source <project>', 'Source draft name, directory, or JSON path')
    .requiredOption('--source-text <text>', 'Exact source text to match')
    .requiredOption('--text <text>', 'Replacement text')
    .requiredOption('--start <seconds>', 'Target start in seconds', parseNumber)
    .requiredOption('--duration <seconds>', 'Target duration in seconds', parseNumber)
    .option('--first', 'Use the first segment when the exact source text occurs more than once')
    .option('--dry-run', 'Print planned patch without writing the draft')
    .action((project, options) => {
        try {
            if (!options.dryRun) warnIfCapCutRunning({ target: project });
            const loaded = loadDraft(project);
            const source = loadDraft(options.source);
            const result = addTextOverlayFromDraft(loaded.draft, source.draft, {
                sourceText: options.sourceText,
                text: options.text,
                startMicros: secondsToMicros(options.start),
                durationMicros: secondsToMicros(options.duration),
                first: Boolean(options.first),
            });
            const save = saveDraft(loaded.draftFile, loaded.draft, {
                dryRun: Boolean(options.dryRun),
                backupLabel: 'capcutbot-pre-text-overlay',
            });
            printJson({ projectDir: loaded.projectDir, draftFile: loaded.draftFile, sourceDraftFile: source.draftFile, ...result, ...save });
        } catch (error) {
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command('update-text-overlay <project>')
    .description('Update an existing text overlay content, timing, or position')
    .option('--material-id <id>', 'Exact text material id to update')
    .option('--match <text>', 'Existing text substring to match')
    .option('--text <text>', 'Replacement text')
    .option('--start <seconds>', 'Target start in seconds', parseNumber)
    .option('--duration <seconds>', 'Target duration in seconds', parseNumber)
    .option('--scale <number>', 'Uniform text scale override', parseNumber)
    .option('--x <number>', 'Horizontal clip transform override', parseNumber)
    .option('--y <number>', 'Vertical clip transform override', parseNumber)
    .option('--first', 'Update the first matching segment when match is ambiguous')
    .option('--dry-run', 'Print planned patch without writing the draft')
    .action((project, options) => {
        try {
            if (!options.dryRun) warnIfCapCutRunning({ target: project });
            const loaded = loadDraft(project);
            const result = updateTextOverlay(loaded.draft, {
                materialId: options.materialId,
                match: options.match,
                text: options.text,
                startMicros: options.start === undefined ? undefined : secondsToMicros(options.start),
                durationMicros: options.duration === undefined ? undefined : secondsToMicros(options.duration),
                scale: options.scale,
                x: options.x,
                y: options.y,
                first: Boolean(options.first),
            });
            const save = saveDraft(loaded.draftFile, loaded.draft, {
                dryRun: Boolean(options.dryRun),
                backupLabel: 'capcutbot-pre-text-update',
            });
            printJson({ projectDir: loaded.projectDir, draftFile: loaded.draftFile, ...result, ...save });
        } catch (error) {
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command('update-video-overlay <project>')
    .description('Update an existing video overlay timing or position')
    .requiredOption('--material-id <id>', 'Exact video material id to update')
    .option('--start <seconds>', 'Target start in seconds', parseNumber)
    .option('--duration <seconds>', 'Target duration in seconds', parseNumber)
    .option('--scale <number>', 'Uniform clip scale override', parseNumber)
    .option('--x <number>', 'Horizontal clip transform override', parseNumber)
    .option('--y <number>', 'Vertical clip transform override', parseNumber)
    .option('--dry-run', 'Print planned patch without writing the draft')
    .action((project, options) => {
        try {
            if (!options.dryRun) warnIfCapCutRunning({ target: project });
            const loaded = loadDraft(project);
            const result = updateVideoOverlay(loaded.draft, {
                materialId: options.materialId,
                startMicros: options.start === undefined ? undefined : secondsToMicros(options.start),
                durationMicros: options.duration === undefined ? undefined : secondsToMicros(options.duration),
                scale: options.scale,
                x: options.x,
                y: options.y,
            });
            const save = saveDraft(loaded.draftFile, loaded.draft, {
                dryRun: Boolean(options.dryRun),
                backupLabel: 'capcutbot-pre-video-update',
            });
            printJson({ projectDir: loaded.projectDir, draftFile: loaded.draftFile, ...result, ...save });
        } catch (error) {
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command('update-audio-overlay <project>')
    .description('Update an existing audio overlay timing or volume')
    .requiredOption('--material-id <id>', 'Exact audio material id to update')
    .option('--start <seconds>', 'Target start in seconds', parseNumber)
    .option('--duration <seconds>', 'Target duration in seconds', parseNumber)
    .option('--volume <number>', 'Segment volume', parseNumber)
    .option('--dry-run', 'Print planned patch without writing the draft')
    .action((project, options) => {
        try {
            if (!options.dryRun) warnIfCapCutRunning({ target: project });
            const loaded = loadDraft(project);
            const result = updateAudioOverlay(loaded.draft, {
                materialId: options.materialId,
                startMicros: options.start === undefined ? undefined : secondsToMicros(options.start),
                durationMicros: options.duration === undefined ? undefined : secondsToMicros(options.duration),
                volume: options.volume,
            });
            const save = saveDraft(loaded.draftFile, loaded.draft, {
                dryRun: Boolean(options.dryRun),
                backupLabel: 'capcutbot-pre-audio-update',
            });
            printJson({ projectDir: loaded.projectDir, draftFile: loaded.draftFile, ...result, ...save });
        } catch (error) {
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command('localize-audio-overlay-media <project>')
    .description('Repoint an audio overlay to an existing project-local CapCutBot media file')
    .requiredOption('--material-id <id>', 'Exact audio material id to localize')
    .requiredOption('--filename <filename>', 'Existing filename inside capcutbot_media/')
    .option('--dry-run', 'Print the planned path change without writing the draft')
    .action((project, options) => {
        try {
            if (!options.dryRun) warnIfCapCutRunning({ target: project });
            const loaded = loadDraft(project);
            const result = localizeAudioOverlayMedia(loaded.draft, loaded.projectDir, options);
            const save = saveDraft(loaded.draftFile, loaded.draft, {
                dryRun: Boolean(options.dryRun),
                backupLabel: 'capcutbot-pre-audio-localize',
            });
            printJson({ projectDir: loaded.projectDir, draftFile: loaded.draftFile, ...result, ...save });
        } catch (error) {
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command('remove-text-overlays <project>')
    .description('Remove text overlay tracks while optionally preserving selected text or material ids')
    .option('--keep-text <text...>', 'Preserve overlays whose text exactly matches one of these values')
    .option('--keep-material-id <id...>', 'Preserve overlays with one of these exact material ids')
    .option('--dry-run', 'Print planned removal without writing the draft')
    .action((project, options) => {
        try {
            if (!options.dryRun) warnIfCapCutRunning({ target: project });
            const loaded = loadDraft(project);
            const result = removeTextOverlays(loaded.draft, {
                keepTexts: options.keepText || [],
                keepMaterialIds: options.keepMaterialId || [],
            });
            const save = saveDraft(loaded.draftFile, loaded.draft, {
                dryRun: Boolean(options.dryRun),
                backupLabel: 'capcutbot-pre-text-removal',
            });
            printJson({ projectDir: loaded.projectDir, draftFile: loaded.draftFile, ...result, ...save });
        } catch (error) {
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command('add-video-overlay <project> <video>')
    .description('Add a positioned video overlay from a known-good video archetype')
    .requiredOption('--start <seconds>', 'Target start in seconds', parseNumber)
    .requiredOption('--duration <seconds>', 'Target duration in seconds', parseNumber)
    .option('--source-start <seconds>', 'Source start in seconds', parseNumber, 0)
    .option('--source <project>', 'Draft containing the video archetype (defaults to the target draft)')
    .option('--archetype-material-id <id>', 'Video material id whose segment/track shape should be cloned')
    .option('--filename <filename>', 'Filename to copy into capcutbot_media/')
    .option('--name <name>', 'New material display name')
    .option('--scale <number>', 'Uniform clip scale override', parseNumber)
    .option('--x <number>', 'Horizontal clip transform override', parseNumber)
    .option('--y <number>', 'Vertical clip transform override', parseNumber)
    .option('--dry-run', 'Print planned patch without writing the draft or copying media')
    .action((project, video, options) => {
        try {
            if (!options.dryRun) warnIfCapCutRunning({ target: project });
            const loaded = loadDraft(project);
            const source = options.source ? loadDraft(options.source) : loaded;
            const videoPath = expandPath(video);
            const mediaMetadata = ffprobeVideoMetadata(videoPath);
            const assetDurationMicros = secondsToMicros(mediaMetadata.durationSeconds);
            const result = addVideoOverlay(loaded.draft, loaded.projectDir, videoPath, {
                ...options,
                sourceDraft: source.draft,
                dryRun: Boolean(options.dryRun),
                startMicros: secondsToMicros(options.start),
                durationMicros: secondsToMicros(options.duration),
                sourceStartMicros: secondsToMicros(options.sourceStart),
                assetDurationMicros,
                mediaMetadata,
            });
            const mediaIndex = repairProjectVideoMediaIndex(loaded.draft, loaded.projectDir, {
                dryRun: Boolean(options.dryRun),
            });
            const save = saveDraft(loaded.draftFile, loaded.draft, {
                dryRun: Boolean(options.dryRun),
                backupLabel: 'capcutbot-pre-video-overlay',
            });
            printJson({ projectDir: loaded.projectDir, draftFile: loaded.draftFile, sourceDraftFile: source.draftFile, ...result, mediaIndex, ...save });
        } catch (error) {
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command('import-media <project> <video>')
    .description('Copy a video into project-local media and create a CapCut-style Media-panel import record')
    .option('--filename <filename>', 'Filename to use inside capcutbot_media/')
    .option('--dry-run', 'Print the planned import without copying media or writing indexes')
    .action((project, video, options) => {
        try {
            if (!options.dryRun) warnIfCapCutRunning({ target: project });
            const loaded = loadDraft(project);
            const videoPath = expandPath(video);
            const mediaMetadata = ffprobeVideoMetadata(videoPath);
            const result = importProjectVideoMedia(loaded.projectDir, videoPath, mediaMetadata, {
                filename: options.filename,
                dryRun: Boolean(options.dryRun),
                durationMicros: secondsToMicros(mediaMetadata.durationSeconds),
            });
            printJson({ projectDir: loaded.projectDir, draftFile: loaded.draftFile, sourcePath: videoPath, ...result });
        } catch (error) {
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command('repair-media-index <project>')
    .description('Register project-local CapCutBot video assets in CapCut\'s Media panel index')
    .option('--dry-run', 'Print planned registrations without writing the draft or media indexes')
    .action((project, options) => {
        try {
            if (!options.dryRun) warnIfCapCutRunning({ target: project });
            const loaded = loadDraft(project);
            const result = repairProjectVideoMediaIndex(loaded.draft, loaded.projectDir, {
                dryRun: Boolean(options.dryRun),
            });
            const save = saveDraft(loaded.draftFile, loaded.draft, {
                dryRun: Boolean(options.dryRun),
                backupLabel: 'capcutbot-pre-media-index',
            });
            printJson({ projectDir: loaded.projectDir, draftFile: loaded.draftFile, ...result, ...save });
        } catch (error) {
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command('refresh-video-overlay-media <project>')
    .description('Re-probe a project-local video overlay after replacing its media file')
    .requiredOption('--material-id <id>', 'Exact video material id to refresh')
    .option('--dry-run', 'Print planned metadata refresh without writing')
    .action((project, options) => {
        try {
            if (!options.dryRun) warnIfCapCutRunning({ target: project });
            const loaded = loadDraft(project);
            const material = (loaded.draft.materials?.videos || []).find((item) => item.id === options.materialId);
            if (!material) throw new Error(`Could not find video material ${options.materialId}`);
            const marker = '/capcutbot_media/';
            const markerIndex = String(material.path || '').lastIndexOf(marker);
            if (markerIndex < 0) throw new Error('Video material is not project-local CapCutBot media');
            const filename = path.basename(String(material.path).slice(markerIndex + marker.length));
            const videoPath = path.join(loaded.projectDir, 'capcutbot_media', filename);
            const mediaMetadata = ffprobeVideoMetadata(videoPath);
            const result = refreshVideoOverlayMetadata(loaded.draft, {
                materialId: options.materialId,
                mediaMetadata,
                durationMicros: secondsToMicros(mediaMetadata.durationSeconds),
            });
            const mediaIndex = repairProjectVideoMediaIndex(loaded.draft, loaded.projectDir, { dryRun: Boolean(options.dryRun) });
            const save = saveDraft(loaded.draftFile, loaded.draft, {
                dryRun: Boolean(options.dryRun),
                backupLabel: 'capcutbot-pre-video-media-refresh',
            });
            printJson({ projectDir: loaded.projectDir, draftFile: loaded.draftFile, videoPath, ...result, mediaIndex, ...save });
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
    .command('add-audio-overlay <project> <audio>')
    .description('Add an audio overlay by cloning a known-good audio segment/material shape')
    .requiredOption('--start <seconds>', 'Target start in seconds', parseNumber)
    .option('--duration <seconds>', 'Target duration in seconds (defaults to the asset duration)', parseNumber)
    .option('--source-start <seconds>', 'Source start in seconds', parseNumber, 0)
    .option('--source <project>', 'Draft containing the audio archetype (defaults to the target draft)')
    .option('--archetype-material-id <id>', 'Audio material id whose segment/track shape should be cloned')
    .option('--filename <filename>', 'Filename to copy into capcutbot_media/')
    .option('--name <name>', 'New material display name')
    .option('--type <type>', 'New CapCut audio material type, such as sound')
    .option('--volume <number>', 'Segment volume', parseNumber)
    .option('--dry-run', 'Print planned patch without writing the draft or copying media')
    .action((project, audio, options) => {
        try {
            if (!options.dryRun) warnIfCapCutRunning({ target: project });
            const loaded = loadDraft(project);
            const source = options.source ? loadDraft(options.source) : loaded;
            const audioPath = expandPath(audio);
            const assetDurationSeconds = ffprobeDuration(audioPath);
            const durationSeconds = options.duration ?? assetDurationSeconds;
            const result = addAudioOverlayFromDraft(loaded.draft, source.draft, loaded.projectDir, audioPath, {
                ...options,
                dryRun: Boolean(options.dryRun),
                startMicros: secondsToMicros(options.start),
                durationMicros: secondsToMicros(durationSeconds),
                sourceStartMicros: secondsToMicros(options.sourceStart),
                assetDurationMicros: secondsToMicros(assetDurationSeconds),
            });
            const save = saveDraft(loaded.draftFile, loaded.draft, {
                dryRun: Boolean(options.dryRun),
                backupLabel: 'capcutbot-pre-audio-overlay',
            });
            printJson({ projectDir: loaded.projectDir, draftFile: loaded.draftFile, sourceDraftFile: source.draftFile, ...result, ...save });
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
            if (!options.dryRun) warnIfCapCutRunning({ target: project });
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
    .requiredOption('--outdir <dir>', 'Transcript output directory outside the source checkout')
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
