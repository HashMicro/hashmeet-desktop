const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'picker', 'picker.html'), 'utf8');

test('picker uses roving focus and complete keyboard navigation', () => {
    assert.match(source, /<html lang="en">/);
    assert.match(source, /el\.tabIndex = index === focusedIndex \? 0 : -1/);
    assert.match(source, /card\.tabIndex = -1/);
    assert.match(source, /\[ 'Home', 'End' \]/);
    assert.match(source, /event\.key === ' '/);
    assert.match(source, /event\.key === 'Enter'/);
    assert.match(source, /aria-controls="grid"/);
});

test('picker preserves stable source lists and pauses auto refresh during navigation', () => {
    assert.match(source, /nextSignature !== lastSourceSignature/);
    assert.match(source, /if \(sourcesChanged \|\| !hasLoadedSources\)/);
    assert.match(source, /refreshRenderedThumbnails\(\)/);
    assert.match(source, /getFiltered\(\)\.find\(source => source\.id === selectedId\)/);
    assert.match(source, /!navigatingSources/);
    assert.match(source, /completeRefresh\(\)/);
});
