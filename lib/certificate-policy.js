/**
 * Allows certificate exceptions only for the exact local development host.
 * Ports are intentionally unrestricted so local Jitsi can use 8443 or another
 * developer-selected secure HTTP/WebSocket port.
 *
 * @param {unknown} value Certificate request URL.
 * @returns {boolean}
 */
function isAllowedLocalhostCertificateURL(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        return false;
    }

    try {
        const url = new URL(value.trim());

        return (
            ['https:', 'wss:'].includes(url.protocol) &&
            url.hostname === 'localhost' &&
            !url.username &&
            !url.password
        );
    } catch (_) {
        return false;
    }
}

module.exports = {
    isAllowedLocalhostCertificateURL,
};
