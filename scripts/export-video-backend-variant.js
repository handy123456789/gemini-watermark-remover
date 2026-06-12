import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

const DEFAULT_PAGE_PATH = path.resolve('dist/video-preview.html');
const DEFAULT_DENOISE_BACKEND = 'none';

function parseArgs(argv) {
    const args = {
        pagePath: DEFAULT_PAGE_PATH,
        denoiseBackend: DEFAULT_DENOISE_BACKEND,
        alphaGain: null,
        alphaLowScale: null,
        alphaBodyScale: null,
        alphaEdgeBoost: null,
        alphaLocalRegion: null,
        alphaLocalLowScale: null,
        alphaLocalBodyScale: null,
        adaptiveAlpha: false,
        allowLowConfidence: false,
        edgeDenoiseStrength: null,
        videoBitrate: null,
        timeoutMs: 6 * 60 * 1000
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--') {
            continue;
        } else if (arg === '--input') {
            args.inputPath = path.resolve(argv[++i]);
        } else if (arg === '--output') {
            args.outputPath = path.resolve(argv[++i]);
        } else if (arg === '--page') {
            args.pagePath = path.resolve(argv[++i]);
        } else if (arg === '--denoise-backend') {
            args.denoiseBackend = argv[++i];
        } else if (arg === '--alpha-gain') {
            args.alphaGain = Number(argv[++i]);
        } else if (arg === '--alpha-low-scale') {
            args.alphaLowScale = Number(argv[++i]);
        } else if (arg === '--alpha-body-scale') {
            args.alphaBodyScale = Number(argv[++i]);
        } else if (arg === '--alpha-edge-boost') {
            args.alphaEdgeBoost = Number(argv[++i]);
        } else if (arg === '--alpha-local-region') {
            args.alphaLocalRegion = argv[++i];
        } else if (arg === '--alpha-local-low-scale') {
            args.alphaLocalLowScale = Number(argv[++i]);
        } else if (arg === '--alpha-local-body-scale') {
            args.alphaLocalBodyScale = Number(argv[++i]);
        } else if (arg === '--adaptive-alpha') {
            args.adaptiveAlpha = true;
        } else if (arg === '--edge-denoise-strength') {
            args.edgeDenoiseStrength = Number(argv[++i]);
        } else if (arg === '--video-bitrate') {
            args.videoBitrate = Number(argv[++i]);
        } else if (arg === '--allow-low-confidence') {
            args.allowLowConfidence = true;
        } else if (arg === '--timeout-ms') {
            args.timeoutMs = Number(argv[++i]);
        } else if (arg === '--help' || arg === '-h') {
            args.help = true;
        } else {
            throw new Error(`未知参数: ${arg}`);
        }
    }

    return args;
}

function printHelp() {
    console.log(`Usage:
  node scripts/export-video-backend-variant.js --input <video.mp4> --output <out.mp4> [options]

Options:
  --denoise-backend <name>     none | canvas-edge-denoise | canvas-edge-band-denoise | canvas-edge-core-denoise | canvas-footprint-polish | canvas-temporal-delta-stabilize | canvas-temporal-match-delta-stabilize | canvas-temporal-stabilize | canvas-texture-repair
                               canvas-temporal-match-delta-stabilize is a relocated-anchor human-review candidate, not a default backend.
  --alpha-gain <n>             Optional alpha seed gain
  --alpha-low-scale <n>        Optional low-alpha template scale for fitting experiments
  --alpha-body-scale <n>       Optional body-alpha template scale for fitting experiments
  --alpha-edge-boost <n>       Optional edge boost override for fitting experiments
  --alpha-local-region <name>  Optional local region for fitting experiments
  --alpha-local-low-scale <n>  Optional local low-alpha scale for fitting experiments
  --alpha-local-body-scale <n> Optional local body-alpha scale for fitting experiments
  --adaptive-alpha             Enable per-frame adaptive alpha refinement
  --edge-denoise-strength <n>  Optional 0..1 value for canvas edge denoise backends
  --video-bitrate <bps>        Optional output bitrate in bits per second
  --allow-low-confidence       Allow export when detector confidence is low
  --page <dist html path>      Defaults to dist/video-preview.html
  --timeout-ms <ms>            Defaults to 360000
`);
}

async function blobUrlToBuffer(page) {
    const base64 = await page.evaluate(async () => {
        const link = document.getElementById('downloadBtn');
        if (!link?.href || link.getAttribute('aria-disabled') === 'true') {
            throw new Error('页面尚未生成可下载结果');
        }

        const blob = await fetch(link.href).then((response) => response.blob());
        const reader = new FileReader();
        return await new Promise((resolve, reject) => {
            reader.onerror = () => reject(reader.error);
            reader.onload = () => {
                const result = String(reader.result || '');
                resolve(result.includes(',') ? result.split(',')[1] : result);
            };
            reader.readAsDataURL(blob);
        });
    });

    return Buffer.from(base64, 'base64');
}

async function collectVideoExportControls(page) {
    return await page.evaluate(() => ({
        denoiseBackend: document.getElementById('denoiseBackend')?.value || '',
        edgeDenoiseStrength: Number(document.getElementById('edgeDenoiseStrength')?.value),
        videoBitrateMbps: Number(document.getElementById('videoBitrateMbps')?.value),
        allowLowConfidence: Boolean(document.getElementById('allowLowConfidence')?.checked)
    }));
}

async function setNumericInputValue(page, selector, value, { step = null } = {}) {
    await page.evaluate(({ selector: targetSelector, value: targetValue, step: targetStep }) => {
        const input = document.querySelector(targetSelector);
        if (!input) throw new Error(`找不到控件: ${targetSelector}`);
        if (targetStep !== null) input.setAttribute('step', targetStep);
        input.value = String(targetValue);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }, { selector, value, step });
}

export async function exportVideoBackendVariant({
    inputPath,
    outputPath,
    pagePath = DEFAULT_PAGE_PATH,
    denoiseBackend = DEFAULT_DENOISE_BACKEND,
    alphaGain = null,
    alphaLowScale = null,
    alphaBodyScale = null,
    alphaEdgeBoost = null,
    alphaLocalRegion = null,
    alphaLocalLowScale = null,
    alphaLocalBodyScale = null,
    adaptiveAlpha = false,
    edgeDenoiseStrength = null,
    videoBitrate = null,
    allowLowConfidence = false,
    timeoutMs = 6 * 60 * 1000
}) {
    if (!inputPath) throw new Error('缺少 --input');
    if (!outputPath) throw new Error('缺少 --output');

    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(timeoutMs);
        await page.goto(pathToFileURL(pagePath).href);
        await page.locator('#fileInput').setInputFiles(inputPath);
        await page.locator('#denoiseBackend').selectOption(denoiseBackend);
        if (Number.isFinite(alphaGain) && alphaGain > 0) {
            await page.locator('#alphaGain').fill(String(Math.max(0.25, Math.min(1.35, alphaGain))));
            await page.locator('#alphaGain').dispatchEvent('input');
        }
        if (Number.isFinite(alphaLowScale) && alphaLowScale > 0) {
            await page.evaluate((value) => {
                window.__gwrVideoAlphaLowScale = value;
            }, Math.max(0.5, Math.min(1.5, alphaLowScale)));
        }
        if (Number.isFinite(alphaBodyScale) && alphaBodyScale > 0) {
            await page.evaluate((value) => {
                window.__gwrVideoAlphaBodyScale = value;
            }, Math.max(0.5, Math.min(1.5, alphaBodyScale)));
        }
        if (Number.isFinite(alphaEdgeBoost) && alphaEdgeBoost >= 0) {
            await page.evaluate((value) => {
                window.__gwrVideoAlphaEdgeBoost = value;
            }, Math.max(0, Math.min(0.12, alphaEdgeBoost)));
        }
        if (typeof alphaLocalRegion === 'string' && alphaLocalRegion) {
            await page.evaluate((value) => {
                window.__gwrVideoAlphaLocalRegion = value;
            }, alphaLocalRegion);
        }
        if (Number.isFinite(alphaLocalLowScale) && alphaLocalLowScale > 0) {
            await page.evaluate((value) => {
                window.__gwrVideoAlphaLocalLowScale = value;
            }, Math.max(0.5, Math.min(1.5, alphaLocalLowScale)));
        }
        if (Number.isFinite(alphaLocalBodyScale) && alphaLocalBodyScale > 0) {
            await page.evaluate((value) => {
                window.__gwrVideoAlphaLocalBodyScale = value;
            }, Math.max(0.5, Math.min(1.5, alphaLocalBodyScale)));
        }
        if (adaptiveAlpha) {
            await page.locator('#adaptiveAlpha').check();
        }
        if (Number.isFinite(edgeDenoiseStrength)) {
            await setNumericInputValue(page, '#edgeDenoiseStrength', Math.max(0, Math.min(1, edgeDenoiseStrength)), {
                step: 'any'
            });
        }
        if (Number.isFinite(videoBitrate) && videoBitrate > 0) {
            await setNumericInputValue(page, '#videoBitrateMbps', videoBitrate / 1000 / 1000);
        }
        if (allowLowConfidence) {
            await page.locator('#allowLowConfidence').check();
        }
        await page.locator('#processBtn').click();
        await page.waitForFunction(() => {
            const status = document.getElementById('status');
            return status?.dataset?.tone === 'success' || status?.dataset?.tone === 'error';
        }, null, { timeout: timeoutMs });

        const status = await page.locator('#status').textContent();
        const tone = await page.locator('#status').getAttribute('data-tone');
        if (tone !== 'success') {
            throw new Error(status || '视频导出失败');
        }

        const actualControls = await collectVideoExportControls(page);
        const buffer = await blobUrlToBuffer(page);
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, buffer);

        return {
            inputPath,
            outputPath,
            denoiseBackend,
            actualDenoiseBackend: actualControls.denoiseBackend,
            actualControls,
            alphaGain: Number.isFinite(alphaGain) ? alphaGain : undefined,
            alphaLowScale: Number.isFinite(alphaLowScale) ? alphaLowScale : undefined,
            alphaBodyScale: Number.isFinite(alphaBodyScale) ? alphaBodyScale : undefined,
            alphaEdgeBoost: Number.isFinite(alphaEdgeBoost) ? alphaEdgeBoost : undefined,
            alphaLocalRegion: alphaLocalRegion || undefined,
            alphaLocalLowScale: Number.isFinite(alphaLocalLowScale) ? alphaLocalLowScale : undefined,
            alphaLocalBodyScale: Number.isFinite(alphaLocalBodyScale) ? alphaLocalBodyScale : undefined,
            adaptiveAlpha,
            edgeDenoiseStrength: Number.isFinite(edgeDenoiseStrength) ? edgeDenoiseStrength : undefined,
            videoBitrate: Number.isFinite(videoBitrate) ? videoBitrate : undefined,
            bytes: buffer.byteLength,
            status
        };
    } finally {
        await browser.close();
    }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        process.exit(0);
    }

    exportVideoBackendVariant(args)
        .then((result) => {
            console.log(JSON.stringify(result, null, 2));
        })
        .catch((error) => {
            console.error(error?.stack || error?.message || String(error));
            process.exit(1);
        });
}
