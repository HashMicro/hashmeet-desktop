/**
 * Whether the picker should expose the system-audio option. Electron loopback
 * capture is supported here only on Windows and only for an audio-requesting
 * getDisplayMedia call.
 *
 * @param {object} input Capture request context.
 * @returns {boolean}
 */
function canOfferSystemAudio({ platform, audioRequested } = {}) {
    return platform === 'win32' && audioRequested === true;
}

/**
 * Creates the value passed to Electron's display-media callback.
 *
 * @param {object} input Capture decision.
 * @param {object|null} input.source Electron DesktopCapturerSource.
 * @param {string} input.platform Node platform identifier.
 * @param {boolean} input.audioRequested Whether the page requested audio.
 * @param {boolean} input.shareSystemAudio Whether the user selected audio.
 * @returns {null|{ video: object, audio?: 'loopback' }}
 */
function createDisplayMediaGrant({ source, platform, audioRequested = false, shareSystemAudio = false } = {}) {
    if (!source) {
        return null;
    }

    const grant = { video: source };

    if (
        shareSystemAudio &&
        canOfferSystemAudio({
            platform,
            audioRequested,
        })
    ) {
        grant.audio = 'loopback';
    }

    return grant;
}

module.exports = {
    canOfferSystemAudio,
    createDisplayMediaGrant,
};
