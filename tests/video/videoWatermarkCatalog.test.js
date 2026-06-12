import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getReferenceVideoWatermarkCatalog,
    resolveVideoWatermarkCandidates
} from '../../src/video/videoWatermarkCatalog.js';

test('resolveVideoWatermarkCandidates should expose confirmed 1920x1080 positions', () => {
    const candidates = resolveVideoWatermarkCandidates(1920, 1080);

    assert.equal(candidates.length, 2);
    assert.deepEqual(
        candidates.map((candidate) => ({
            id: candidate.id,
            x: candidate.x,
            y: candidate.y,
            size: candidate.size
        })),
        [
            { id: 'veo-1080p-standard', x: 1740, y: 900, size: 72 },
            { id: 'veo-1080p-inset', x: 1704, y: 864, size: 72 }
        ]
    );
});

test('resolveVideoWatermarkCandidates should expose allenk 720p variants', () => {
    const candidates = resolveVideoWatermarkCandidates(1280, 720);

    assert.deepEqual(
        candidates.map((candidate) => ({
            id: candidate.id,
            x: candidate.x,
            y: candidate.y,
            size: candidate.size
        })),
        [
            { id: 'veo-720p-1-standard', x: 1160, y: 600, size: 48 },
            { id: 'veo-720p-2-compact', x: 1207, y: 636, size: 44 }
        ]
    );
});

test('getReferenceVideoWatermarkCatalog should return defensive copies', () => {
    const first = getReferenceVideoWatermarkCatalog();
    const second = getReferenceVideoWatermarkCatalog();

    first.candidates[0].size = 1;

    assert.equal(second.candidates[0].size, 72);
});
