const assert = require('node:assert/strict');
const test = require('node:test');

const { isAllowedLocalhostCertificateURL } = require('../lib/certificate-policy');

test('allows invalid HTTPS and WSS certificates for the exact localhost hostname on any port', () => {
    assert.equal(isAllowedLocalhostCertificateURL('https://localhost:8443/external_api.js'), true);
    assert.equal(isAllowedLocalhostCertificateURL('https://localhost/room'), true);
    assert.equal(isAllowedLocalhostCertificateURL('https://LOCALHOST:9443/room'), true);
    assert.equal(isAllowedLocalhostCertificateURL('wss://localhost:8443/xmpp-websocket'), true);
});

test('rejects insecure protocols and non-localhost certificate exceptions', () => {
    assert.equal(isAllowedLocalhostCertificateURL('http://localhost:8443/external_api.js'), false);
    assert.equal(isAllowedLocalhostCertificateURL('ws://localhost:8443/xmpp-websocket'), false);
    assert.equal(isAllowedLocalhostCertificateURL('https://127.0.0.1:8443/external_api.js'), false);
    assert.equal(isAllowedLocalhostCertificateURL('https://[::1]:8443/external_api.js'), false);
    assert.equal(isAllowedLocalhostCertificateURL('https://localhost.example.com/external_api.js'), false);
    assert.equal(isAllowedLocalhostCertificateURL('https://meet.hashmicro.com/external_api.js'), false);
    assert.equal(isAllowedLocalhostCertificateURL('wss://meet.hashmicro.com/xmpp-websocket'), false);
});

test('rejects malformed or credential-bearing localhost URLs', () => {
    assert.equal(isAllowedLocalhostCertificateURL('https://user:secret@localhost:8443'), false);
    assert.equal(isAllowedLocalhostCertificateURL('not a URL'), false);
    assert.equal(isAllowedLocalhostCertificateURL(''), false);
    assert.equal(isAllowedLocalhostCertificateURL(undefined), false);
});
