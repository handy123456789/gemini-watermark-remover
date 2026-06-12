import {
    DEFAULT_ADAPTIVE_ALPHA,
    DEFAULT_ALPHA_GAIN,
    DEFAULT_DENOISE_BACKEND,
    DEFAULT_EDGE_DENOISE_STRENGTH,
    DEFAULT_HIGH_QUALITY_CLEANUP,
    DEFAULT_RESIDUAL_CLEANUP_STRENGTH,
    DEFAULT_SAMPLE_COUNT,
    DEFAULT_VIDEO_BITRATE,
    VIDEO_DENOISE_BACKENDS,
    detectGeminiVideoWatermark,
    inspectGeminiVideoFile,
    removeGeminiVideoWatermark
} from './video/videoExport.js';
import { isReferenceGeminiVideoSize } from './video/videoWatermarkCatalog.js';
import {
    getRelocatedReviewPresetConfig,
    shouldUseRelocatedReviewPreset
} from './video/videoPresetPolicy.js';

const $ = (id) => document.getElementById(id);

const state = {
    file: null,
    originalUrl: null,
    processedUrl: null,
    metadata: null,
    detection: null,
    running: false,
    jobId: 0
};

const els = {
    dropzone: $('dropzone'),
    fileInput: $('fileInput'),
    originalVideo: $('originalVideo'),
    processedVideo: $('processedVideo'),
    originalEmpty: $('originalEmpty'),
    processedEmpty: $('processedEmpty'),
    metadata: $('metadata'),
    detection: $('detection'),
    progressBar: $('progressBar'),
    progressText: $('progressText'),
    status: $('status'),
    alphaGain: $('alphaGain'),
    alphaGainValue: $('alphaGainValue'),
    adaptiveAlpha: $('adaptiveAlpha'),
    highQualityCleanup: $('highQualityCleanup'),
    denoiseBackend: $('denoiseBackend'),
    edgeDenoiseStrength: $('edgeDenoiseStrength'),
    edgeDenoiseStrengthValue: $('edgeDenoiseStrengthValue'),
    residualCleanup: $('residualCleanup'),
    residualCleanupValue: $('residualCleanupValue'),
    videoBitrateMbps: $('videoBitrateMbps'),
    sampleCount: $('sampleCount'),
    allowLowConfidence: $('allowLowConfidence'),
    processBtn: $('processBtn'),
    detectBtn: $('detectBtn'),
    downloadBtn: $('downloadBtn'),
    resetBtn: $('resetBtn'),
    relocatedReviewPresetBtn: $('relocatedReviewPresetBtn')
};

function setStatus(message, tone = 'info') {
    els.status.textContent = message || '';
    els.status.dataset.tone = tone;
}

function setProgress(progress, label) {
    const pct = Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress * 100))) : 0;
    els.progressBar.style.width = `${pct}%`;
    els.progressText.textContent = label || `${pct}%`;
}

function formatSeconds(value) {
    if (!Number.isFinite(value)) return '未知';
    return `${value.toFixed(2)}s`;
}

function formatBitrate(value) {
    if (!Number.isFinite(value)) return '未知';
    return `${(value / 1000 / 1000).toFixed(2)} Mbps`;
}

function updateButtons() {
    const hasFile = Boolean(state.file);
    els.detectBtn.disabled = !hasFile || state.running;
    els.processBtn.disabled = !hasFile || state.running;
    const canDownload = Boolean(state.processedUrl) && !state.running;
    els.downloadBtn.setAttribute('aria-disabled', canDownload ? 'false' : 'true');
    els.downloadBtn.tabIndex = canDownload ? 0 : -1;
    els.resetBtn.disabled = state.running;
}

function renderMetadata(metadata) {
    if (!metadata) {
        els.metadata.innerHTML = '<p class="muted">等待载入视频</p>';
        return;
    }
    const reference = isReferenceGeminiVideoSize(metadata.width, metadata.height);
    els.metadata.innerHTML = `
        <dl>
            <div><dt>尺寸</dt><dd>${metadata.width} x ${metadata.height}</dd></div>
            <div><dt>时长</dt><dd>${formatSeconds(metadata.duration)}</dd></div>
            <div><dt>帧率</dt><dd>${metadata.frameRate.toFixed(2)} fps</dd></div>
            <div><dt>视频码率</dt><dd>${formatBitrate(metadata.averageBitrate)}</dd></div>
            <div><dt>水印规格</dt><dd>${reference ? '1920x1080 已确认' : '比例推断，实验性'}</dd></div>
        </dl>
    `;
}

function renderDetection(detection) {
    if (!detection) {
        els.detection.innerHTML = '<p class="muted">先检测或直接导出</p>';
        return;
    }

    const best = detection.summary.best;
    els.detection.innerHTML = `
        <dl>
            <div><dt>候选</dt><dd>${best.label}</dd></div>
            <div><dt>位置</dt><dd>${detection.position.x}, ${detection.position.y}</dd></div>
            <div><dt>大小</dt><dd>${detection.position.width} x ${detection.position.height}</dd></div>
            <div><dt>均值分数</dt><dd>${best.meanConfidence.toFixed(3)}</dd></div>
            <div><dt>投票</dt><dd>${best.votes}/${detection.summary.frameCount}</dd></div>
            <div><dt>状态</dt><dd>${detection.isConfident ? '可导出' : '低置信'}</dd></div>
        </dl>
    `;
}

function cleanupUrls() {
    if (state.originalUrl) URL.revokeObjectURL(state.originalUrl);
    if (state.processedUrl) URL.revokeObjectURL(state.processedUrl);
    state.originalUrl = null;
    state.processedUrl = null;
}

async function setFile(file) {
    if (!file || !file.type.startsWith('video/')) {
        setStatus('请选择 MP4 视频文件。', 'warn');
        return;
    }

    cleanupUrls();
    state.file = file;
    state.metadata = null;
    state.detection = null;
    state.processedUrl = null;
    state.jobId++;

    state.originalUrl = URL.createObjectURL(file);
    els.originalVideo.src = state.originalUrl;
    els.processedVideo.removeAttribute('src');
    els.downloadBtn.removeAttribute('href');
    els.downloadBtn.removeAttribute('download');
    els.originalEmpty.hidden = true;
    els.processedEmpty.hidden = false;
    renderMetadata(null);
    renderDetection(null);
    setProgress(0, '准备就绪');
    setStatus('正在读取视频元数据...');
    updateButtons();

    try {
        const metadata = await inspectGeminiVideoFile(file);
        state.metadata = metadata;
        renderMetadata(metadata);
        setStatus('视频已载入，可先检测，也可直接导出。');
    } catch (error) {
        console.error(error);
        setStatus(error.message || '读取视频失败', 'error');
    } finally {
        updateButtons();
    }
}

async function runDetection() {
    if (!state.file || state.running) return;
    const jobId = ++state.jobId;
    state.running = true;
    updateButtons();
    setProgress(0.05, '检测中');
    setStatus('正在抽帧检测右下角水印...');

    try {
        const result = await detectGeminiVideoWatermark(state.file, {
            sampleCount: Number(els.sampleCount.value) || DEFAULT_SAMPLE_COUNT
        });
        if (jobId !== state.jobId) return;
        state.metadata = result.metadata;
        state.detection = result.detection;
        renderMetadata(result.metadata);
        renderDetection(result.detection);
        setProgress(1, result.detection.isConfident ? '检测完成' : '低置信');
        const presetApplied = maybeApplyRelocatedReviewPreset(result.detection, { metadata: result.metadata });
        if (!presetApplied) {
            setStatus(result.detection.isConfident ? '检测完成，可以导出。' : '检测置信度偏低，建议检查候选结果。', result.detection.isConfident ? 'success' : 'warn');
        }
    } catch (error) {
        console.error(error);
        setStatus(error.message || '检测失败', 'error');
        setProgress(0, '检测失败');
    } finally {
        state.running = false;
        updateButtons();
    }
}

async function runExport() {
    if (!state.file || state.running) return;
    const jobId = ++state.jobId;
    state.running = true;
    updateButtons();
    setProgress(0, '开始');
    setStatus('正在本地逐帧处理，页面保持打开即可。');

    try {
        let detectionPayload = state.detection ? { metadata: state.metadata, detection: state.detection } : null;
        if (!detectionPayload) {
            setProgress(0.04, '检测中');
            setStatus('正在检测水印候选...');
            const detected = await detectGeminiVideoWatermark(state.file, {
                sampleCount: Number(els.sampleCount.value) || DEFAULT_SAMPLE_COUNT
            });
            if (jobId !== state.jobId) return;
            state.metadata = detected.metadata;
            state.detection = detected.detection;
            renderMetadata(detected.metadata);
            renderDetection(detected.detection);
            maybeApplyRelocatedReviewPreset(detected.detection, { metadata: detected.metadata });
            detectionPayload = { metadata: detected.metadata, detection: detected.detection };
        } else {
            maybeApplyRelocatedReviewPreset(detectionPayload.detection, { metadata: detectionPayload.metadata, silent: true });
        }

        const result = await removeGeminiVideoWatermark(state.file, {
            alphaGain: Number(els.alphaGain.value) || DEFAULT_ALPHA_GAIN,
            adaptiveAlpha: els.adaptiveAlpha.checked,
            highQualityCleanup: els.highQualityCleanup.checked,
            denoiseBackend: els.denoiseBackend.value || DEFAULT_DENOISE_BACKEND,
            edgeDenoiseStrength: Number(els.edgeDenoiseStrength.value) || 0,
            residualCleanupStrength: Number(els.residualCleanup.value) || 0,
            videoBitrate: Number(els.videoBitrateMbps.value) > 0
                ? Number(els.videoBitrateMbps.value) * 1000 * 1000
                : DEFAULT_VIDEO_BITRATE,
            alphaLowScale: Number.isFinite(window.__gwrVideoAlphaLowScale)
                ? window.__gwrVideoAlphaLowScale
                : undefined,
            alphaBodyScale: Number.isFinite(window.__gwrVideoAlphaBodyScale)
                ? window.__gwrVideoAlphaBodyScale
                : undefined,
            alphaEdgeBoost: Number.isFinite(window.__gwrVideoAlphaEdgeBoost)
                ? window.__gwrVideoAlphaEdgeBoost
                : undefined,
            alphaLocalRegion: typeof window.__gwrVideoAlphaLocalRegion === 'string'
                ? window.__gwrVideoAlphaLocalRegion
                : undefined,
            alphaLocalLowScale: Number.isFinite(window.__gwrVideoAlphaLocalLowScale)
                ? window.__gwrVideoAlphaLocalLowScale
                : undefined,
            alphaLocalBodyScale: Number.isFinite(window.__gwrVideoAlphaLocalBodyScale)
                ? window.__gwrVideoAlphaLocalBodyScale
                : undefined,
            sampleCount: Number(els.sampleCount.value) || DEFAULT_SAMPLE_COUNT,
            detection: detectionPayload,
            allowLowConfidence: els.allowLowConfidence.checked,
            onProgress: ({ phase, progress, processedFrames, frameEstimate, metadata, detection }) => {
                if (jobId !== state.jobId) return;
                if (metadata) {
                    state.metadata = metadata;
                    renderMetadata(metadata);
                }
                if (detection) {
                    state.detection = detection;
                    renderDetection(detection);
                }
                if (phase === 'detect') {
                    setProgress(progress * 0.12, progress >= 1 ? '检测完成' : '检测中');
                } else if (phase === 'export') {
                    const exportProgress = 0.12 + progress * 0.88;
                    const frames = frameEstimate ? `${processedFrames}/${frameEstimate}` : `${processedFrames}`;
                    setProgress(exportProgress, `导出中 ${frames}`);
                }
            }
        });
        if (jobId !== state.jobId) return;

        if (state.processedUrl) URL.revokeObjectURL(state.processedUrl);
        state.processedUrl = URL.createObjectURL(result.blob);
        els.processedVideo.src = state.processedUrl;
        els.processedEmpty.hidden = true;
        els.downloadBtn.href = state.processedUrl;
        els.downloadBtn.download = `${state.file.name.replace(/\.[^.]+$/, '')}_gwr_video_mvp.mp4`;
        setProgress(1, '完成');
        const audioNote = result.audioCopied
            ? `音频已保留：${result.audioCodec || 'unknown'}，${result.audioPacketCount || 0} packets。`
            : `音频未保留：${result.audioSkipReason || 'unknown'}。`;
        setStatus(`导出完成，已处理 ${result.processedFrames} 帧，后端去噪：${result.denoiseBackend}。${audioNote}`, 'success');
    } catch (error) {
        console.error(error);
        setStatus(error.message || '导出失败', 'error');
    } finally {
        state.running = false;
        updateButtons();
    }
}

function reset() {
    state.jobId++;
    cleanupUrls();
    state.file = null;
    state.metadata = null;
    state.detection = null;
    state.running = false;
    els.fileInput.value = '';
    els.originalVideo.removeAttribute('src');
    els.processedVideo.removeAttribute('src');
    els.downloadBtn.removeAttribute('href');
    els.downloadBtn.removeAttribute('download');
    els.originalEmpty.hidden = false;
    els.processedEmpty.hidden = false;
    renderMetadata(null);
    renderDetection(null);
    setProgress(0, '等待视频');
    setStatus('');
    updateButtons();
}

function setNumberControl(input, value) {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function applyRelocatedReviewPreset() {
    const preset = getRelocatedReviewPresetConfig();
    els.denoiseBackend.value = preset.denoiseBackend;
    els.denoiseBackend.dispatchEvent(new Event('change', { bubbles: true }));
    setNumberControl(els.edgeDenoiseStrength, preset.edgeDenoiseStrength);
    els.videoBitrateMbps.value = String(preset.videoBitrateMbps);
    els.allowLowConfidence.checked = preset.allowLowConfidence;
    setStatus('已应用迁移锚点复核预设：匹配 Delta 0.25、12Mbps、允许低置信。此预设用于人工复核，不是默认策略。', 'warn');
}

function maybeApplyRelocatedReviewPreset(detection, { metadata = state.metadata, silent = false } = {}) {
    if (!shouldUseRelocatedReviewPreset(detection, metadata)) return false;
    if (els.denoiseBackend.value && els.denoiseBackend.value !== DEFAULT_DENOISE_BACKEND) return false;

    const preset = getRelocatedReviewPresetConfig();
    els.denoiseBackend.value = preset.denoiseBackend;
    els.denoiseBackend.dispatchEvent(new Event('change', { bubbles: true }));
    setNumberControl(els.edgeDenoiseStrength, preset.edgeDenoiseStrength);
    els.videoBitrateMbps.value = String(preset.videoBitrateMbps);
    els.allowLowConfidence.checked = preset.allowLowConfidence;
    if (!silent) {
        setStatus('检测到迁移锚点水印，已自动应用复核预设：匹配 Delta 0.25、12Mbps、保留音频。', 'warn');
    }
    return true;
}

function setupEvents() {
    els.dropzone.addEventListener('click', () => els.fileInput.click());
    els.dropzone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            els.fileInput.click();
        }
    });
    els.fileInput.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        if (file) setFile(file);
    });

    for (const eventName of ['dragenter', 'dragover']) {
        els.dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            els.dropzone.dataset.dragging = 'true';
        });
    }
    for (const eventName of ['dragleave', 'drop']) {
        els.dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            els.dropzone.dataset.dragging = 'false';
        });
    }
    els.dropzone.addEventListener('drop', (event) => {
        const file = event.dataTransfer?.files?.[0];
        if (file) setFile(file);
    });

    els.alphaGain.addEventListener('input', () => {
        els.alphaGainValue.textContent = Number(els.alphaGain.value).toFixed(2);
    });
    els.residualCleanup.addEventListener('input', () => {
        els.residualCleanupValue.textContent = Number(els.residualCleanup.value).toFixed(2);
    });
    els.edgeDenoiseStrength.addEventListener('input', () => {
        els.edgeDenoiseStrengthValue.textContent = Number(els.edgeDenoiseStrength.value).toFixed(2);
    });
    els.detectBtn.addEventListener('click', runDetection);
    els.processBtn.addEventListener('click', runExport);
    els.resetBtn.addEventListener('click', reset);
    els.relocatedReviewPresetBtn.addEventListener('click', applyRelocatedReviewPreset);
    els.downloadBtn.addEventListener('click', (event) => {
        if (!state.processedUrl || state.running) event.preventDefault();
    });
    window.addEventListener('beforeunload', cleanupUrls);
}

function init() {
    els.alphaGain.value = String(DEFAULT_ALPHA_GAIN);
    els.alphaGainValue.textContent = DEFAULT_ALPHA_GAIN.toFixed(2);
    els.adaptiveAlpha.checked = DEFAULT_ADAPTIVE_ALPHA;
    els.highQualityCleanup.checked = DEFAULT_HIGH_QUALITY_CLEANUP;
    els.denoiseBackend.value = Object.values(VIDEO_DENOISE_BACKENDS).includes(DEFAULT_DENOISE_BACKEND)
        ? DEFAULT_DENOISE_BACKEND
        : VIDEO_DENOISE_BACKENDS.NONE;
    els.edgeDenoiseStrength.value = String(DEFAULT_EDGE_DENOISE_STRENGTH);
    els.edgeDenoiseStrengthValue.textContent = DEFAULT_EDGE_DENOISE_STRENGTH.toFixed(2);
    els.residualCleanup.value = String(DEFAULT_RESIDUAL_CLEANUP_STRENGTH);
    els.residualCleanupValue.textContent = DEFAULT_RESIDUAL_CLEANUP_STRENGTH.toFixed(2);
    els.videoBitrateMbps.value = '';
    els.sampleCount.value = String(DEFAULT_SAMPLE_COUNT);

    if (!('VideoDecoder' in window) || !('VideoEncoder' in window)) {
        setStatus('当前浏览器缺少 WebCodecs，请使用新版 Chrome 或 Edge。', 'error');
    }

    renderMetadata(null);
    renderDetection(null);
    setProgress(0, '等待视频');
    setupEvents();
    updateButtons();
}

init();
