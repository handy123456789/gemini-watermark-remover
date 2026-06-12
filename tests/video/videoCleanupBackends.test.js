import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_DENOISE_BACKEND,
    DEFAULT_EDGE_DENOISE_STRENGTH,
    DEFAULT_HIGH_QUALITY_CLEANUP,
    DEFAULT_RESIDUAL_CLEANUP_STRENGTH,
    DEFAULT_TEXTURE_REPAIR,
    DEFAULT_TEXTURE_REPAIR_STRENGTH,
    VIDEO_CLEANUP_BACKENDS,
    VIDEO_DENOISE_BACKENDS,
    applyVideoResidualCleanup,
    buildEdgeBandDenoiseWeightMap,
    buildFootprintPolishWeightMap,
    buildGradientWeightMap,
    buildTextureRepairWeightMap,
    normalizeVideoCleanupOptions
} from '../../src/video/videoCleanupBackends.js';
import { getVideoAlphaMap } from '../../src/video/videoWatermarkDetector.js';

function createDiamondAlphaMap(width, height) {
    const alphaMap = new Float32Array(width * height);
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const radius = Math.min(width, height) / 2;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const distance = (Math.abs(x - cx) + Math.abs(y - cy)) / radius;
            alphaMap[y * width + x] = Math.max(0, 0.28 * (1 - distance));
        }
    }

    return alphaMap;
}

test('normalizeVideoCleanupOptions should keep conservative defaults', () => {
    const normalized = normalizeVideoCleanupOptions();

    assert.equal(normalized.residualCleanupStrength, DEFAULT_RESIDUAL_CLEANUP_STRENGTH);
    assert.equal(normalized.cleanupBackend, VIDEO_CLEANUP_BACKENDS.CANVAS_SOFT);
    assert.equal(normalized.highQualityCleanup, DEFAULT_HIGH_QUALITY_CLEANUP);
    assert.equal(normalized.denoiseBackend, DEFAULT_DENOISE_BACKEND);
    assert.equal(normalized.edgeDenoiseStrength, DEFAULT_EDGE_DENOISE_STRENGTH);
    assert.equal(normalized.textureRepair, DEFAULT_TEXTURE_REPAIR);
    assert.equal(normalized.textureRepairStrength, DEFAULT_TEXTURE_REPAIR_STRENGTH);
    assert.equal(VIDEO_CLEANUP_BACKENDS.CANVAS_SOFT, 'canvas-soft');
    assert.equal(VIDEO_DENOISE_BACKENDS.CANVAS_EDGE_BAND_DENOISE, 'canvas-edge-band-denoise');
    assert.equal(VIDEO_DENOISE_BACKENDS.CANVAS_EDGE_CORE_DENOISE, 'canvas-edge-core-denoise');
    assert.equal(VIDEO_DENOISE_BACKENDS.CANVAS_FOOTPRINT_POLISH, 'canvas-footprint-polish');
    assert.equal(VIDEO_DENOISE_BACKENDS.CANVAS_TEMPORAL_DELTA_STABILIZE, 'canvas-temporal-delta-stabilize');
    assert.equal(VIDEO_DENOISE_BACKENDS.CANVAS_TEMPORAL_MATCH_DELTA_STABILIZE, 'canvas-temporal-match-delta-stabilize');
    assert.equal(VIDEO_DENOISE_BACKENDS.CANVAS_TEMPORAL_STABILIZE, 'canvas-temporal-stabilize');
    assert.equal(VIDEO_DENOISE_BACKENDS.CANVAS_TEXTURE_REPAIR, 'canvas-texture-repair');
});

test('normalizeVideoCleanupOptions should clamp numeric cleanup controls', () => {
    assert.deepEqual(
        normalizeVideoCleanupOptions({
            residualCleanupStrength: 9,
            highQualityCleanup: true,
            textureRepair: true,
            textureRepairStrength: 2
        }),
        {
            residualCleanupStrength: 1.8,
            cleanupBackend: 'canvas-bilateral',
            highQualityCleanup: true,
            denoiseBackend: 'canvas-texture-repair',
            edgeDenoiseStrength: DEFAULT_EDGE_DENOISE_STRENGTH,
            textureRepair: true,
            textureRepairStrength: 1
        }
    );
});

test('normalizeVideoCleanupOptions should prefer explicit denoise backend over legacy texture flag', () => {
    assert.equal(
        normalizeVideoCleanupOptions({
            denoiseBackend: VIDEO_DENOISE_BACKENDS.CANVAS_TEXTURE_REPAIR,
            textureRepair: false
        }).textureRepair,
        true
    );
    assert.equal(
        normalizeVideoCleanupOptions({
            denoiseBackend: VIDEO_DENOISE_BACKENDS.NONE,
            textureRepair: true
        }).textureRepair,
        false
    );
    const edgeDenoise = normalizeVideoCleanupOptions({
        denoiseBackend: VIDEO_DENOISE_BACKENDS.CANVAS_EDGE_DENOISE,
        textureRepair: true,
        edgeDenoiseStrength: 2
    });

    assert.equal(edgeDenoise.denoiseBackend, VIDEO_DENOISE_BACKENDS.CANVAS_EDGE_DENOISE);
    assert.equal(edgeDenoise.edgeDenoiseStrength, 1);
    assert.equal(edgeDenoise.textureRepair, false);
    assert.equal(
        normalizeVideoCleanupOptions({
            denoiseBackend: VIDEO_DENOISE_BACKENDS.CANVAS_EDGE_BAND_DENOISE
        }).denoiseBackend,
        VIDEO_DENOISE_BACKENDS.CANVAS_EDGE_BAND_DENOISE
    );
});

test('buildGradientWeightMap should emphasize alpha edges', () => {
    const width = 7;
    const height = 7;
    const alphaMap = createDiamondAlphaMap(width, height);
    const weights = buildGradientWeightMap(alphaMap, width, height, 1.5);
    const center = weights[3 * width + 3];
    const edge = weights[2 * width + 3];

    assert.equal(weights.length, width * height);
    assert.ok(edge > 0);
    assert.ok(Math.max(...weights) <= 1);
    assert.ok(edge >= center);
});

test('buildGradientWeightMap should include crop-boundary alpha edges', () => {
    const width = 3;
    const height = 3;
    const alphaMap = new Float32Array([
        0, 1, 0,
        0, 0, 0,
        0, 0, 0
    ]);
    const weights = buildGradientWeightMap(alphaMap, width, height, 1);

    assert.ok(weights[1] > 0);
    assert.ok(Math.max(...weights) <= 1);
});

test('buildEdgeBandDenoiseWeightMap should include crop-boundary alpha edges', () => {
    const width = 3;
    const height = 3;
    const alphaMap = new Float32Array([
        0, 1, 0,
        0, 0, 0,
        0, 0, 0
    ]);
    const weights = buildEdgeBandDenoiseWeightMap(alphaMap, width, height, 1);

    assert.ok(weights[1] > 0);
    assert.ok(Math.max(...weights) <= 1);
});

test('buildTextureRepairWeightMap should remain disabled at zero strength', () => {
    const width = 7;
    const height = 7;
    const alphaMap = createDiamondAlphaMap(width, height);
    const weights = buildTextureRepairWeightMap(alphaMap, width, height, 0);

    assert.equal(weights.length, width * height);
    assert.equal(Math.max(...weights), 0);
});

test('buildEdgeBandDenoiseWeightMap should guard high-alpha body pixels', () => {
    const width = 72;
    const height = 72;
    const alphaMap = getVideoAlphaMap(width);
    const gradientWeights = buildGradientWeightMap(alphaMap, width, height, 1);
    const bandWeights = buildEdgeBandDenoiseWeightMap(alphaMap, width, height, 1);
    const center = 36 * width + 36;
    const edge = 0 * width + 36;

    assert.equal(bandWeights.length, width * height);
    assert.ok(bandWeights[edge] > bandWeights[center]);
    assert.ok(bandWeights[center] < gradientWeights[center]);
    assert.ok(Math.max(...bandWeights) <= 1);
});

test('buildEdgeBandDenoiseWeightMap should remain disabled at zero strength', () => {
    const width = 7;
    const height = 7;
    const alphaMap = createDiamondAlphaMap(width, height);
    const weights = buildEdgeBandDenoiseWeightMap(alphaMap, width, height, 0);

    assert.equal(weights.length, width * height);
    assert.equal(Math.max(...weights), 0);
});

test('buildTextureRepairWeightMap should activate inside alpha footprint', () => {
    const width = 7;
    const height = 7;
    const alphaMap = createDiamondAlphaMap(width, height);
    const weights = buildTextureRepairWeightMap(alphaMap, width, height, 0.85);

    assert.equal(weights.length, width * height);
    assert.ok(weights[3 * width + 3] > 0);
    assert.ok(Math.max(...weights) <= 1);
});

test('buildFootprintPolishWeightMap should cover alpha body and edges conservatively', () => {
    const width = 72;
    const height = 72;
    const alphaMap = getVideoAlphaMap(width);
    const weights = buildFootprintPolishWeightMap(alphaMap, width, height, 0.65);
    const center = 36 * width + 36;
    const edge = 0 * width + 36;

    assert.equal(weights.length, width * height);
    assert.ok(weights[center] > 0);
    assert.ok(weights[edge] > 0);
    assert.ok(Math.max(...weights) <= 1);
});

test('applyVideoResidualCleanup should not touch canvas when cleanup is disabled', () => {
    const ctx = {
        canvas: { width: 16, height: 16 },
        getImageData() {
            throw new Error('getImageData should not be called');
        },
        putImageData() {
            throw new Error('putImageData should not be called');
        }
    };

    const result = applyVideoResidualCleanup(ctx, {
        x: 4,
        y: 4,
        width: 4,
        height: 4
    }, new Float32Array(16), {
        residualCleanupStrength: 0,
        textureRepair: false
    });

    assert.equal(result.residualCleanupStrength, 0);
    assert.equal(result.textureRepair, false);
});

test('applyVideoResidualCleanup should route canvas edge denoise backend', () => {
    const image = {
        width: 20,
        height: 20,
        data: new Uint8ClampedArray(20 * 20 * 4)
    };
    for (let i = 0; i < image.data.length; i += 4) {
        image.data[i] = 80 + ((i / 4) % 20);
        image.data[i + 1] = 90;
        image.data[i + 2] = 100;
        image.data[i + 3] = 255;
    }

    let putCalls = 0;
    const ctx = {
        canvas: { width: 20, height: 20 },
        getImageData() {
            return {
                width: image.width,
                height: image.height,
                data: new Uint8ClampedArray(image.data)
            };
        },
        putImageData() {
            putCalls++;
        }
    };

    const result = applyVideoResidualCleanup(ctx, {
        x: 7,
        y: 7,
        width: 6,
        height: 6
    }, createDiamondAlphaMap(6, 6), {
        residualCleanupStrength: 0,
        denoiseBackend: VIDEO_DENOISE_BACKENDS.CANVAS_EDGE_DENOISE,
        edgeDenoiseStrength: 0.5
    });

    assert.equal(result.denoiseBackend, VIDEO_DENOISE_BACKENDS.CANVAS_EDGE_DENOISE);
    assert.equal(putCalls, 1);
});

test('applyVideoResidualCleanup should route canvas edge band denoise backend', () => {
    const image = {
        width: 20,
        height: 20,
        data: new Uint8ClampedArray(20 * 20 * 4)
    };
    for (let i = 0; i < image.data.length; i += 4) {
        image.data[i] = 80 + ((i / 4) % 20);
        image.data[i + 1] = 90;
        image.data[i + 2] = 100;
        image.data[i + 3] = 255;
    }

    let putCalls = 0;
    const ctx = {
        canvas: { width: 20, height: 20 },
        getImageData() {
            return {
                width: image.width,
                height: image.height,
                data: new Uint8ClampedArray(image.data)
            };
        },
        putImageData() {
            putCalls++;
        }
    };

    const result = applyVideoResidualCleanup(ctx, {
        x: 7,
        y: 7,
        width: 6,
        height: 6
    }, createDiamondAlphaMap(6, 6), {
        residualCleanupStrength: 0,
        denoiseBackend: VIDEO_DENOISE_BACKENDS.CANVAS_EDGE_BAND_DENOISE,
        edgeDenoiseStrength: 0.5
    });

    assert.equal(result.denoiseBackend, VIDEO_DENOISE_BACKENDS.CANVAS_EDGE_BAND_DENOISE);
    assert.equal(putCalls, 1);
});

test('applyVideoResidualCleanup should route canvas edge core denoise backend', () => {
    const image = {
        width: 20,
        height: 20,
        data: new Uint8ClampedArray(20 * 20 * 4)
    };
    for (let i = 0; i < image.data.length; i += 4) {
        image.data[i] = 80 + ((i / 4) % 20);
        image.data[i + 1] = 90;
        image.data[i + 2] = 100;
        image.data[i + 3] = 255;
    }

    let putCalls = 0;
    const ctx = {
        canvas: { width: 20, height: 20 },
        getImageData() {
            return {
                width: image.width,
                height: image.height,
                data: new Uint8ClampedArray(image.data)
            };
        },
        putImageData() {
            putCalls++;
        }
    };

    const result = applyVideoResidualCleanup(ctx, {
        x: 7,
        y: 7,
        width: 6,
        height: 6
    }, createDiamondAlphaMap(6, 6), {
        residualCleanupStrength: 0,
        denoiseBackend: VIDEO_DENOISE_BACKENDS.CANVAS_EDGE_CORE_DENOISE,
        edgeDenoiseStrength: 0.5
    });

    assert.equal(result.denoiseBackend, VIDEO_DENOISE_BACKENDS.CANVAS_EDGE_CORE_DENOISE);
    assert.equal(putCalls, 1);
});

test('applyVideoResidualCleanup should route canvas footprint polish backend', () => {
    const image = {
        width: 20,
        height: 20,
        data: new Uint8ClampedArray(20 * 20 * 4)
    };
    for (let i = 0; i < image.data.length; i += 4) {
        image.data[i] = 80 + ((i / 4) % 20);
        image.data[i + 1] = 90;
        image.data[i + 2] = 100;
        image.data[i + 3] = 255;
    }

    let putCalls = 0;
    const ctx = {
        canvas: { width: 20, height: 20 },
        getImageData() {
            return {
                width: image.width,
                height: image.height,
                data: new Uint8ClampedArray(image.data)
            };
        },
        putImageData() {
            putCalls++;
        }
    };

    const result = applyVideoResidualCleanup(ctx, {
        x: 7,
        y: 7,
        width: 6,
        height: 6
    }, createDiamondAlphaMap(6, 6), {
        residualCleanupStrength: 0,
        denoiseBackend: VIDEO_DENOISE_BACKENDS.CANVAS_FOOTPRINT_POLISH,
        edgeDenoiseStrength: 0.5
    });

    assert.equal(result.denoiseBackend, VIDEO_DENOISE_BACKENDS.CANVAS_FOOTPRINT_POLISH);
    assert.equal(putCalls, 1);
});
