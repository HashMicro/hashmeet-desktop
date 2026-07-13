const assert = require('node:assert/strict');
const test = require('node:test');

const { canOfferSystemAudio, createDisplayMediaGrant } = require('../lib/display-media-policy');

const source = {
    id: 'screen:0:0',
    name: 'Primary display',
};

test('offers system audio only for Windows requests that include audio', () => {
    assert.equal(
        canOfferSystemAudio({
            platform: 'win32',
            audioRequested: true,
        }),
        true,
    );
    assert.equal(
        canOfferSystemAudio({
            platform: 'win32',
            audioRequested: false,
        }),
        false,
    );
    assert.equal(
        canOfferSystemAudio({
            platform: 'darwin',
            audioRequested: true,
        }),
        false,
    );
    assert.equal(
        canOfferSystemAudio({
            platform: 'linux',
            audioRequested: true,
        }),
        false,
    );
});

test('returns null when capture is cancelled', () => {
    assert.equal(
        createDisplayMediaGrant({
            source: null,
            platform: 'win32',
        }),
        null,
    );
});

test('adds Windows loopback only when requested and selected', () => {
    assert.deepEqual(
        createDisplayMediaGrant({
            source,
            platform: 'win32',
            audioRequested: true,
            shareSystemAudio: true,
        }),
        {
            video: source,
            audio: 'loopback',
        },
    );

    assert.deepEqual(
        createDisplayMediaGrant({
            source,
            platform: 'win32',
            audioRequested: false,
            shareSystemAudio: true,
        }),
        { video: source },
    );
});

test('never adds loopback on macOS or Linux', () => {
    for (const platform of ['darwin', 'linux']) {
        assert.deepEqual(
            createDisplayMediaGrant({
                source,
                platform,
                audioRequested: true,
                shareSystemAudio: true,
            }),
            { video: source },
        );
    }
});
