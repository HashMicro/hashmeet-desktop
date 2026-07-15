const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const toolbarSource = fs.readFileSync(path.join(root, 'toolbar', 'toolbar.html'), 'utf8');

test('toolbar remains focusable without stealing initial meeting focus', () => {
    assert.match(mainSource, /focusable: true/);
    assert.match(mainSource, /toolbarWindow\.showInactive\(\)/);
    assert.match(mainSource, /toolbar:return-focus/);
});

test('toolbar adapts to constrained displays and reduced motion', () => {
    assert.match(mainSource, /getToolbarWindowBounds\(workArea\)/);
    assert.match(mainSource, /display-metrics-changed/);
    assert.match(toolbarSource, /@media \(max-width: 520px\)/);
    assert.match(toolbarSource, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(toolbarSource, /#hm-tb-quality \.bi[\s\S]*min-width: 26px/);
    assert.match(toolbarSource, /event\.key !== 'Escape'/);
});
