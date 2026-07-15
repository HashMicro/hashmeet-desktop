const assert = require('node:assert/strict');
const test = require('node:test');

const {
    classifyDeviceAccessResult,
    getMediaPermissionTargets,
    getToolbarWindowBounds,
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
