import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { addAudioOverlayFromDraft, addTextOverlayFromDraft, addVideoOverlay, draftSummary, duplicateDraftProject, importProjectVideoMedia, listAudioSegments, listTextSegments, localizeAudioOverlayMedia, refreshVideoOverlayMetadata, removeTextOverlays, repairProjectVideoMediaIndex, replaceText, replaceVoiceover, saveDraft, secondsToMicros, updateAudioOverlay, updateTextOverlay, updateVideoOverlay } from '../src/draft.js';
import { isCapCutRunning, warnIfCapCutRunning } from '../src/capcut.js';
import { projectMediaPlaceholder } from '../src/paths.js';

function fixtureDraft() {
    return {
        name: 'fixture',
        duration: 10_000_000,
        fps: 30,
        materials: {
            audios: [
                { id: 'audio-1', type: 'record', name: 'Voiceover2', duration: 10_000_000, path: 'old.aac' },
            ],
            texts: [
                { id: 'text-1', content: JSON.stringify({ styles: [{ range: [0, 16] }], text: 'Template Heading' }) },
            ],
            videos: [
                { id: 'video-1', type: 'video', material_name: 'main.mp4', duration: 10_000_000, path: 'main.mp4', width: 1080, height: 1920 },
            ],
            material_animations: [
                { id: 'animation-1', type: 'sticker_animation', animations: [{ linked_material_id: 'effect-1' }] },
            ],
            effects: [
                { id: 'effect-1', type: 'text_effect', name: 'pop' },
            ],
        },
        tracks: [
            {
                type: 'text',
                segments: [{ id: 'seg-text', material_id: 'text-1', target_timerange: { start: 1_000_000, duration: 2_000_000 } }],
            },
            {
                type: 'audio',
                segments: [{ id: 'seg-audio', material_id: 'audio-1', target_timerange: { start: 0, duration: 10_000_000 }, source_timerange: { start: 0, duration: 10_000_000 }, volume: 1 }],
            },
            {
                id: 'track-video',
                type: 'video',
                segments: [{ id: 'seg-video', material_id: 'video-1', extra_material_refs: [], target_timerange: { start: 0, duration: 10_000_000 }, source_timerange: { start: 0, duration: 10_000_000 }, clip: { scale: { x: 1, y: 1 } }, speed: 1 }],
            },
        ],
    };
}

test('summarizes tracks and materials', () => {
    const summary = draftSummary(fixtureDraft());
    assert.equal(summary.name, 'fixture');
    assert.equal(summary.durationSeconds, 10);
    assert.deepEqual(summary.trackTypes, { text: 1, audio: 1, video: 1 });
    assert.equal(summary.materialTypes.audios, 1);
});

test('lists text and audio segments with seconds', () => {
    const draft = fixtureDraft();
    assert.equal(listTextSegments(draft)[0].text, 'Template Heading');
    assert.equal(listTextSegments(draft)[0].startSeconds, 1);
    assert.equal(listAudioSegments(draft)[0].name, 'Voiceover2');
});

test('replaces matching voiceover material and extends duration', () => {
    const draft = fixtureDraft();
    const result = replaceVoiceover(draft, '/tmp/capcutbot-test-project', '/bin/sh', {
        dryRun: true,
        keepMaterialId: true,
        name: 'clean voiceover',
        filename: 'clean.aac',
        durationMicros: secondsToMicros(12.5),
        extendDuration: true,
    });
    assert.equal(result.durationSeconds, 12.5);
    assert.equal(draft.duration, 12_500_000);
    assert.equal(draft.materials.audios[0].name, 'clean voiceover');
    assert.match(draft.materials.audios[0].path, /audio_record\/clean\.aac$/);
    assert.equal(draft.tracks[1].segments[0].target_timerange.duration, 12_500_000);
});

test('replaces matching text material content', () => {
    const draft = fixtureDraft();
    const result = replaceText(draft, {
        match: 'Template',
        text: '5 AI Skills I\nWish I Knew Last Year',
    });

    assert.equal(result.previousText, 'Template Heading');
    assert.equal(listTextSegments(draft)[0].text, '5 AI Skills I\nWish I Knew Last Year');
    assert.deepEqual(JSON.parse(draft.materials.texts[0].content).styles[0].range, [0, 35]);
});

test('updates text overlay timing and position', () => {
    const draft = fixtureDraft();
    const result = updateTextOverlay(draft, {
        materialId: 'text-1',
        text: 'Food: $745',
        startMicros: secondsToMicros(21.54),
        durationMicros: secondsToMicros(41.493),
        scale: 0.8,
        x: 0.18,
        y: -0.18,
    });

    assert.equal(result.text, 'Food: $745');
    assert.equal(result.startSeconds, 21.54);
    assert.equal(result.durationSeconds, 41.493);
    assert.equal(result.scale, 0.8);
    assert.equal(result.x, 0.18);
    assert.equal(result.y, -0.18);
});

test('updates an existing video overlay geometry', () => {
    const draft = fixtureDraft();
    const result = updateVideoOverlay(draft, {
        materialId: 'video-1',
        scale: 0.82,
        x: 0,
        y: 0.28,
    });

    assert.equal(result.scale, 0.82);
    assert.equal(result.x, 0);
    assert.equal(result.y, 0.28);
    assert.deepEqual(draft.tracks[2].segments[0].clip.scale, { x: 0.82, y: 0.82 });
});

test('updates an existing audio overlay timing and volume', () => {
    const draft = fixtureDraft();
    const result = updateAudioOverlay(draft, {
        materialId: 'audio-1',
        startMicros: 6_650_000,
        volume: 0.18,
    });
    assert.equal(result.startSeconds, 6.65);
    assert.equal(result.volume, 0.18);
    assert.equal(draft.tracks[result.trackIndex].segments[0].target_timerange.start, 6_650_000);
});

test('refreshes replaced video overlay metadata', () => {
    const draft = fixtureDraft();
    const result = refreshVideoOverlayMetadata(draft, {
        materialId: 'video-1',
        mediaMetadata: { width: 1080, height: 1920, hasAudio: false },
        durationMicros: 5_000_000,
    });
    assert.equal(result.height, 1920);
    assert.equal(result.hasAudio, false);
    assert.equal(draft.materials.videos[0].duration, 5_000_000);
});

test('removes text overlays while preserving an exact title', () => {
    const draft = fixtureDraft();
    draft.materials.texts.push({ id: 'text-2', content: JSON.stringify({ styles: [{ range: [0, 6] }], text: 'REMOVE' }) });
    draft.materials.material_animations.push({ id: 'animation-remove', type: 'sticker_animation' });
    draft.tracks.push({
        type: 'text',
        segments: [{
            id: 'seg-remove',
            material_id: 'text-2',
            extra_material_refs: ['animation-remove'],
            target_timerange: { start: 4_000_000, duration: 2_000_000 },
        }],
    });

    const result = removeTextOverlays(draft, { keepTexts: ['Template Heading'] });

    assert.equal(result.removedTracks, 1);
    assert.equal(result.removedTextMaterials, 1);
    assert.equal(result.removedExtraMaterials, 1);
    assert.deepEqual(listTextSegments(draft).map((entry) => entry.text), ['Template Heading']);
    assert.equal(draft.materials.material_animations.some((item) => item.id === 'animation-remove'), false);
});

test('preserves native caption segments that use a separate material id space', () => {
    const draft = fixtureDraft();
    draft.tracks[0].segments[0].material_id = 'caption-template-material-id';
    draft.materials.texts.push({ id: 'text-2', content: JSON.stringify({ text: 'REMOVE' }) });
    draft.tracks.push({
        type: 'text',
        segments: [{
            id: 'seg-remove',
            material_id: 'text-2',
            extra_material_refs: [],
            target_timerange: { start: 4_000_000, duration: 2_000_000 },
        }],
    });

    const result = removeTextOverlays(draft);

    assert.equal(result.removedTracks, 1);
    assert.equal(result.removedSegments, 1);
    assert.equal(draft.tracks.some((track) => track.segments?.some((segment) => segment.material_id === 'caption-template-material-id')), true);
});

test('registers project-local video overlays in CapCut media sidecars', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcutbot-media-index-'));
    const mediaDir = path.join(root, 'capcutbot_media');
    fs.mkdirSync(mediaDir);
    fs.writeFileSync(path.join(mediaDir, 'overlay.mp4'), 'fixture');
    fs.writeFileSync(path.join(root, 'draft_meta_info.json'), JSON.stringify({
        draft_materials: [{ type: 0, value: [] }],
    }));
    fs.writeFileSync(path.join(root, 'draft_virtual_store.json'), JSON.stringify({
        draft_virtual_store: [{ type: 1, value: [] }],
    }));
    const draft = fixtureDraft();
    draft.materials.videos.push({
        id: 'video-overlay',
        path: `${root}/capcutbot_media/overlay.mp4`,
        duration: 3_000_000,
        width: 840,
        height: 540,
        local_material_id: 'stale-id',
    });

    const result = repairProjectVideoMediaIndex(draft, root);

    assert.equal(result.registered.length, 1);
    assert.equal(result.reused.length, 0);
    assert.notEqual(draft.materials.videos.at(-1).local_material_id, 'stale-id');
    const localId = draft.materials.videos.at(-1).local_material_id;
    const meta = JSON.parse(fs.readFileSync(path.join(root, 'draft_meta_info.json'), 'utf8'));
    const virtual = JSON.parse(fs.readFileSync(path.join(root, 'draft_virtual_store.json'), 'utf8'));
    assert.equal(meta.draft_materials[0].value[0].id, localId);
    assert.equal(meta.draft_materials[0].value[0].file_Path, './capcutbot_media/overlay.mp4');
    assert.deepEqual(virtual.draft_virtual_store[0].value, [{ child_id: localId, parent_id: '' }]);
    assert.equal(result.sidecarBackups.length, 2);

    const second = repairProjectVideoMediaIndex(draft, root, { dryRun: true });
    assert.equal(second.registered.length, 0);
    assert.equal(second.reused.length, 1);
});

test('duplicates a draft project folder without copying lock file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcutbot-test-'));
    const source = path.join(root, 'Source Project');
    const target = path.join(root, 'Target Project');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'draft_info.json'), JSON.stringify(fixtureDraft()));
    fs.writeFileSync(path.join(source, 'draft_meta_info.json'), JSON.stringify({
        draft_id: 'source-draft-id',
        draft_name: 'Source Project',
        draft_root_path: root,
        draft_fold_path: source,
        tm_draft_modified: 1,
    }));
    fs.writeFileSync(path.join(source, '.locked'), '');

    const result = duplicateDraftProject(source, target);

    assert.equal(result.copied, true);
    assert.equal(fs.existsSync(path.join(target, 'draft_info.json')), true);
    assert.equal(fs.existsSync(path.join(target, '.locked')), false);
    const targetMeta = JSON.parse(fs.readFileSync(path.join(target, 'draft_meta_info.json'), 'utf8'));
    assert.notEqual(targetMeta.draft_id, 'source-draft-id');
    assert.equal(targetMeta.draft_name, 'Target Project');
    assert.equal(targetMeta.draft_fold_path, target);
});

test('reports CapCut state without blocking draft writes', () => {
    const stopped = () => ({ status: 1 });
    const running = () => ({ status: 0 });
    const messages = [];
    assert.equal(isCapCutRunning({ platform: 'darwin', run: stopped }), false);
    assert.equal(isCapCutRunning({ platform: 'darwin', run: running }), true);
    assert.equal(warnIfCapCutRunning({ platform: 'darwin', run: stopped, write: (message) => messages.push(message) }), false);
    assert.equal(warnIfCapCutRunning({ platform: 'darwin', run: running, target: 'Version 4', write: (message) => messages.push(message) }), true);
    assert.deepEqual(messages, [
        'Info: CapCut is running; continuing with Version 4. If this exact draft is open in CapCut, a later autosave may overwrite external changes.',
    ]);
});

test('saves every canonical CapCut timeline graph copy together', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcutbot-save-'));
    const timeline = path.join(root, 'Timelines', 'timeline-id');
    fs.mkdirSync(timeline, { recursive: true });
    const graphFiles = [
        path.join(root, 'draft_info.json'),
        path.join(root, 'template-2.tmp'),
        path.join(timeline, 'draft_info.json'),
        path.join(timeline, 'template-2.tmp'),
    ];
    for (const file of graphFiles) fs.writeFileSync(file, JSON.stringify({ name: 'old' }));

    const result = saveDraft(graphFiles[0], { name: 'new', duration: 1 });

    assert.deepEqual(result.synchronizedFiles.sort(), graphFiles.sort());
    assert.equal(result.backupFiles.length, 4);
    for (const file of graphFiles) assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).name, 'new');
    for (const file of result.backupFiles) assert.equal(fs.existsSync(file), true);
});

test('adds a dry-run full-frame video overlay with exact timing from an archetype', () => {
    const draft = fixtureDraft();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcutbot-overlay-'));
    const asset = path.join(root, 'overlay.mp4');
    fs.writeFileSync(asset, 'fixture');
    const ids = ['video-new', 'segment-new', 'track-new'][Symbol.iterator]();

    const result = addVideoOverlay(draft, root, asset, {
        dryRun: true,
        startMicros: 2_500_000,
        durationMicros: 3_250_000,
        assetDurationMicros: 4_000_000,
        mediaMetadata: { width: 840, height: 540, hasAudio: false },
        scale: 0.7,
        x: -0.25,
        y: 0.2,
        idFactory: () => ids.next().value,
    });

    const segment = draft.tracks[result.trackIndex].segments[0];
    assert.deepEqual(segment.target_timerange, { start: 2_500_000, duration: 3_250_000 });
    assert.deepEqual(segment.source_timerange, { start: 0, duration: 3_250_000 });
    assert.deepEqual(segment.clip, { scale: { x: 0.7, y: 0.7 }, transform: { x: -0.25, y: 0.2 } });
    assert.equal(result.scale, 0.7);
    assert.equal(result.x, -0.25);
    assert.equal(result.y, 0.2);
    assert.equal(draft.materials.videos.at(-1).id, 'video-new');
    assert.equal(draft.materials.videos.at(-1).width, 840);
    assert.equal(draft.materials.videos.at(-1).height, 540);
    assert.equal(draft.materials.videos.at(-1).has_audio, false);
    assert.match(draft.materials.videos.at(-1).path, /capcutbot_media\/overlay\.mp4$/);
    assert.equal(fs.existsSync(path.join(root, 'capcutbot_media', 'overlay.mp4')), false);
});

test('adds a video overlay from a cross-draft archetype when the target only has a compound clip', () => {
    const target = fixtureDraft();
    target.materials.videos[0].material_name = 'Compound clip1';
    const source = fixtureDraft();
    source.materials.videos[0].id = 'regular-video';
    source.materials.videos[0].material_name = 'Known good overlay';
    source.tracks.find((track) => track.type === 'video').segments[0].material_id = 'regular-video';
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcutbot-cross-video-'));
    const asset = path.join(root, 'overlay.mp4');
    fs.writeFileSync(asset, 'fixture');
    const ids = ['video-new', 'segment-new', 'track-new'][Symbol.iterator]();

    const result = addVideoOverlay(target, root, asset, {
        dryRun: true,
        sourceDraft: source,
        archetypeMaterialId: 'regular-video',
        startMicros: 1_000_000,
        durationMicros: 2_000_000,
        assetDurationMicros: 2_500_000,
        mediaMetadata: { width: 1080, height: 1920, hasAudio: false },
        idFactory: () => ids.next().value,
    });

    assert.equal(target.materials.videos.at(-1).material_name, 'overlay.mp4');
    assert.equal(target.tracks[result.trackIndex].segments[0].material_id, 'video-new');
    assert.equal(target.tracks[result.trackIndex].segments[0].track_render_index, result.trackIndex);
    assert.equal(result.copiedExtraMaterials, 0);
});

test('rejects a compound clip as a video overlay archetype', () => {
    const draft = fixtureDraft();
    draft.materials.drafts = [{ id: 'compound-draft', type: 'combination' }];
    draft.materials.videos[0].material_name = 'Compound clip1';
    draft.materials.videos[0].extra_type_option = 2;
    draft.materials.videos[0].path = `${projectMediaPlaceholder()}/Resources/combination/compound_video.mp4`;
    draft.tracks.find((track) => track.type === 'video').segments[0].extra_material_refs = ['compound-draft'];
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcutbot-compound-reject-'));
    const asset = path.join(root, 'overlay.mp4');
    fs.writeFileSync(asset, 'fixture');

    assert.throws(() => addVideoOverlay(draft, root, asset, {
        dryRun: true,
        startMicros: 1_000_000,
        durationMicros: 2_000_000,
        assetDurationMicros: 2_000_000,
    }), /safe ordinary video-overlay archetype/);
});

test('plans media-index registration for a dry-run video overlay before media is copied', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcutbot-media-dry-run-'));
    fs.writeFileSync(path.join(root, 'draft_meta_info.json'), JSON.stringify({ draft_materials: [] }));
    fs.writeFileSync(path.join(root, 'draft_virtual_store.json'), JSON.stringify({ draft_virtual_store: [] }));
    const draft = {
        materials: {
            videos: [{
                id: 'planned-video',
                path: `${projectMediaPlaceholder()}/capcutbot_media/planned.mp4`,
                duration: 1_000_000,
                width: 1080,
                height: 1920,
                local_material_id: '',
            }],
        },
    };

    const result = repairProjectVideoMediaIndex(draft, root, { dryRun: true });

    assert.equal(result.registered.length, 1);
    assert.equal(result.registered[0].materialId, 'planned-video');
    assert.equal(fs.existsSync(path.join(root, 'capcutbot_media', 'planned.mp4')), false);
});

test('recovers a CapCut-saved video material whose path was blanked', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcutbot-media-recovery-'));
    const mediaDir = path.join(root, 'capcutbot_media');
    fs.mkdirSync(mediaDir);
    fs.writeFileSync(path.join(mediaDir, 'recovered.mp4'), 'fixture');
    fs.writeFileSync(path.join(root, 'draft_meta_info.json'), JSON.stringify({
        draft_materials: [{ type: 0, value: [] }],
    }));
    fs.writeFileSync(path.join(root, 'draft_virtual_store.json'), JSON.stringify({
        draft_virtual_store: [{ type: 1, value: [{ child_id: 'persisted-local-id', parent_id: '' }] }],
    }));
    const draft = {
        materials: {
            videos: [{
                id: 'video-recovered',
                material_name: 'recovered.mp4',
                path: '',
                media_path: '',
                duration: 3_000_000,
                width: 1080,
                height: 1920,
                local_material_id: 'persisted-local-id',
            }],
        },
    };

    const result = repairProjectVideoMediaIndex(draft, root);

    assert.equal(result.registered.length, 1);
    assert.equal(result.registered[0].localMaterialId, 'persisted-local-id');
    const meta = JSON.parse(fs.readFileSync(path.join(root, 'draft_meta_info.json'), 'utf8'));
    assert.equal(meta.draft_materials[0].value[0].id, 'persisted-local-id');
    assert.equal(meta.draft_materials[0].value[0].file_Path, './capcutbot_media/recovered.mp4');
});

test('reuses CapCut native relative project-media records', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcutbot-relative-media-'));
    const mediaDir = path.join(root, 'capcutbot_media');
    fs.mkdirSync(mediaDir);
    fs.writeFileSync(path.join(mediaDir, 'native.mp4'), 'fixture');
    fs.writeFileSync(path.join(root, 'draft_meta_info.json'), JSON.stringify({
        draft_materials: [{ type: 0, value: [{
            id: 'native-local-id',
            file_Path: './capcutbot_media/native.mp4',
            duration: 1,
            roughcut_time_range: { duration: 1, start: 0 },
        }] }],
    }));
    fs.writeFileSync(path.join(root, 'draft_virtual_store.json'), JSON.stringify({
        draft_virtual_store: [{ type: 1, value: [] }],
    }));
    const draft = {
        materials: {
            videos: [{
                id: 'video-native',
                material_name: 'native.mp4',
                path: '',
                duration: 3_000_000,
                width: 1080,
                height: 1920,
                local_material_id: 'stale-generated-id',
            }],
        },
    };

    const result = repairProjectVideoMediaIndex(draft, root);

    assert.equal(result.registered.length, 0);
    assert.equal(result.reused.length, 1);
    assert.equal(draft.materials.videos[0].local_material_id, 'native-local-id');
});

test('imports project media before timeline placement using a relative CapCut record', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcutbot-import-media-'));
    const source = path.join(root, 'source.mp4');
    fs.writeFileSync(source, 'fixture');
    fs.writeFileSync(path.join(root, 'draft_meta_info.json'), JSON.stringify({
        draft_materials: [{ type: 0, value: [] }],
    }));
    fs.writeFileSync(path.join(root, 'draft_virtual_store.json'), JSON.stringify({
        draft_virtual_store: [{ type: 1, value: [] }],
    }));

    const result = importProjectVideoMedia(root, source, {
        width: 1080,
        height: 1920,
        hasAudio: false,
    }, {
        filename: 'imported.mp4',
        durationMicros: 3_000_000,
    });

    assert.equal(fs.existsSync(path.join(root, 'capcutbot_media', 'imported.mp4')), true);
    assert.ok(result.localMaterialId);
    const meta = JSON.parse(fs.readFileSync(path.join(root, 'draft_meta_info.json'), 'utf8'));
    assert.equal(meta.draft_materials[0].value[0].id, result.localMaterialId);
    assert.equal(meta.draft_materials[0].value[0].file_Path, './capcutbot_media/imported.mp4');
});

test('adds a dry-run audio overlay from a cross-draft archetype with exact timing and volume', () => {
    const source = fixtureDraft();
    source.materials.audios[0].type = 'sound';
    source.materials.audio_fades = [{ id: 'fade-1', fade_in_duration: 0, fade_out_duration: 0 }];
    source.tracks[1].id = 'track-audio';
    source.tracks[1].segments[0].extra_material_refs = ['fade-1'];
    const target = fixtureDraft();
    target.materials.audio_fades = [];
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcutbot-audio-overlay-'));
    const asset = path.join(root, 'pop.mp3');
    fs.writeFileSync(asset, 'fixture');
    const ids = ['audio-new', 'segment-new', 'track-new', 'fade-new'][Symbol.iterator]();

    const result = addAudioOverlayFromDraft(target, source, root, asset, {
        dryRun: true,
        archetypeMaterialId: 'audio-1',
        startMicros: 9_633_333,
        durationMicros: 366_667,
        assetDurationMicros: 364_717,
        volume: 0.29690104722976685,
        type: 'sound',
        name: 'Example effect',
        idFactory: () => ids.next().value,
    });

    const segment = target.tracks[result.trackIndex].segments[0];
    assert.deepEqual(segment.target_timerange, { start: 9_633_333, duration: 366_667 });
    assert.deepEqual(segment.source_timerange, { start: 0, duration: 366_667 });
    assert.deepEqual(segment.extra_material_refs, ['fade-new']);
    assert.equal(segment.volume, 0.29690104722976685);
    assert.equal(target.materials.audios.at(-1).type, 'sound');
    assert.equal(target.materials.audios.at(-1).name, 'Example effect');
    assert.equal(target.materials.audios.at(-1).duration, 366_667);
    assert.equal(target.materials.audio_fades[0].id, 'fade-new');
    assert.match(target.materials.audios.at(-1).path, /capcutbot_media\/pop\.mp3$/);
    assert.equal(fs.existsSync(path.join(root, 'capcutbot_media', 'pop.mp3')), false);
});

test('reuses an identical project-local audio asset for repeated overlays', () => {
    const draft = fixtureDraft();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcutbot-audio-reuse-'));
    const asset = path.join(root, 'pop.mp3');
    const mediaDir = path.join(root, 'capcutbot_media');
    fs.writeFileSync(asset, 'same pop');
    fs.mkdirSync(mediaDir);
    fs.copyFileSync(asset, path.join(mediaDir, 'pop.mp3'));

    const result = addAudioOverlayFromDraft(draft, draft, root, asset, {
        startMicros: 2_000_000,
        durationMicros: 366_667,
        assetDurationMicros: 364_717,
        volume: 0.29690104722976685,
    });

    assert.equal(result.destinationPath, path.join(mediaDir, 'pop.mp3'));
    assert.equal(fs.readFileSync(result.destinationPath, 'utf8'), 'same pop');
});

test('localizes an audio material to existing CapCutBot media', () => {
    const draft = fixtureDraft();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcutbot-audio-localize-'));
    fs.mkdirSync(path.join(root, 'capcutbot_media'));
    fs.writeFileSync(path.join(root, 'capcutbot_media', 'pop.mp3'), 'pop');

    const result = localizeAudioOverlayMedia(draft, root, { materialId: 'audio-1', filename: 'pop.mp3' });

    assert.equal(result.previousPath, 'old.aac');
    assert.match(draft.materials.audios[0].path, /capcutbot_media\/pop\.mp3$/);
});

test('clones text style and recursively remaps referenced extra materials', () => {
    const source = fixtureDraft();
    source.tracks[0].id = 'track-text';
    source.tracks[0].segments[0].extra_material_refs = ['animation-1'];
    const target = fixtureDraft();
    target.materials.texts = [];
    target.materials.material_animations = [];
    target.materials.effects = [];
    target.tracks = target.tracks.filter((track) => track.type !== 'text');
    const ids = ['text-new', 'segment-new', 'track-new', 'animation-new', 'effect-new'][Symbol.iterator]();

    const result = addTextOverlayFromDraft(target, source, {
        sourceText: 'Template Heading',
        text: 'Updated Title',
        startMicros: 4_000_000,
        durationMicros: 1_500_000,
        idFactory: () => ids.next().value,
    });

    const segment = target.tracks[result.trackIndex].segments[0];
    assert.deepEqual(segment.target_timerange, { start: 4_000_000, duration: 1_500_000 });
    assert.deepEqual(segment.extra_material_refs, ['animation-new']);
    assert.equal(target.materials.material_animations[0].id, 'animation-new');
    assert.equal(target.materials.material_animations[0].animations[0].linked_material_id, 'effect-new');
    assert.equal(target.materials.effects[0].id, 'effect-new');
    assert.equal(JSON.parse(target.materials.texts[0].content).text, 'Updated Title');
    assert.deepEqual(JSON.parse(target.materials.texts[0].content).styles[0].range, [0, 13]);
    assert.equal(result.copiedExtraMaterials, 2);
});
