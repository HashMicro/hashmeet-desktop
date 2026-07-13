const NORMALIZED_PERMISSION_STATES = new Set(['granted', 'denied', 'restricted', 'not-determined', 'unknown']);

const PERMISSION_ALIASES = new Map([
    ['allowed', 'granted'],
    ['allowed-check', 'granted'],
    ['blocked', 'denied'],
    ['blocked-check', 'denied'],
    ['prompt', 'not-determined'],
    ['default', 'not-determined'],
]);

/**
 * Normalizes Electron session and macOS system permission values.
 *
 * @param {unknown} status Raw status.
 * @returns {'granted'|'denied'|'restricted'|'not-determined'|'unknown'}
 */
function normalizePermissionStatus(status) {
    const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';

    if (NORMALIZED_PERMISSION_STATES.has(normalized)) {
        return normalized;
    }

    return PERMISSION_ALIASES.get(normalized) || 'unknown';
}

/**
 * Detects a Wayland desktop session from standard environment markers.
 *
 * @param {object} environment Process environment subset.
 * @returns {boolean}
 */
function isWaylandEnvironment(environment = {}) {
    return (
        String(environment.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland' || Boolean(environment.WAYLAND_DISPLAY)
    );
}

/**
 * Describes native screen-share behavior exposed to the renderer.
 *
 * @param {object} input Platform context.
 * @param {string} input.platform Node platform identifier.
 * @param {object} [input.environment] Process environment subset.
 * @param {unknown} [input.permissionStatus] Raw display permission state.
 * @returns {object} Serializable capabilities.
 */
function getScreenShareCapabilities({ platform, environment = {}, permissionStatus = 'unknown' } = {}) {
    const wayland = platform === 'linux' && isWaylandEnvironment(environment);

    return Object.freeze({
        platform: platform || 'unknown',
        pickerType: wayland ? 'system-portal' : platform === 'darwin' ? 'system' : 'custom',
        systemAudio: platform === 'win32',
        permissionState: normalizePermissionStatus(permissionStatus),
        wayland,
    });
}

module.exports = {
    getScreenShareCapabilities,
    isWaylandEnvironment,
    normalizePermissionStatus,
};
