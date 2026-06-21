import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { draftSummary, duplicateDraftProject, listAudioSegments, listTextSegments, replaceText, replaceVoiceover, secondsToMicros } from '../src/draft.js';

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
                { id: 'text-1', content: JSON.stringify({ styles: [{ range: [0, 18] }], text: 'Budget my Paycheck' }) },
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
        ],
    };
}

test('summarizes tracks and materials', () => {
    const summary = draftSummary(fixtureDraft());
    assert.equal(summary.name, 'fixture');
    assert.equal(summary.durationSeconds, 10);
    assert.deepEqual(summary.trackTypes, { text: 1, audio: 1 });
    assert.equal(summary.materialTypes.audios, 1);
});

test('lists text and audio segments with seconds', () => {
    const draft = fixtureDraft();
    assert.equal(listTextSegments(draft)[0].text, 'Budget my Paycheck');
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
        match: 'Budget',
        text: '5 AI Skills I\nWish I Knew Last Year',
    });

    assert.equal(result.previousText, 'Budget my Paycheck');
    assert.equal(listTextSegments(draft)[0].text, '5 AI Skills I\nWish I Knew Last Year');
    assert.deepEqual(JSON.parse(draft.materials.texts[0].content).styles[0].range, [0, 35]);
});

test('duplicates a draft project folder without copying lock file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcutbot-test-'));
    const source = path.join(root, 'Source Project');
    const target = path.join(root, 'Target Project');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'draft_info.json'), JSON.stringify(fixtureDraft()));
    fs.writeFileSync(path.join(source, '.locked'), '');

    const result = duplicateDraftProject(source, target);

    assert.equal(result.copied, true);
    assert.equal(fs.existsSync(path.join(target, 'draft_info.json')), true);
    assert.equal(fs.existsSync(path.join(target, '.locked')), false);
});
