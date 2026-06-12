import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { renderVideoUiPresetExportMarkdown } from '../../scripts/export-video-ui-preset.js';

test('renderVideoUiPresetExportMarkdown records the real UI preset path', () => {
  const markdown = renderVideoUiPresetExportMarkdown({
    generatedAt: '2026-06-11T00:00:00.000Z',
    pagePath: 'D:\\Project\\gemini-watermark-remover\\dist\\video-preview.html',
    inputPath: 'D:\\sample.mp4',
    outputPath: 'D:\\out.mp4',
    bytes: 1234,
    presetButtonSelector: '#relocatedReviewPresetBtn',
    presetState: {
      denoiseBackend: 'canvas-temporal-match-delta-stabilize',
      edgeDenoiseStrength: 0.25,
      videoBitrateMbps: 12,
      allowLowConfidence: true
    },
    resultState: {
      statusTone: 'success',
      statusText: '导出完成'
    },
    screenshots: {
      before: 'before.png',
      after: 'after.png'
    }
  });

  assert.match(markdown, /#relocatedReviewPresetBtn/);
  assert.match(markdown, /canvas-temporal-match-delta-stabilize/);
  assert.match(markdown, /edgeDenoiseStrength: 0\.25/);
  assert.match(markdown, /videoBitrateMbps: 12/);
  assert.match(markdown, /allowLowConfidence: true/);
});

test('export-video-ui-preset source clicks the relocated review preset button', () => {
  const source = readFileSync(new URL('../../scripts/export-video-ui-preset.js', import.meta.url), 'utf8');

  assert.match(source, /PRESET_BUTTON_SELECTOR = '#relocatedReviewPresetBtn'/);
  assert.match(source, /locator\(PRESET_BUTTON_SELECTOR\)\.click\(\)/);
  assert.match(source, /locator\('#processBtn'\)\.click\(\)/);
});
