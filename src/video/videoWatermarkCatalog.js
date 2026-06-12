const REFERENCE_WIDTH = 1920;
const REFERENCE_HEIGHT = 1080;

const REFERENCE_CANDIDATES = [
    {
        id: 'veo-1080p-standard',
        label: '1080p standard, 72px, margin 108',
        size: 72,
        marginRight: 108,
        marginBottom: 108
    },
    {
        id: 'veo-1080p-inset',
        label: '1080p inset, 72px, margin 144',
        size: 72,
        marginRight: 144,
        marginBottom: 144
    }
];

const clampInteger = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));

export function isReferenceGeminiVideoSize(width, height) {
    return width === REFERENCE_WIDTH && height === REFERENCE_HEIGHT;
}

export function resolveVideoWatermarkCandidates(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return [];
    }

    const explicit = getExplicitCandidates(width, height);
    if (explicit.length) return explicit;

    const scale = Math.min(width / REFERENCE_WIDTH, height / REFERENCE_HEIGHT);
    return REFERENCE_CANDIDATES.map((candidate) => withVideoBounds(buildCandidate(candidate, width, height, scale, {
        referenceSize: false,
        scaledFromReference: true
    }), width, height)).filter(isCandidateInBounds);
}

export function getReferenceVideoWatermarkCatalog() {
    return {
        referenceSize: {
            width: REFERENCE_WIDTH,
            height: REFERENCE_HEIGHT
        },
        candidates: REFERENCE_CANDIDATES.map((candidate) => ({ ...candidate }))
    };
}

function buildCandidate(candidate, width, height, scale = 1, extras = {}) {
    const size = clampInteger(candidate.size * scale, 24, Math.min(width, height));
    const marginRight = clampInteger(candidate.marginRight * scale, 0, width - size);
    const marginBottom = clampInteger(candidate.marginBottom * scale, 0, height - size);
    return {
        ...candidate,
        size,
        width: size,
        height: size,
        marginRight,
        marginBottom,
        x: width - marginRight - size,
        y: height - marginBottom - size,
        ...extras
    };
}

function isCandidateInBounds(candidate) {
    return (
        candidate.x >= 0 &&
        candidate.y >= 0 &&
        candidate.x + candidate.size <= candidate.videoWidth &&
        candidate.y + candidate.size <= candidate.videoHeight
    );
}

function withVideoBounds(candidate, width, height) {
    return {
        ...candidate,
        videoWidth: width,
        videoHeight: height
    };
}

function getExplicitCandidates(width, height) {
    if (width === 1920 && height === 1080) {
        return REFERENCE_CANDIDATES
            .map((candidate) => withVideoBounds(buildCandidate(candidate, width, height, 1, {
                referenceSize: true,
                scaledFromReference: false
            }), width, height))
            .filter(isCandidateInBounds);
    }

    if (width === 1280 && height === 720) {
        return [
            {
                id: 'veo-720p-1-standard',
                label: '720p-1 standard, 48px, margin 72',
                size: 48,
                marginRight: 72,
                marginBottom: 72
            },
            {
                id: 'veo-720p-2-compact',
                label: '720p-2 compact, 44px, margin 29/40',
                size: 44,
                marginRight: 29,
                marginBottom: 40
            }
        ].map((candidate) => withVideoBounds(buildCandidate(candidate, width, height, 1, {
            referenceSize: true,
            scaledFromReference: false
        }), width, height)).filter(isCandidateInBounds);
    }

    return [];
}
