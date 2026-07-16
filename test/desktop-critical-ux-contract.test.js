const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('deep links restore hidden windows before navigating', () => {
    assert.match(mainSource, /function showAndFocusMainWindow\(\)[\s\S]*mainWindow\.restore\(\)[\s\S]*mainWindow\.show\(\)[\s\S]*mainWindow\.focus\(\)/);
    assert.match(mainSource, /handleProtocolCall[\s\S]*protocol-link-window-restored/);
    assert.match(mainSource, /handleProtocolCall[\s\S]*navigateMainWindow\('deep-link', target\)/);
    assert.match(mainSource, /if \(!app\.isReady\(\)\)[\s\S]*pendingProtocolCall = fullProtocolCall/);
    assert.match(mainSource, /if \(pendingProtocolCall\)[\s\S]*handleProtocolCall\(protocolCall\)/);
});

test('destructive meeting navigation runs through active-call confirmation', () => {
    assert.match(mainSource, /getDestructiveNavigationDecision\(\{[\s\S]*action,[\s\S]*targetMeetingId:[\s\S]*currentMeetingId:[\s\S]*callState/);
    assert.match(mainSource, /buttons: \['Cancel', 'Leave & continue'\]/);
    assert.match(mainSource, /label: 'Home',[\s\S]*navigateMainWindow\('home', homeURL\)/);
    assert.match(mainSource, /label: 'Reload',[\s\S]*navigateMainWindow\('reload'\)/);
    assert.match(mainSource, /label: 'Force Reload',[\s\S]*navigateMainWindow\('force-reload'\)/);
});

test('updater explicitly restarts and defers during meetings', () => {
    assert.match(mainSource, /autoUpdater\.checkForUpdates\(\)/);
    assert.doesNotMatch(mainSource, /checkForUpdatesAndNotify/);
    assert.match(mainSource, /promptForDownloadedUpdate[\s\S]*buttons: \['Later', 'Restart now'\]/);
    assert.match(mainSource, /autoUpdater\.quitAndInstall\(false, true\)/);
    assert.match(mainSource, /catch \(error\) \{[\s\S]*isQuitting = false;[\s\S]*update-restart-error/);
    assert.match(mainSource, /update-restart-defer-ended[\s\S]*promptForDownloadedUpdate\(\{ source: 'meeting-ended' \}\)/);
});

test('tray menu exposes meeting, diagnostics, and update state', () => {
    assert.match(mainSource, /function updateTrayMenu\(\)[\s\S]*getTrayPresentation\(\{ callState, updateState \}\)/);
    assert.match(mainSource, /label: presentation\.primaryLabel/);
    assert.match(mainSource, /label: 'Restart to update'/);
    assert.match(mainSource, /label: 'Copy Diagnostics'/);
    assert.match(mainSource, /disableHideOnClick/);
});

test('close-to-tray notice is persisted and native', () => {
    assert.match(mainSource, /createUserDataPreferenceStore\(app/);
    assert.match(mainSource, /shouldShowCloseToTrayNotice\(\{ hasShownCloseNotice, willHideToTray: true \}\)/);
    assert.match(mainSource, /PREFERENCE_KEYS\.closeToTrayNoticeShown, true/);
    assert.match(mainSource, /new Notification\(\{/);
});
