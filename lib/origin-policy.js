const WEB_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Converts a URL-like value to a canonical web origin.
 *
 * @param {unknown} value URL or origin to normalize.
 * @returns {string|null} Canonical origin, or null when it cannot be trusted.
 */
function normalizeWebOrigin(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        return null;
    }

    try {
        const url = new URL(value.trim());

        if (!WEB_PROTOCOLS.has(url.protocol) || url.username || url.password) {
            return null;
        }

        return url.origin;
    } catch (_) {
        return null;
    }
}

/**
 * Builds an immutable exact-match policy for trusted renderer origins.
 * Paths on configured URLs are intentionally discarded because browser
 * security boundaries operate at origin granularity.
 *
 * @param {string[]} allowedURLs HashMeet and Jitsi base URLs.
 * @returns {{ allowedOrigins: readonly string[], allows: function(unknown): boolean }}
 */
function createOriginPolicy(allowedURLs) {
    if (!Array.isArray(allowedURLs)) {
        throw new TypeError('allowedURLs must be an array');
    }

    const allowedOrigins = [...new Set(allowedURLs.map(normalizeWebOrigin).filter(Boolean))];

    if (allowedOrigins.length === 0) {
        throw new Error('At least one valid HTTP(S) origin is required');
    }

    const allowedSet = new Set(allowedOrigins);

    return Object.freeze({
        allowedOrigins: Object.freeze(allowedOrigins),
        allows(candidate) {
            const origin = normalizeWebOrigin(candidate);

            return origin !== null && allowedSet.has(origin);
        },
    });
}

/**
 * Checks an Electron IPC event without depending on Electron at test time.
 * senderFrame.url is authoritative; sender.getURL is a fallback for events
 * emitted without frame metadata.
 *
 * @param {object} event Electron-like IPC event.
 * @param {{ allows: function(unknown): boolean }} policy Origin policy.
 * @returns {boolean}
 */
function isTrustedIpcSender(event, policy) {
    if (!event || !policy || typeof policy.allows !== 'function') {
        return false;
    }

    const frameURL = event.senderFrame && event.senderFrame.url;

    if (frameURL) {
        return policy.allows(frameURL);
    }

    const senderURL = event.sender && typeof event.sender.getURL === 'function' ? event.sender.getURL() : null;

    return policy.allows(senderURL);
}

module.exports = {
    createOriginPolicy,
    isTrustedIpcSender,
    normalizeWebOrigin,
};
