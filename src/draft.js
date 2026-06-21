import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectMediaPlaceholder, resolveDraftPath } from './paths.js';

const MICROS_PER_SECOND = 1_000_000;

export function microsToSeconds(value) {
    return Number((Number(value || 0) / MICROS_PER_SECOND).toFixed(3));
}

export function secondsToMicros(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`Invalid seconds value: ${value}`);
    return Math.round(seconds * MICROS_PER_SECOND);
}

export function loadDraft(input) {
    const resolved = resolveDraftPath(input);
    const raw = fs.readFileSync(resolved.draftFile, 'utf8');
    return { ...resolved, raw, draft: JSON.parse(raw) };
}

export function saveDraft(draftFile, draft, { dryRun = false, backupLabel = 'capcutbot' } = {}) {
    const pretty = `${JSON.stringify(draft, null, 2)}\n`;
    if (dryRun) return { wrote: false, backupFile: null, bytes: Buffer.byteLength(pretty) };
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const backupFile = `${draftFile}.${backupLabel}-${stamp}.bak`;
    fs.copyFileSync(draftFile, backupFile);
    fs.writeFileSync(draftFile, pretty);
    return { wrote: true, backupFile, bytes: Buffer.byteLength(pretty) };
}

export function duplicateDraftProject(source, targetName, options = {}) {
    const resolved = resolveDraftPath(source);
    const targetDir = path.isAbsolute(targetName)
        ? targetName
        : path.join(path.dirname(resolved.projectDir), targetName);

    if (fs.existsSync(targetDir)) {
        throw new Error(`Target CapCut draft already exists: ${targetDir}`);
    }

    if (options.dryRun) {
        return {
            copied: false,
            sourceDir: resolved.projectDir,
            targetDir,
        };
    }

    fs.cpSync(resolved.projectDir, targetDir, {
        recursive: true,
        errorOnExist: true,
        force: false,
        filter: (sourcePath) => path.basename(sourcePath) !== '.locked',
    });

    return {
        copied: true,
        sourceDir: resolved.projectDir,
        targetDir,
    };
}

export function draftSummary(draft) {
    const tracks = Array.isArray(draft.tracks) ? draft.tracks : [];
    const materials = draft.materials && typeof draft.materials === 'object' ? draft.materials : {};
    const trackTypes = countBy(tracks, (track) => track.type || 'unknown');
    const materialTypes = {};
    for (const [key, value] of Object.entries(materials)) {
        if (Array.isArray(value)) materialTypes[key] = value.length;
    }
    return {
        name: draft.name || '',
        durationSeconds: microsToSeconds(draft.duration),
        fps: draft.fps || null,
        trackCount: tracks.length,
        trackTypes,
        materialTypes,
    };
}

export function listTextSegments(draft) {
    const textMaterials = indexById(draft.materials?.texts || []);
    return collectSegments(draft, 'text').map((entry) => {
        const material = textMaterials.get(entry.segment.material_id);
        return {
            trackIndex: entry.trackIndex,
            segmentIndex: entry.segmentIndex,
            startSeconds: microsToSeconds(entry.segment.target_timerange?.start),
            durationSeconds: microsToSeconds(entry.segment.target_timerange?.duration),
            text: extractText(material),
            materialId: entry.segment.material_id,
        };
    });
}

export function replaceText(draft, options = {}) {
    const textMaterials = draft.materials?.texts;
    if (!Array.isArray(textMaterials)) throw new Error('Draft has no materials.texts array');
    if (!options.text) throw new Error('Missing replacement text');
    if (!options.materialId && !options.match) throw new Error('Pass either materialId or match');

    const matches = textMaterials.filter((material) => {
        if (options.materialId) return material.id === options.materialId;
        return extractText(material).includes(options.match);
    });

    if (matches.length === 0) {
        throw new Error(`Could not find text material matching "${options.materialId || options.match}"`);
    }
    if (matches.length > 1 && !options.first) {
        throw new Error(`Found ${matches.length} matching text materials. Pass a material id or --first.`);
    }

    const material = matches[0];
    const previousText = extractText(material);
    writeMaterialText(material, options.text);

    return {
        materialId: material.id,
        previousText,
        text: options.text,
    };
}

export function listAudioSegments(draft) {
    const audioMaterials = indexById(draft.materials?.audios || []);
    return collectSegments(draft, 'audio').map((entry) => {
        const material = audioMaterials.get(entry.segment.material_id);
        return {
            trackIndex: entry.trackIndex,
            segmentIndex: entry.segmentIndex,
            startSeconds: microsToSeconds(entry.segment.target_timerange?.start),
            durationSeconds: microsToSeconds(entry.segment.target_timerange?.duration),
            name: material?.name || '',
            type: material?.type || '',
            path: material?.path || '',
            materialId: entry.segment.material_id,
            volume: entry.segment.volume,
        };
    });
}

export function replaceVoiceover(draft, projectDir, audioPath, options = {}) {
    const absoluteAudioPath = path.resolve(audioPath);
    if (!fs.existsSync(absoluteAudioPath)) throw new Error(`Audio file does not exist: ${absoluteAudioPath}`);
    const durationMicros = options.durationMicros || secondsToMicros(options.durationSeconds || probeDurationFallback(options));
    const audioRecordDir = path.join(projectDir, 'audio_record');
    const destinationName = options.filename || path.basename(absoluteAudioPath);
    const destinationPath = path.join(audioRecordDir, destinationName);

    const audioMaterials = draft.materials?.audios;
    if (!Array.isArray(audioMaterials)) throw new Error('Draft has no materials.audios array');

    const match = findVoiceoverSegment(draft, options.match || 'voiceover');
    if (!match) throw new Error(`Could not find a voiceover audio segment matching "${options.match || 'voiceover'}"`);
    const materialIndex = audioMaterials.findIndex((material) => material.id === match.segment.material_id);
    if (materialIndex < 0) throw new Error(`Could not find audio material for segment ${match.segment.id}`);

    if (!options.dryRun) {
        fs.mkdirSync(audioRecordDir, { recursive: true });
        if (path.resolve(destinationPath) !== absoluteAudioPath) {
            fs.copyFileSync(absoluteAudioPath, destinationPath);
        }
    }

    const existing = audioMaterials[materialIndex];
    const newMaterialId = options.keepMaterialId ? existing.id : randomUUID().toUpperCase();
    const materialName = options.name || titleFromFilename(destinationName);
    audioMaterials[materialIndex] = {
        ...existing,
        id: newMaterialId,
        type: options.type || 'record',
        name: materialName,
        duration: durationMicros,
        path: `${projectMediaPlaceholder()}/audio_record/${destinationName}`,
        wave_points: [],
    };

    match.segment.material_id = newMaterialId;
    match.segment.target_timerange = {
        ...(match.segment.target_timerange || {}),
        start: options.startMicros || 0,
        duration: durationMicros,
    };
    match.segment.source_timerange = {
        ...(match.segment.source_timerange || {}),
        start: 0,
        duration: durationMicros,
    };
    if (options.volume !== undefined) match.segment.volume = Number(options.volume);

    if (options.extendDuration) {
        draft.duration = Math.max(Number(draft.duration || 0), durationMicros);
    }

    return {
        trackIndex: match.trackIndex,
        segmentIndex: match.segmentIndex,
        materialName,
        materialId: newMaterialId,
        destinationPath,
        durationSeconds: microsToSeconds(durationMicros),
    };
}

function collectSegments(draft, type) {
    const rows = [];
    for (const [trackIndex, track] of (draft.tracks || []).entries()) {
        if (track.type !== type) continue;
        for (const [segmentIndex, segment] of (track.segments || []).entries()) {
            rows.push({ trackIndex, segmentIndex, track, segment });
        }
    }
    return rows;
}

function findVoiceoverSegment(draft, matchText) {
    const needle = String(matchText || '').toLowerCase();
    const audioMaterials = indexById(draft.materials?.audios || []);
    const audioSegments = collectSegments(draft, 'audio');
    return audioSegments.find((entry) => {
        const material = audioMaterials.get(entry.segment.material_id);
        const haystack = `${material?.name || ''} ${material?.type || ''} ${material?.path || ''}`.toLowerCase();
        return haystack.includes(needle);
    }) || audioSegments.find((entry) => audioMaterials.get(entry.segment.material_id)?.type === 'record');
}

function extractText(material) {
    if (!material) return '';
    if (material.content) {
        try {
            const parsed = JSON.parse(material.content);
            if (typeof parsed.text === 'string') return parsed.text;
        } catch {
            return material.content;
        }
    }
    return material.text || material.name || '';
}

function writeMaterialText(material, text) {
    if (material.content) {
        try {
            const parsed = JSON.parse(material.content);
            parsed.text = text;
            if (Array.isArray(parsed.styles) && parsed.styles.length === 1 && Array.isArray(parsed.styles[0].range)) {
                parsed.styles[0].range = [0, text.length];
            }
            material.content = JSON.stringify(parsed);
        } catch {
            material.content = text;
        }
    }
    if ('text' in material) material.text = text;
    if ('recognize_text' in material) material.recognize_text = '';
    if ('translate_original_text' in material) material.translate_original_text = '';
    if (material.words) material.words.text = [];
    if (material.current_words) material.current_words.text = [];
}

function indexById(items) {
    return new Map(items.map((item) => [item.id, item]));
}

function countBy(items, mapper) {
    const counts = {};
    for (const item of items) {
        const key = mapper(item);
        counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
}

function titleFromFilename(filename) {
    return path.basename(filename, path.extname(filename)).replace(/[_-]+/g, ' ');
}

function probeDurationFallback(options) {
    if (options.durationSeconds) return options.durationSeconds;
    throw new Error('Missing duration. Pass --duration or run through the CLI so ffprobe can measure it.');
}
