import { VIDEO_DENOISE_BACKENDS } from './videoCleanupBackends.js';

const RELOCATED_MARGIN_RATIO = 1.8;

export function isRelocatedVideoWatermarkPosition(position) {
    if (!position || !Number.isFinite(position.width) || position.width <= 0) {
        return false;
    }
    const explicitMarginRight = Number(position.marginRight);
    const explicitMarginBottom = Number(position.marginBottom);
    const inferredMarginRight = Number.isFinite(Number(position.videoWidth)) && Number.isFinite(Number(position.x))
        ? Number(position.videoWidth) - Number(position.x) - Number(position.width)
        : null;
    const inferredMarginBottom = Number.isFinite(Number(position.videoHeight)) && Number.isFinite(Number(position.y))
        ? Number(position.videoHeight) - Number(position.y) - Number(position.height || position.width)
        : null;
    const marginRight = Number.isFinite(explicitMarginRight) ? explicitMarginRight : inferredMarginRight;
    const marginBottom = Number.isFinite(explicitMarginBottom) ? explicitMarginBottom : inferredMarginBottom;
    return (
        Number.isFinite(marginRight) && marginRight >= position.width * RELOCATED_MARGIN_RATIO
    ) || (
        Number.isFinite(marginBottom) && marginBottom >= position.width * RELOCATED_MARGIN_RATIO
    );
}

function isRelocatedCandidateLabel(candidate = {}) {
    const text = `${candidate.id || ''} ${candidate.label || ''}`.toLowerCase();
    return text.includes('inset') || text.includes('relocated');
}

export function shouldUseRelocatedReviewPreset(detection, metadata = null) {
    if (!detection?.isConfident || !detection.position) {
        return false;
    }
    const position = {
        ...detection.position,
        videoWidth: detection.position.videoWidth ?? metadata?.width,
        videoHeight: detection.position.videoHeight ?? metadata?.height
    };
    return isRelocatedVideoWatermarkPosition(position) ||
        isRelocatedCandidateLabel(detection.summary?.best);
}

export function getRelocatedReviewPresetConfig() {
    return {
        denoiseBackend: VIDEO_DENOISE_BACKENDS.CANVAS_TEMPORAL_MATCH_DELTA_STABILIZE,
        edgeDenoiseStrength: 0.25,
        videoBitrateMbps: 12,
        allowLowConfidence: true
    };
}
