const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const mainPreload = fs.readFileSync(path.join(projectRoot, 'app/preload/preload.js'), 'utf8');
const toolbarPreload = fs.readFileSync(path.join(projectRoot, 'toolbar/preload.js'), 'utf8');
const toolbarHTML = fs.readFileSync(path.join(projectRoot, 'toolbar/toolbar.html'), 'utf8');

test('exposes bridge version 3 commands with the version 2 listener alias', () => {
    assert.match(mainPreload, /bridgeVersion:\s*3/);
    assert.match(mainPreload, /onCommand:\s*\(cb\)\s*=>\s*subscribeToolbarCommands\(cb\)/);
    assert.match(mainPreload, /onAction:\s*\(cb\)\s*=>\s*subscribeToolbarCommands\(cb\)/);
    assert.match(mainPreload, /ipcRenderer\.send\('toolbar:result', result\)/);
});

test('uses acknowledged toolbar execution and renders pending and error states', () => {
    assert.match(toolbarPreload, /ipcRenderer\.invoke\('toolbar:execute', \{ action \}\)/);
    assert.match(toolbarHTML, /const pendingActions = new Set\(\)/);
    assert.match(toolbarHTML, /const anyPending = pendingActions\.size > 0/);
    assert.match(toolbarHTML, /button\.disabled = anyPending \|\| unsupported/);
    assert.match(toolbarHTML, /if \(pendingActions\.size > 0\) return/);
    assert.match(toolbarHTML, /id="hm-tb-error" role="alert" hidden/);
});

test('toolbar renderer does not redeclare the context bridge binding', () => {
    const renderer = toolbarHTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];

    assert.ok(renderer, 'toolbar renderer script is missing');
    assert.doesNotThrow(() => new Function('toolbarAPI', renderer));
    assert.match(renderer, /const toolbarBridge = window\.toolbarAPI/);
});
