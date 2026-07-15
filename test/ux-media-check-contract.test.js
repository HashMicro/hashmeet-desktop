const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'media-check', 'media-check.html'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'media-check', 'renderer.js'), 'utf8');

test('camera and microphone permission state are independent', () => {
    assert.match(mainSource, /camera: \{ status: 'unknown' \}/);
    assert.match(mainSource, /microphone: \{ status: 'unknown' \}/);
    assert.match(mainSource, /requiresDeviceRequest: true/);
    assert.match(mainSource, /media-check:report-device-access/);
});

test('media check exposes accessible and platform-aware status controls', () => {
    assert.match(htmlSource, /aria-label="Microphone input level"/);
    assert.match(htmlSource, /id="camera-state"[^>]*role="status"/);
    assert.match(rendererSource, /settingsButton\.hidden = systemSettings\[kind\] !== true \|\| granted \|\| !denied/);
    assert.match(rendererSource, /navigator\.mediaDevices\.getUserMedia/);
    assert.match(rendererSource, /aria-valuetext/);
});
