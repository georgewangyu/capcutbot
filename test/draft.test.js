import assert from 'node:assert/strict';
import test from 'node:test';
import { draftSummary, listAudioSegments, listTextSegments, replaceVoiceover, secondsToMicros } from '../src/draft.js';

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
                { id: 'text-1', content: JSON.stringify({ text: 'Budget my Paycheck' }) },
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
