const assert = require('node:assert/strict');
const test = require('node:test');

const { createOriginPolicy, isTrustedIpcSender, normalizeWebOrigin } = require('../lib/origin-policy');

test('normalizes HTTP(S) URLs to browser origins', () => {
    assert.equal(normalizeWebOrigin('https://meet.hashmicro.com/meeting/123?x=1'), 'https://meet.hashmicro.com');
    assert.equal(normalizeWebOrigin('http://localhost:8000/path'), 'http://localhost:8000');
    assert.equal(normalizeWebOrigin('https://meet.hashmicro.com:443'), 'https://meet.hashmicro.com');
});

test('rejects non-web URLs, credentials, and malformed values', () => {
    assert.equal(normalizeWebOrigin('file:///tmp/index.html'), null);
    assert.equal(normalizeWebOrigin('https://user:secret@example.com'), null);
    assert.equal(normalizeWebOrigin('null'), null);
    assert.equal(normalizeWebOrigin(undefined), null);
});

test('allows only exact configured origins', () => {
    const policy = createOriginPolicy(['https://meet.hashmicro.com/app', 'https://jitsi.hashmicro.com']);

    assert.equal(policy.allows('https://meet.hashmicro.com/meeting/abc'), true);
    assert.equal(policy.allows('https://jitsi.hashmicro.com/room'), true);
    assert.equal(policy.allows('https://evil.meet.hashmicro.com'), false);
    assert.equal(policy.allows('http://meet.hashmicro.com'), false);
    assert.equal(policy.allows('https://meet.hashmicro.com.evil.test'), false);
});

test('requires at least one valid configured origin', () => {
    assert.throws(() => createOriginPolicy([]), /At least one valid/);
    assert.throws(() => createOriginPolicy(['file:///tmp/index.html']), /At least one valid/);
    assert.throws(() => createOriginPolicy('https://meet.hashmicro.com'), TypeError);
});

test('validates IPC senderFrame before falling back to sender URL', () => {
    const policy = createOriginPolicy(['https://meet.hashmicro.com']);

    assert.equal(
        isTrustedIpcSender(
            {
                senderFrame: { url: 'https://meet.hashmicro.com/meeting/abc' },
                sender: { getURL: () => 'https://evil.test' },
            },
            policy,
        ),
        true,
    );
    assert.equal(
        isTrustedIpcSender(
            {
                senderFrame: { url: 'https://evil.test' },
                sender: { getURL: () => 'https://meet.hashmicro.com' },
            },
            policy,
        ),
        false,
    );
    assert.equal(
        isTrustedIpcSender(
            {
                sender: { getURL: () => 'https://meet.hashmicro.com/home' },
            },
            policy,
        ),
        true,
    );
});
