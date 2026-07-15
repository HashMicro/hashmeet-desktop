const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const offlineSource = fs.readFileSync(path.join(root, 'offline', 'offline.html'), 'utf8');

test('renderer failures expose recovery without forcing an unresponsive reload', () => {
    assert.match(mainSource, /render-process-gone[\s\S]*showMainRecoveryScreen\('crash'/);
    assert.match(mainSource, /dialog\.showMessageBox[\s\S]*buttons: \['Wait', 'Reload'\]/);
    assert.match(mainSource, /main-window-unresponsive-reload/);
});

test('offline recovery debounces retries and handles diagnostics failures', () => {
    assert.match(offlineSource, /if \(retrying\) return;/);
    assert.match(offlineSource, /window\.addEventListener\('online'/);
    assert.match(offlineSource, /window\.setTimeout\(runRetry, 500\)/);
    assert.match(offlineSource, /diagnostics\.setAttribute\('aria-busy', 'true'\)/);
    assert.match(offlineSource, /catch \(_\)[\s\S]*Could not copy diagnostics/);
});
