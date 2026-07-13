const assert = require('node:assert/strict');
const test = require('node:test');

const { getScreenShareCapabilities, isWaylandEnvironment, normalizePermissionStatus } = require('../lib/media-policy');

test('normalizes native and Electron permission statuses', () => {
    assert.equal(normalizePermissionStatus('granted'), 'granted');
    assert.equal(normalizePermissionStatus('allowed-check'), 'granted');
    assert.equal(normalizePermissionStatus('blocked'), 'denied');
    assert.equal(normalizePermissionStatus('restricted'), 'restricted');
    assert.equal(normalizePermissionStatus('prompt'), 'not-determined');
    assert.equal(normalizePermissionStatus('unexpected'), 'unknown');
    assert.equal(normalizePermissionStatus(null), 'unknown');
});

test('detects Wayland from either standard environment marker', () => {
    assert.equal(isWaylandEnvironment({ XDG_SESSION_TYPE: 'wayland' }), true);
    assert.equal(isWaylandEnvironment({ WAYLAND_DISPLAY: 'wayland-0' }), true);
    assert.equal(isWaylandEnvironment({ XDG_SESSION_TYPE: 'x11' }), false);
});

test('reports Windows custom picker and system-audio support', () => {
    assert.deepEqual(
        getScreenShareCapabilities({
            platform: 'win32',
            permissionStatus: 'allowed',
        }),
        {
            platform: 'win32',
            pickerType: 'custom',
            systemAudio: true,
            permissionState: 'granted',
            wayland: false,
        },
    );
});

test('reports platform-specific system picker behavior', () => {
    assert.equal(getScreenShareCapabilities({ platform: 'darwin' }).pickerType, 'system');
    assert.equal(
        getScreenShareCapabilities({
            platform: 'linux',
            environment: { XDG_SESSION_TYPE: 'wayland' },
        }).pickerType,
        'system-portal',
    );
    assert.equal(
        getScreenShareCapabilities({
            platform: 'linux',
            environment: { XDG_SESSION_TYPE: 'x11' },
        }).pickerType,
        'custom',
    );
});
