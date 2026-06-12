import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('export-video-backend-variant should report actual UI controls after auto presets', () => {
  const source = readFileSync(new URL('../../scripts/export-video-backend-variant.js', import.meta.url), 'utf8');

  assert.match(source, /collectVideoExportControls/);
  assert.match(source, /setNumericInputValue/);
  assert.match(source, /step: 'any'/);
  assert.match(source, /actualDenoiseBackend: actualControls\.denoiseBackend/);
  assert.match(source, /allowLowConfidence/);
});
