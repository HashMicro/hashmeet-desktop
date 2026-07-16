const assert = require('node:assert/strict');
const test = require('node:test');

const {
    classifyDeviceAccessResult,
    getDestructiveNavigationDecision,
    getMediaPermissionTargets,
    getTrayPresentation,
    getToolbarWindowBounds,
    getUpdaterPresentation,
    shouldShowCloseToTrayNotice,
} = require('../lib/ux-policy');

test('toolbar bounds stay inside normal and constrained displays', () => {
    assert.deepEqual(getToolbarWindowBounds({ x: 100, y: 20, width: 1200, height: 800 }), {
        x: 360,
        y: 676,
        width: 680,
        height: 104,
    });
    assert.deepEqual(getToolbarWindowBounds({ x: -200, y: 0, width: 280, height: 90 }), {
        x: -200,
        y: 0,
        width: 280,
        height: 90,
    });
});

test('device access failures distinguish permission denial from unavailable hardware', () => {
    assert.equal(classifyDeviceAccessResult({ granted: true }), 'allowed');
    assert.equal(classifyDeviceAccessResult({ granted: false, errorName: 'NotAllowedError' }), 'blocked');
    assert.equal(classifyDeviceAccessResult({ granted: false, errorName: 'NotFoundError' }), 'unavailable');
});

test('media requests update only the camera or microphone they requested', () => {
    assert.deepEqual(getMediaPermissionTargets('media', { mediaTypes: ['video'] }), ['camera']);
    assert.deepEqual(getMediaPermissionTargets('media', { mediaTypes: ['audio'] }), ['microphone']);
    assert.deepEqual(getMediaPermissionTargets('media', {}), []);
    assert.deepEqual(getMediaPermissionTargets('notifications', { mediaTypes: ['audio'] }), []);
});

test('destructive navigation is guarded only while a meeting is active', () => {
    for (const action of ['home', 'reload', 'force-reload', 'deep-link']) {
        assert.deepEqual(
            getDestructiveNavigationDecision({ action, callState: { inMeeting: true } }),
            { requiresConfirmation: true, reason: 'active-meeting' },
        );
        assert.deepEqual(
            getDestructiveNavigationDecision({ action, callState: { inMeeting: false } }),
            { requiresConfirmation: false, reason: 'no-active-meeting' },
        );
    }

    assert.deepEqual(
        getDestructiveNavigationDecision({ action: 'show-window', callState: { inMeeting: true } }),
        { requiresConfirmation: false, reason: 'non-destructive-action' },
    );
});

test('a deep link to the current meeting restores it without a leave confirmation', () => {
    assert.deepEqual(
        getDestructiveNavigationDecision({
            action: 'deep-link',
            targetMeetingId: 'daily-sync',
            currentMeetingId: 'daily-sync',
            callState: { inMeeting: true },
        }),
        { requiresConfirmation: false, reason: 'same-meeting' },
    );
    assert.deepEqual(
        getDestructiveNavigationDecision({
            action: 'deep-link',
            targetMeetingId: 'customer-call',
            currentMeetingId: 'daily-sync',
            callState: { inMeeting: true },
        }),
        { requiresConfirmation: true, reason: 'active-meeting' },
    );
});

test('downloaded updates prompt immediately outside meetings and defer during meetings', () => {
    assert.deepEqual(
        getUpdaterPresentation({
            updateState: { status: 'downloaded', version: '0.2.0' },
            callState: { inMeeting: false },
        }),
        {
            status: 'downloaded',
            label: 'Update 0.2.0 ready',
            showManualResult: false,
            canRestartNow: true,
            deferPrompt: false,
            shouldPrompt: true,
        },
    );
    assert.deepEqual(
        getUpdaterPresentation({
            updateState: { status: 'downloaded', version: '0.2.0' },
            callState: { inMeeting: true },
        }),
        {
            status: 'downloaded',
            label: 'Update 0.2.0 ready',
            showManualResult: false,
            canRestartNow: false,
            deferPrompt: true,
            shouldPrompt: false,
        },
    );
});

test('updater status supports manual results, progress, and handled prompts', () => {
    assert.equal(
        getUpdaterPresentation({ updateState: { status: 'downloading', percent: 42.4 } }).label,
        'Downloading update (42%)',
    );
    assert.equal(getUpdaterPresentation({ updateState: { status: 'current' } }).showManualResult, true);
    assert.equal(getUpdaterPresentation({ updateState: { status: 'error' } }).showManualResult, true);
    assert.equal(
        getUpdaterPresentation({ updateState: { status: 'downloaded', prompted: true } }).shouldPrompt,
        false,
    );
});

test('tray presentation reflects active calls and update restart availability', () => {
    assert.deepEqual(
        getTrayPresentation({
            callState: { inMeeting: true },
            updateState: { status: 'downloaded', version: '0.2.0' },
        }),
        {
            primaryLabel: 'Return to meeting',
            statusLabel: 'Meeting in progress - update ready',
            showRestartToUpdate: true,
            restartEnabled: false,
            disableHideOnClick: true,
        },
    );
    assert.deepEqual(
        getTrayPresentation({
            callState: { inMeeting: false },
            updateState: { status: 'downloaded', version: '0.2.0' },
        }),
        {
            primaryLabel: 'Show HashMeet',
            statusLabel: 'Update 0.2.0 ready',
            showRestartToUpdate: true,
            restartEnabled: true,
            disableHideOnClick: false,
        },
    );
});

test('close-to-tray notice is shown once and only when the window will hide', () => {
    assert.equal(shouldShowCloseToTrayNotice({ willHideToTray: true }), true);
    assert.equal(shouldShowCloseToTrayNotice({ willHideToTray: true, hasShownCloseNotice: true }), false);
    assert.equal(shouldShowCloseToTrayNotice({ willHideToTray: false }), false);
});
