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
    const synchronizedFiles = synchronizedDraftGraphFiles(draftFile);
    if (dryRun) return {
        wrote: false,
        backupFile: null,
        backupFiles: [],
        synchronizedFiles,
        bytes: Buffer.byteLength(pretty),
    };
    const stamp = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17)}-${process.pid}`;
    const backupFiles = synchronizedFiles.map((file) => {
        const backupFile = `${file}.${backupLabel}-${stamp}.bak`;
        fs.copyFileSync(file, backupFile);
        fs.writeFileSync(file, pretty);
        return backupFile;
    });
    return {
        wrote: true,
        backupFile: backupFiles[0],
        backupFiles,
        synchronizedFiles,
        bytes: Buffer.byteLength(pretty),
    };
}

function synchronizedDraftGraphFiles(draftFile) {
    const absoluteDraftFile = path.resolve(draftFile);
    const projectDir = path.dirname(absoluteDraftFile);
    const candidates = [absoluteDraftFile, path.join(projectDir, 'template-2.tmp')];
    const timelinesDir = path.join(projectDir, 'Timelines');
    if (fs.existsSync(timelinesDir)) {
        for (const entry of fs.readdirSync(timelinesDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            candidates.push(
                path.join(timelinesDir, entry.name, 'draft_info.json'),
                path.join(timelinesDir, entry.name, 'template-2.tmp'),
            );
        }
    }
    return [...new Set(candidates.filter((file) => fs.existsSync(file)))];
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

    const metadata = refreshDuplicatedProjectMetadata(targetDir);

    return {
        copied: true,
        sourceDir: resolved.projectDir,
        targetDir,
        ...metadata,
    };
}

function refreshDuplicatedProjectMetadata(targetDir) {
    const metaFile = path.join(targetDir, 'draft_meta_info.json');
    if (!fs.existsSync(metaFile)) return {};

    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const draftId = randomUUID().toUpperCase();
    const draftName = path.basename(targetDir);
    const modifiedMicros = Date.now() * 1000;
    meta.draft_id = draftId;
    meta.draft_name = draftName;
    meta.tm_draft_modified = modifiedMicros;
    if (typeof meta.draft_root_path === 'string' && meta.draft_root_path) {
        meta.draft_fold_path = path.join(meta.draft_root_path, draftName);
    } else {
        meta.draft_fold_path = targetDir;
    }
    fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
    return { draftId, draftName, metaFile };
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

export function updateTextOverlay(draft, options = {}) {
    const textMaterials = draft.materials?.texts;
    if (!Array.isArray(textMaterials)) throw new Error('Draft has no materials.texts array');
    if (!options.materialId && !options.match) throw new Error('Pass either materialId or match');
    const hasChange = options.text !== undefined
        || options.startMicros !== undefined
        || options.durationMicros !== undefined
        || options.scale !== undefined
        || options.x !== undefined
        || options.y !== undefined;
    if (!hasChange) throw new Error('Pass at least one text, timing, or transform change');

    const materials = indexById(textMaterials);
    const matches = collectSegments(draft, 'text').filter((entry) => {
        if (options.materialId) return entry.segment.material_id === options.materialId;
        return extractText(materials.get(entry.segment.material_id)).includes(options.match);
    });
    if (matches.length === 0) {
        throw new Error(`Could not find text segment matching "${options.materialId || options.match}"`);
    }
    if (matches.length > 1 && !options.first) {
        throw new Error(`Found ${matches.length} matching text segments. Pass a material id or --first.`);
    }

    const entry = matches[0];
    const material = materials.get(entry.segment.material_id);
    const previousText = extractText(material);
    if (options.text !== undefined) writeMaterialText(material, options.text);

    const segment = entry.segment;
    const previousStartMicros = Number(segment.target_timerange?.start || 0);
    const previousDurationMicros = Number(segment.target_timerange?.duration || 0);
    const startMicros = options.startMicros === undefined
        ? previousStartMicros
        : requiredTiming(options.startMicros, 'start');
    const durationMicros = options.durationMicros === undefined
        ? previousDurationMicros
        : requiredTiming(options.durationMicros, 'duration', { positive: true });
    segment.target_timerange = { ...(segment.target_timerange || {}), start: startMicros, duration: durationMicros };
    if (segment.render_timerange) {
        segment.render_timerange = { ...segment.render_timerange, start: startMicros, duration: durationMicros };
    }
    segment.clip = segment.clip || {};
    segment.clip.scale = segment.clip.scale || { x: 1, y: 1 };
    segment.clip.transform = segment.clip.transform || { x: 0, y: 0 };
    if (options.scale !== undefined) {
        const scale = Number(options.scale);
        if (!Number.isFinite(scale) || scale <= 0) throw new Error('Text overlay scale must be a positive number');
        segment.clip.scale = { x: scale, y: scale };
        if (segment.uniform_scale) segment.uniform_scale = { ...segment.uniform_scale, on: true, value: scale };
    }
    if (options.x !== undefined) {
        const x = Number(options.x);
        if (!Number.isFinite(x)) throw new Error('Text overlay x transform must be a finite number');
        segment.clip.transform.x = x;
    }
    if (options.y !== undefined) {
        const y = Number(options.y);
        if (!Number.isFinite(y)) throw new Error('Text overlay y transform must be a finite number');
        segment.clip.transform.y = y;
    }
    draft.duration = Math.max(Number(draft.duration || 0), startMicros + durationMicros);

    return {
        trackIndex: entry.trackIndex,
        segmentId: segment.id,
        materialId: segment.material_id,
        previousText,
        text: extractText(material),
        previousStartSeconds: microsToSeconds(previousStartMicros),
        startSeconds: microsToSeconds(startMicros),
        previousDurationSeconds: microsToSeconds(previousDurationMicros),
        durationSeconds: microsToSeconds(durationMicros),
        scale: segment.clip.scale.x,
        x: segment.clip.transform.x,
        y: segment.clip.transform.y,
    };
}

export function updateVideoOverlay(draft, options = {}) {
    if (!options.materialId) throw new Error('Pass a video material id');
    const hasChange = options.startMicros !== undefined
        || options.durationMicros !== undefined
        || options.scale !== undefined
        || options.x !== undefined
        || options.y !== undefined;
    if (!hasChange) throw new Error('Pass at least one timing or transform change');

    const matches = collectSegments(draft, 'video').filter((entry) => entry.segment.material_id === options.materialId);
    if (matches.length === 0) throw new Error(`Could not find video segment matching "${options.materialId}"`);
    if (matches.length > 1) throw new Error(`Found ${matches.length} video segments for material ${options.materialId}`);

    const entry = matches[0];
    const segment = entry.segment;
    const previousStartMicros = Number(segment.target_timerange?.start || 0);
    const previousDurationMicros = Number(segment.target_timerange?.duration || 0);
    const startMicros = options.startMicros === undefined
        ? previousStartMicros
        : requiredTiming(options.startMicros, 'start');
    const durationMicros = options.durationMicros === undefined
        ? previousDurationMicros
        : requiredTiming(options.durationMicros, 'duration', { positive: true });
    segment.target_timerange = { ...(segment.target_timerange || {}), start: startMicros, duration: durationMicros };
    if (segment.render_timerange) {
        segment.render_timerange = { ...segment.render_timerange, start: startMicros, duration: durationMicros };
    }
    segment.clip = segment.clip || {};
    segment.clip.scale = segment.clip.scale || { x: 1, y: 1 };
    segment.clip.transform = segment.clip.transform || { x: 0, y: 0 };
    if (options.scale !== undefined) {
        const scale = Number(options.scale);
        if (!Number.isFinite(scale) || scale <= 0) throw new Error('Video overlay scale must be a positive number');
        segment.clip.scale = { x: scale, y: scale };
        if (segment.uniform_scale) segment.uniform_scale = { ...segment.uniform_scale, on: true, value: scale };
    }
    if (options.x !== undefined) {
        const x = Number(options.x);
        if (!Number.isFinite(x)) throw new Error('Video overlay x transform must be a finite number');
        segment.clip.transform.x = x;
    }
    if (options.y !== undefined) {
        const y = Number(options.y);
        if (!Number.isFinite(y)) throw new Error('Video overlay y transform must be a finite number');
        segment.clip.transform.y = y;
    }
    draft.duration = Math.max(Number(draft.duration || 0), startMicros + durationMicros);

    return {
        trackIndex: entry.trackIndex,
        segmentId: segment.id,
        materialId: segment.material_id,
        previousStartSeconds: microsToSeconds(previousStartMicros),
        startSeconds: microsToSeconds(startMicros),
        previousDurationSeconds: microsToSeconds(previousDurationMicros),
        durationSeconds: microsToSeconds(durationMicros),
        scale: segment.clip.scale.x,
        x: segment.clip.transform.x,
        y: segment.clip.transform.y,
    };
}

export function updateAudioOverlay(draft, options = {}) {
    if (!options.materialId) throw new Error('Pass an audio material id');
    if (options.startMicros === undefined && options.durationMicros === undefined && options.volume === undefined) {
        throw new Error('Pass at least one timing or volume change');
    }
    const matches = collectSegments(draft, 'audio').filter((entry) => entry.segment.material_id === options.materialId);
    if (matches.length === 0) throw new Error(`Could not find audio segment matching "${options.materialId}"`);
    if (matches.length > 1) throw new Error(`Found ${matches.length} audio segments for material ${options.materialId}`);
    const entry = matches[0];
    const segment = entry.segment;
    const previousStartMicros = Number(segment.target_timerange?.start || 0);
    const previousDurationMicros = Number(segment.target_timerange?.duration || 0);
    const startMicros = options.startMicros === undefined ? previousStartMicros : requiredTiming(options.startMicros, 'start');
    const durationMicros = options.durationMicros === undefined
        ? previousDurationMicros
        : requiredTiming(options.durationMicros, 'duration', { positive: true });
    const previousVolume = segment.volume;
    segment.target_timerange = { ...(segment.target_timerange || {}), start: startMicros, duration: durationMicros };
    if (options.volume !== undefined) segment.volume = Number(options.volume);
    draft.duration = Math.max(Number(draft.duration || 0), startMicros + durationMicros);
    return {
        trackIndex: entry.trackIndex,
        segmentId: segment.id,
        materialId: segment.material_id,
        previousStartSeconds: microsToSeconds(previousStartMicros),
        startSeconds: microsToSeconds(startMicros),
        previousDurationSeconds: microsToSeconds(previousDurationMicros),
        durationSeconds: microsToSeconds(durationMicros),
        previousVolume,
        volume: segment.volume,
    };
}

export function localizeAudioOverlayMedia(draft, projectDir, options = {}) {
    if (!options.materialId) throw new Error('Pass an audio material id');
    const filename = safeDestinationName(options.filename);
    const material = (draft.materials?.audios || []).find((item) => item.id === options.materialId);
    if (!material) throw new Error(`Could not find audio material ${options.materialId}`);
    const localPath = path.join(projectDir, 'capcutbot_media', filename);
    if (!fs.existsSync(localPath)) throw new Error(`Project-local audio file does not exist: ${localPath}`);
    const previousPath = material.path;
    material.path = `${projectMediaPlaceholder()}/capcutbot_media/${filename}`;
    return { materialId: material.id, previousPath, path: material.path, localPath };
}

export function refreshVideoOverlayMetadata(draft, options = {}) {
    if (!options.materialId) throw new Error('Pass a video material id');
    const material = (draft.materials?.videos || []).find((item) => item.id === options.materialId);
    if (!material) throw new Error(`Could not find video material ${options.materialId}`);
    const metadata = options.mediaMetadata;
    if (!metadata) throw new Error('Pass probed video metadata');
    material.width = Number(metadata.width);
    material.height = Number(metadata.height);
    material.duration = Number(options.durationMicros);
    material.has_audio = Boolean(metadata.hasAudio);
    return {
        materialId: material.id,
        width: material.width,
        height: material.height,
        durationSeconds: microsToSeconds(material.duration),
        hasAudio: material.has_audio,
    };
}

export function removeTextOverlays(draft, options = {}) {
    const keepMaterialIds = new Set(options.keepMaterialIds || []);
    const keepTexts = new Set(options.keepTexts || []);
    const textMaterials = draft.materials?.texts;
    if (!Array.isArray(textMaterials)) throw new Error('Draft has no materials.texts array');

    const textById = indexById(textMaterials);
    const removedMaterialIds = new Set();
    const removedExtraIds = new Set();
    let removedSegments = 0;
    let removedTracks = 0;

    draft.tracks = (draft.tracks || []).flatMap((track) => {
        if (track.type !== 'text') return [track];
        const segments = (track.segments || []).filter((segment) => {
            const material = textById.get(segment.material_id);
            // Native auto-caption tracks can reference a separate caption-template
            // id space rather than materials.texts. They are not removable text
            // overlays, so preserve them unless CapCutBot can resolve the material.
            if (!material) return true;
            const keep = keepMaterialIds.has(segment.material_id)
                || keepTexts.has(extractText(material));
            if (keep) return true;
            removedSegments += 1;
            removedMaterialIds.add(segment.material_id);
            for (const id of segment.extra_material_refs || []) removedExtraIds.add(id);
            return false;
        });
        if (segments.length === 0) {
            removedTracks += 1;
            return [];
        }
        return [{ ...track, segments }];
    });

    draft.materials.texts = textMaterials.filter((material) => !removedMaterialIds.has(material.id));
    for (const [type, materials] of Object.entries(draft.materials || {})) {
        if (type === 'texts' || !Array.isArray(materials)) continue;
        draft.materials[type] = materials.filter((material) => !removedExtraIds.has(material?.id));
    }

    return {
        removedTracks,
        removedSegments,
        removedTextMaterials: removedMaterialIds.size,
        removedExtraMaterials: removedExtraIds.size,
        remainingTextMaterials: draft.materials.texts.length,
    };
}

export function repairProjectVideoMediaIndex(draft, projectDir, options = {}) {
    const metaFile = path.join(projectDir, 'draft_meta_info.json');
    const virtualFile = path.join(projectDir, 'draft_virtual_store.json');
    if (!fs.existsSync(metaFile)) throw new Error(`Missing CapCut media index: ${metaFile}`);
    if (!fs.existsSync(virtualFile)) throw new Error(`Missing CapCut virtual media index: ${virtualFile}`);

    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const virtual = JSON.parse(fs.readFileSync(virtualFile, 'utf8'));
    if (!Array.isArray(meta.draft_materials)) meta.draft_materials = [];
    let videoGroup = meta.draft_materials.find((group) => group.type === 0);
    if (!videoGroup) {
        videoGroup = { type: 0, value: [] };
        meta.draft_materials.push(videoGroup);
    }
    if (!Array.isArray(videoGroup.value)) videoGroup.value = [];
    if (!Array.isArray(virtual.draft_virtual_store)) virtual.draft_virtual_store = [];
    let relationshipGroup = virtual.draft_virtual_store.find((group) => group.type === 1);
    if (!relationshipGroup) {
        relationshipGroup = { type: 1, value: [] };
        virtual.draft_virtual_store.push(relationshipGroup);
    }
    if (!Array.isArray(relationshipGroup.value)) relationshipGroup.value = [];

    const nowMs = Date.now();
    const registered = [];
    const reused = [];
    const resolveIndexedPath = (filePath) => path.isAbsolute(String(filePath || ''))
        ? path.resolve(String(filePath))
        : path.resolve(projectDir, String(filePath || ''));
    for (const material of draft.materials?.videos || []) {
        const marker = '/capcutbot_media/';
        const markerIndex = String(material.path || '').lastIndexOf(marker);
        let filename = markerIndex >= 0
            ? path.basename(String(material.path).slice(markerIndex + marker.length))
            : path.basename(String(material.material_name || ''));
        if (!filename) continue;
        const absolutePath = path.join(projectDir, 'capcutbot_media', filename);
        const indexedPath = `./capcutbot_media/${filename}`;
        if (markerIndex < 0 && !fs.existsSync(absolutePath)) continue;
        // A video-overlay dry run adds the planned timeline material in memory but
        // intentionally does not copy its media file. Keep reporting the planned
        // media-index registration without treating that expected absence as a
        // broken live draft. Real writes still require every timeline file.
        if (!fs.existsSync(absolutePath) && !options.dryRun) {
            throw new Error(`Timeline media is missing: ${absolutePath}`);
        }

        let entry = videoGroup.value.find((item) => item.id === material.local_material_id)
            || videoGroup.value.find((item) => resolveIndexedPath(item.file_Path) === path.resolve(absolutePath));
        if (entry) {
            material.local_material_id = entry.id;
            entry.extra_info = filename;
            entry.file_Path = indexedPath;
            entry.duration = Number(material.duration || 0);
            entry.width = Number(material.width || 0);
            entry.height = Number(material.height || 0);
            entry.roughcut_time_range = { ...(entry.roughcut_time_range || {}), duration: Number(material.duration || 0) };
            reused.push({ materialId: material.id, localMaterialId: entry.id, path: absolutePath });
        } else {
            const localMaterialId = markerIndex < 0 && String(material.local_material_id || '')
                ? String(material.local_material_id)
                : randomUUID();
            entry = {
                ai_group_type: '',
                create_time: Math.floor(nowMs / 1000),
                duration: Number(material.duration || 0),
                enter_from: 0,
                extra_info: filename,
                file_Path: indexedPath,
                height: Number(material.height || 0),
                id: localMaterialId,
                import_time: Math.floor(nowMs / 1000),
                import_time_ms: nowMs * 1000,
                item_source: 1,
                md5: '',
                metetype: 'video',
                roughcut_time_range: { duration: Number(material.duration || 0), start: 0 },
                sub_time_range: { duration: -1, start: -1 },
                type: 0,
                width: Number(material.width || 0),
            };
            videoGroup.value.push(entry);
            material.local_material_id = localMaterialId;
            registered.push({ materialId: material.id, localMaterialId, path: absolutePath });
        }
        if (!relationshipGroup.value.some((item) => item.child_id === entry.id)) {
            relationshipGroup.value.push({ child_id: entry.id, parent_id: '' });
        }
    }

    const sidecarFiles = [metaFile, virtualFile];
    const sidecarBackups = [];
    if (!options.dryRun) {
        const stamp = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17)}-${process.pid}`;
        for (const [file, value] of [[metaFile, meta], [virtualFile, virtual]]) {
            const backup = `${file}.capcutbot-pre-media-index-${stamp}.bak`;
            fs.copyFileSync(file, backup);
            fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
            sidecarBackups.push(backup);
        }
    }

    return { registered, reused, sidecarFiles, sidecarBackups };
}

export function importProjectVideoMedia(projectDir, absoluteVideoPath, mediaMetadata, options = {}) {
    const destinationName = safeDestinationName(options.filename || path.basename(absoluteVideoPath));
    const mediaDir = path.join(projectDir, 'capcutbot_media');
    const destinationPath = path.join(mediaDir, destinationName);
    if (!options.dryRun) {
        fs.mkdirSync(mediaDir, { recursive: true });
        if (path.resolve(destinationPath) !== path.resolve(absoluteVideoPath)) {
            if (fs.existsSync(destinationPath)) throw new Error(`Destination media already exists: ${destinationPath}`);
            fs.copyFileSync(absoluteVideoPath, destinationPath, fs.constants.COPYFILE_EXCL);
        }
    }

    const material = {
        id: randomUUID().toUpperCase(),
        material_name: destinationName,
        path: `${projectMediaPlaceholder()}/capcutbot_media/${destinationName}`,
        duration: Number(options.durationMicros || 0),
        width: Number(mediaMetadata.width || 0),
        height: Number(mediaMetadata.height || 0),
        has_audio: Boolean(mediaMetadata.hasAudio),
        local_material_id: '',
    };
    const mediaIndex = repairProjectVideoMediaIndex({ materials: { videos: [material] } }, projectDir, {
        dryRun: Boolean(options.dryRun),
    });
    return {
        filename: destinationName,
        destinationPath,
        localMaterialId: material.local_material_id,
        durationMicros: material.duration,
        width: material.width,
        height: material.height,
        hasAudio: material.has_audio,
        mediaIndex,
    };
}

export function addTextOverlayFromDraft(draft, sourceDraft, options = {}) {
    if (!options.sourceText) throw new Error('Missing source text to match');
    if (!options.text) throw new Error('Missing replacement text');
    const startMicros = requiredTiming(options.startMicros, 'start');
    const durationMicros = requiredTiming(options.durationMicros, 'duration', { positive: true });

    const sourceTexts = indexById(sourceDraft.materials?.texts || []);
    const matches = collectSegments(sourceDraft, 'text').filter((entry) => {
        return extractText(sourceTexts.get(entry.segment.material_id)) === options.sourceText;
    });
    if (matches.length === 0) throw new Error(`Could not find source text exactly matching "${options.sourceText}"`);
    if (matches.length > 1 && !options.first) {
        throw new Error(`Found ${matches.length} source text segments matching "${options.sourceText}". Pass --first.`);
    }

    const sourceEntry = matches[0];
    const sourceMaterial = sourceTexts.get(sourceEntry.segment.material_id);
    if (!sourceMaterial) throw new Error(`Could not find source text material ${sourceEntry.segment.material_id}`);
    assertTextCanBeRestyled(sourceMaterial, options.text);

    const nextId = options.idFactory || (() => randomUUID().toUpperCase());
    const materialId = nextId();
    const segmentId = nextId();
    const trackId = sourceEntry.track.id ? nextId() : null;
    const copiedExtras = copyReferencedMaterials(
        sourceDraft.materials || {},
        draft.materials || (draft.materials = {}),
        [
            ...(sourceEntry.segment.extra_material_refs || []),
            ...findReferencedMaterialIds(sourceMaterial, sourceDraft.materials || {}, sourceMaterial.id),
        ],
        nextId,
    );
    const idMap = new Map([
        [sourceMaterial.id, materialId],
        [sourceEntry.segment.id, segmentId],
        ...copiedExtras.idMap,
    ]);
    if (sourceEntry.track.id && trackId) idMap.set(sourceEntry.track.id, trackId);

    const material = remapIds(deepClone(sourceMaterial), idMap);
    material.id = materialId;
    writeMaterialText(material, options.text);
    if (!Array.isArray(draft.materials.texts)) draft.materials.texts = [];
    draft.materials.texts.push(material);

    const segment = remapIds(deepClone(sourceEntry.segment), idMap);
    segment.id = segmentId;
    segment.material_id = materialId;
    segment.target_timerange = { ...(segment.target_timerange || {}), start: startMicros, duration: durationMicros };
    if (segment.render_timerange) {
        segment.render_timerange = { ...segment.render_timerange, start: startMicros, duration: durationMicros };
    }

    const track = remapIds(deepClone(sourceEntry.track), idMap);
    if (trackId) track.id = trackId;
    track.segments = [segment];
    if (!Array.isArray(draft.tracks)) draft.tracks = [];
    draft.tracks.push(track);
    draft.duration = Math.max(Number(draft.duration || 0), startMicros + durationMicros);

    return {
        trackIndex: draft.tracks.length - 1,
        segmentId,
        materialId,
        copiedExtraMaterials: copiedExtras.count,
        startSeconds: microsToSeconds(startMicros),
        durationSeconds: microsToSeconds(durationMicros),
        sourceText: options.sourceText,
        text: options.text,
    };
}

export function addVideoOverlay(draft, projectDir, videoPath, options = {}) {
    const absoluteVideoPath = path.resolve(videoPath);
    if (!fs.existsSync(absoluteVideoPath)) throw new Error(`Video file does not exist: ${absoluteVideoPath}`);
    const startMicros = requiredTiming(options.startMicros, 'start');
    const durationMicros = requiredTiming(options.durationMicros, 'duration', { positive: true });
    const sourceStartMicros = requiredTiming(options.sourceStartMicros ?? 0, 'source start');
    if (options.assetDurationMicros && sourceStartMicros + durationMicros > options.assetDurationMicros) {
        throw new Error('Requested source range exceeds the video asset duration');
    }

    const sourceDraft = options.sourceDraft || draft;
    const sourceVideoMaterials = sourceDraft.materials?.videos;
    if (!Array.isArray(sourceVideoMaterials)) throw new Error('Source draft has no materials.videos array');
    if (!draft.materials || typeof draft.materials !== 'object') draft.materials = {};
    if (!Array.isArray(draft.materials.videos)) draft.materials.videos = [];
    const videoMaterials = draft.materials.videos;
    const videoEntries = collectSegments(sourceDraft, 'video');
    const archetype = videoEntries.find((entry) => {
        const candidate = sourceVideoMaterials.find((item) => item.id === entry.segment.material_id);
        if (!candidate) return false;
        if (options.archetypeMaterialId && entry.segment.material_id !== options.archetypeMaterialId) return false;
        return !isCompoundVideoArchetype(sourceDraft, entry, candidate);
    });
    if (!archetype) {
        throw new Error(options.archetypeMaterialId
            ? `Could not find a safe ordinary video-overlay archetype for material ${options.archetypeMaterialId}; compound/nested clips cannot be cloned as overlays`
            : 'Could not find a safe ordinary video-overlay archetype in the source draft; pass --source with a known-good overlay draft');
    }
    const sourceMaterial = sourceVideoMaterials.find((item) => item.id === archetype.segment.material_id);
    const nextId = options.idFactory || (() => randomUUID().toUpperCase());
    const materialId = nextId();
    const segmentId = nextId();
    const trackId = archetype.track.id ? nextId() : null;
    const copiedExtras = sourceDraft === draft
        ? { idMap: new Map(), count: 0 }
        : copyReferencedMaterials(
            sourceDraft.materials || {},
            draft.materials,
            [
                ...(archetype.segment.extra_material_refs || []),
                ...findReferencedMaterialIds(sourceMaterial, sourceDraft.materials || {}, sourceMaterial.id),
            ],
            nextId,
        );
    const idMap = new Map([
        [sourceMaterial.id, materialId],
        [archetype.segment.id, segmentId],
        ...copiedExtras.idMap,
    ]);
    if (archetype.track.id && trackId) idMap.set(archetype.track.id, trackId);

    const destinationName = safeDestinationName(options.filename || path.basename(absoluteVideoPath));
    const mediaDir = path.join(projectDir, 'capcutbot_media');
    const destinationPath = path.join(mediaDir, destinationName);
    if (!options.dryRun) {
        fs.mkdirSync(mediaDir, { recursive: true });
        if (path.resolve(destinationPath) !== absoluteVideoPath) {
            if (fs.existsSync(destinationPath)) throw new Error(`Destination media already exists: ${destinationPath}`);
            fs.copyFileSync(absoluteVideoPath, destinationPath, fs.constants.COPYFILE_EXCL);
        }
    }

    const material = remapIds(deepClone(sourceMaterial), idMap);
    material.id = materialId;
    // A cloned timeline material must not inherit the Media-panel identity of
    // its archetype. If it does, repairProjectVideoMediaIndex() treats the new
    // overlay as the original source clip and repoints that source entry to the
    // overlay file. Leave the field blank so the media-index pass allocates a
    // new local ID for this independently imported asset.
    material.local_material_id = '';
    material.path = `${projectMediaPlaceholder()}/capcutbot_media/${destinationName}`;
    material.duration = options.assetDurationMicros || durationMicros;
    if (options.mediaMetadata) {
        material.width = Number(options.mediaMetadata.width);
        material.height = Number(options.mediaMetadata.height);
        material.has_audio = Boolean(options.mediaMetadata.hasAudio);
    }
    if ('material_name' in material) material.material_name = destinationName;
    if ('name' in material) material.name = options.name || titleFromFilename(destinationName);
    videoMaterials.push(material);

    const segment = remapIds(deepClone(archetype.segment), idMap);
    segment.id = segmentId;
    segment.material_id = materialId;
    segment.target_timerange = { ...(segment.target_timerange || {}), start: startMicros, duration: durationMicros };
    segment.source_timerange = { ...(segment.source_timerange || {}), start: sourceStartMicros, duration: durationMicros };
    if (segment.render_timerange) {
        segment.render_timerange = { ...segment.render_timerange, start: startMicros, duration: durationMicros };
    }
    segment.track_render_index = draft.tracks.length;
    segment.speed = 1;
    segment.clip = segment.clip || {};
    segment.clip.scale = segment.clip.scale || { x: 1, y: 1 };
    segment.clip.transform = segment.clip.transform || { x: 0, y: 0 };
    if (options.scale !== undefined) {
        const scale = Number(options.scale);
        if (!Number.isFinite(scale) || scale <= 0) throw new Error('Video overlay scale must be a positive number');
        segment.clip.scale = { x: scale, y: scale };
        if (segment.uniform_scale) segment.uniform_scale = { ...segment.uniform_scale, on: true, value: scale };
    }
    if (options.x !== undefined) {
        const x = Number(options.x);
        if (!Number.isFinite(x)) throw new Error('Video overlay x transform must be a finite number');
        segment.clip.transform.x = x;
    }
    if (options.y !== undefined) {
        const y = Number(options.y);
        if (!Number.isFinite(y)) throw new Error('Video overlay y transform must be a finite number');
        segment.clip.transform.y = y;
    }

    const track = remapIds(deepClone(archetype.track), idMap);
    if (trackId) track.id = trackId;
    track.segments = [segment];
    draft.tracks.push(track);
    draft.duration = Math.max(Number(draft.duration || 0), startMicros + durationMicros);

    return {
        trackIndex: draft.tracks.length - 1,
        segmentId,
        materialId,
        copiedExtraMaterials: copiedExtras.count,
        destinationPath,
        startSeconds: microsToSeconds(startMicros),
        durationSeconds: microsToSeconds(durationMicros),
        sourceStartSeconds: microsToSeconds(sourceStartMicros),
        width: material.width,
        height: material.height,
        hasAudio: material.has_audio,
        scale: segment.clip.scale?.x,
        x: segment.clip.transform?.x,
        y: segment.clip.transform?.y,
    };
}

function isCompoundVideoArchetype(draft, entry, material) {
    const draftMaterialIds = new Set((draft.materials?.drafts || []).map((item) => item.id));
    const referencedDraft = (entry.segment.extra_material_refs || []).some((id) => draftMaterialIds.has(id));
    const pathValue = String(material.path || '').toLowerCase();
    const nameValue = String(material.material_name || material.name || '').toLowerCase();
    return referencedDraft
        || Number(material.extra_type_option) === 2
        || pathValue.includes('/resources/combination/')
        || nameValue.includes('compound clip');
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

export function addAudioOverlayFromDraft(draft, sourceDraft, projectDir, audioPath, options = {}) {
    const absoluteAudioPath = path.resolve(audioPath);
    if (!fs.existsSync(absoluteAudioPath)) throw new Error(`Audio file does not exist: ${absoluteAudioPath}`);
    const startMicros = requiredTiming(options.startMicros, 'start');
    const durationMicros = requiredTiming(options.durationMicros, 'duration', { positive: true });
    const sourceStartMicros = requiredTiming(options.sourceStartMicros ?? 0, 'source start');

    const sourceAudios = sourceDraft.materials?.audios;
    if (!Array.isArray(sourceAudios)) throw new Error('Source draft has no materials.audios array');
    const sourceEntries = collectSegments(sourceDraft, 'audio');
    const archetype = sourceEntries.find((entry) => {
        if (!options.archetypeMaterialId) return sourceAudios.some((item) => item.id === entry.segment.material_id);
        return entry.segment.material_id === options.archetypeMaterialId;
    });
    if (!archetype) {
        throw new Error(options.archetypeMaterialId
            ? `Could not find audio archetype material ${options.archetypeMaterialId}`
            : 'Could not find an audio segment/material archetype in the source draft');
    }
    const sourceMaterial = sourceAudios.find((item) => item.id === archetype.segment.material_id);
    if (!sourceMaterial) throw new Error(`Could not find source audio material ${archetype.segment.material_id}`);
    if (!draft.materials || typeof draft.materials !== 'object') draft.materials = {};
    if (!Array.isArray(draft.materials.audios)) draft.materials.audios = [];
    if (!Array.isArray(draft.tracks)) draft.tracks = [];

    const nextId = options.idFactory || (() => randomUUID().toUpperCase());
    const materialId = nextId();
    const segmentId = nextId();
    const trackId = archetype.track.id ? nextId() : null;
    const copiedExtras = copyReferencedMaterials(
        sourceDraft.materials || {},
        draft.materials,
        [
            ...(archetype.segment.extra_material_refs || []),
            ...findReferencedMaterialIds(sourceMaterial, sourceDraft.materials || {}, sourceMaterial.id),
        ],
        nextId,
    );
    const idMap = new Map([
        [sourceMaterial.id, materialId],
        [archetype.segment.id, segmentId],
        ...copiedExtras.idMap,
    ]);
    if (archetype.track.id && trackId) idMap.set(archetype.track.id, trackId);

    const destinationName = safeDestinationName(options.filename || path.basename(absoluteAudioPath));
    const mediaDir = path.join(projectDir, 'capcutbot_media');
    const destinationPath = path.join(mediaDir, destinationName);
    if (!options.dryRun) {
        fs.mkdirSync(mediaDir, { recursive: true });
        if (path.resolve(destinationPath) !== absoluteAudioPath) {
            if (fs.existsSync(destinationPath)) {
                if (!filesHaveSameContents(absoluteAudioPath, destinationPath)) {
                    throw new Error(`Destination media already exists with different contents: ${destinationPath}`);
                }
            } else {
                fs.copyFileSync(absoluteAudioPath, destinationPath, fs.constants.COPYFILE_EXCL);
            }
        }
    }

    const material = remapIds(deepClone(sourceMaterial), idMap);
    material.id = materialId;
    material.path = `${projectMediaPlaceholder()}/capcutbot_media/${destinationName}`;
    material.duration = Math.max(Number(options.assetDurationMicros || 0), sourceStartMicros + durationMicros);
    material.wave_points = [];
    if ('name' in material) material.name = options.name || titleFromFilename(destinationName);
    if (options.type) material.type = options.type;
    draft.materials.audios.push(material);

    const segment = remapIds(deepClone(archetype.segment), idMap);
    segment.id = segmentId;
    segment.material_id = materialId;
    segment.target_timerange = { ...(segment.target_timerange || {}), start: startMicros, duration: durationMicros };
    segment.source_timerange = { ...(segment.source_timerange || {}), start: sourceStartMicros, duration: durationMicros };
    if (options.volume !== undefined) segment.volume = Number(options.volume);
    if ('track_render_index' in segment) segment.track_render_index = draft.tracks.length;
    segment.speed = 1;

    const track = remapIds(deepClone(archetype.track), idMap);
    if (trackId) track.id = trackId;
    track.segments = [segment];
    draft.tracks.push(track);
    draft.duration = Math.max(Number(draft.duration || 0), startMicros + durationMicros);

    return {
        trackIndex: draft.tracks.length - 1,
        segmentId,
        materialId,
        copiedExtraMaterials: copiedExtras.count,
        destinationPath,
        startSeconds: microsToSeconds(startMicros),
        durationSeconds: microsToSeconds(durationMicros),
        sourceStartSeconds: microsToSeconds(sourceStartMicros),
        volume: segment.volume,
        type: material.type,
        name: material.name,
    };
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

function requiredTiming(value, label, options = {}) {
    if (!Number.isFinite(value) || value < 0 || (options.positive && value === 0)) {
        throw new Error(`Invalid ${label} timing: ${value}`);
    }
    return Math.round(value);
}

function assertTextCanBeRestyled(material, text) {
    if (!material.content) return;
    try {
        const parsed = JSON.parse(material.content);
        if (Array.isArray(parsed.styles) && parsed.styles.length > 1 && extractText(material).length !== text.length) {
            throw new Error('Cannot safely clone multi-style text when replacement length differs');
        }
    } catch (error) {
        if (error instanceof SyntaxError) return;
        throw error;
    }
}

function copyReferencedMaterials(sourceMaterials, targetMaterials, initialIds, nextId) {
    const sourceIndex = new Map();
    for (const [category, items] of Object.entries(sourceMaterials)) {
        if (!Array.isArray(items)) continue;
        for (const item of items) if (item?.id) sourceIndex.set(item.id, { category, item });
    }

    const pending = [...new Set(initialIds)];
    const selected = [];
    const seen = new Set();
    while (pending.length) {
        const id = pending.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        const found = sourceIndex.get(id);
        if (!found) throw new Error(`Could not find referenced extra material ${id} in source draft`);
        selected.push(found);
        for (const value of collectStrings(found.item)) {
            if (sourceIndex.has(value) && !seen.has(value)) pending.push(value);
        }
    }

    const idMap = new Map(selected.map(({ item }) => [item.id, nextId()]));
    for (const { category, item } of selected) {
        if (!Array.isArray(targetMaterials[category])) targetMaterials[category] = [];
        const copy = remapIds(deepClone(item), idMap);
        copy.id = idMap.get(item.id);
        targetMaterials[category].push(copy);
    }
    return { idMap, count: selected.length };
}

function findReferencedMaterialIds(value, materials, excludedId) {
    const materialIds = new Set();
    for (const items of Object.values(materials)) {
        if (!Array.isArray(items)) continue;
        for (const item of items) if (item?.id && item.id !== excludedId) materialIds.add(item.id);
    }
    return [...new Set(collectStrings(value).filter((item) => materialIds.has(item)))];
}

function collectStrings(value, output = []) {
    if (typeof value === 'string') output.push(value);
    else if (Array.isArray(value)) for (const item of value) collectStrings(item, output);
    else if (value && typeof value === 'object') for (const item of Object.values(value)) collectStrings(item, output);
    return output;
}

function remapIds(value, idMap) {
    if (typeof value === 'string') return idMap.get(value) || value;
    if (Array.isArray(value)) return value.map((item) => remapIds(item, idMap));
    if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) value[key] = remapIds(item, idMap);
    }
    return value;
}

function deepClone(value) {
    return structuredClone(value);
}

function safeDestinationName(value) {
    if (!value || value !== path.basename(value) || value === '.' || value === '..') {
        throw new Error(`Invalid destination filename: ${value}`);
    }
    return value;
}

function filesHaveSameContents(first, second) {
    const firstStat = fs.statSync(first);
    const secondStat = fs.statSync(second);
    if (firstStat.size !== secondStat.size) return false;
    return fs.readFileSync(first).equals(fs.readFileSync(second));
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
