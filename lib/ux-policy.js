function getToolbarWindowBounds(workArea) {
    if (!workArea || ![workArea.x, workArea.y, workArea.width, workArea.height].every(Number.isFinite)) {
        throw new TypeError('A finite display work area is required');
    }

    const width = Math.max(1, Math.min(680, Math.max(320, workArea.width - 24), workArea.width));
    const height = Math.max(1, Math.min(104, workArea.height));
    const marginBottom = Math.min(40, Math.max(12, Math.floor(workArea.height * 0.05)));
    const x = Math.round(workArea.x + Math.max(12, (workArea.width - width) / 2));
    const y = Math.round(workArea.y + Math.max(12, workArea.height - height - marginBottom));

    return {
        width,
        height,
        x: Math.min(x, workArea.x + workArea.width - width),
        y: Math.min(y, workArea.y + workArea.height - height),
    };
}

function classifyDeviceAccessResult(result = {}) {
    if (result.granted === true) {
        return 'allowed';
    }

    return ['NotAllowedError', 'SecurityError'].includes(result.errorName) ? 'blocked' : 'unavailable';
}

function getMediaPermissionTargets(permission, details = {}) {
    if (permission !== 'media' || !Array.isArray(details.mediaTypes)) {
        return [];
    }

    const targets = [];

    if (details.mediaTypes.includes('video')) {
        targets.push('camera');
    }
    if (details.mediaTypes.includes('audio')) {
        targets.push('microphone');
    }

    return targets;
}

const DESTRUCTIVE_NAVIGATION_ACTIONS = new Set(['home', 'reload', 'force-reload', 'deep-link']);

function normalizeMeetingId(meetingId) {
    if (typeof meetingId !== 'string') {
        return null;
    }

    const normalized = meetingId.trim();

    return normalized || null;
}

/**
 * Decide whether a navigation action must be confirmed before it is run.
 * This intentionally contains no Electron dependencies so every navigation
 * entry point can share the same active-call safety rule.
 */
function getDestructiveNavigationDecision({ action, targetMeetingId, currentMeetingId, callState } = {}) {
    if (!DESTRUCTIVE_NAVIGATION_ACTIONS.has(action)) {
        return { requiresConfirmation: false, reason: 'non-destructive-action' };
    }

    if (!callState || callState.inMeeting !== true) {
        return { requiresConfirmation: false, reason: 'no-active-meeting' };
    }

    const targetId = normalizeMeetingId(targetMeetingId);
    const currentId = normalizeMeetingId(currentMeetingId);

    if (action === 'deep-link' && targetId && currentId && targetId === currentId) {
        return { requiresConfirmation: false, reason: 'same-meeting' };
    }

    return { requiresConfirmation: true, reason: 'active-meeting' };
}

function getUpdateStatusLabel(updateState = {}) {
    switch (updateState.status) {
        case 'checking':
            return 'Checking for updates...';
        case 'available':
            return updateState.version ? `Update ${updateState.version} available` : 'Update available';
        case 'downloading': {
            const percent = Number.isFinite(updateState.percent)
                ? Math.max(0, Math.min(100, Math.round(updateState.percent)))
                : null;

            return percent === null ? 'Downloading update...' : `Downloading update (${percent}%)`;
        }
        case 'downloaded':
            return updateState.version ? `Update ${updateState.version} ready` : 'Update ready';
        case 'current':
            return 'HashMeet is up to date';
        case 'error':
            return 'Update check failed';
        default:
            return null;
    }
}

/**
 * Describe updater UI behavior for the current update and meeting states.
 * The caller owns showing dialogs and recording that a prompt was handled.
 */
function getUpdaterPresentation({ updateState = {}, callState = {} } = {}) {
    const status = typeof updateState.status === 'string' ? updateState.status : 'idle';
    const updateReady = status === 'downloaded';
    const inMeeting = callState.inMeeting === true;
    const promptAlreadyHandled = updateState.prompted === true;

    return {
        status,
        label: getUpdateStatusLabel({ ...updateState, status }) || 'Check for Updates',
        showManualResult: status === 'current' || status === 'error',
        canRestartNow: updateReady && !inMeeting,
        deferPrompt: updateReady && inMeeting,
        shouldPrompt: updateReady && !inMeeting && !promptAlreadyHandled,
    };
}

/**
 * Build the state-dependent labels and visibility rules used by the tray.
 */
function getTrayPresentation({ callState = {}, updateState = {} } = {}) {
    const inMeeting = callState.inMeeting === true;
    const update = getUpdaterPresentation({ callState, updateState });
    let statusLabel = update.label === 'Check for Updates' ? null : update.label;

    if (inMeeting) {
        statusLabel = update.status === 'downloaded' ? 'Meeting in progress - update ready' : 'Meeting in progress';
    }

    return {
        primaryLabel: inMeeting ? 'Return to meeting' : 'Show HashMeet',
        statusLabel,
        showRestartToUpdate: update.status === 'downloaded',
        restartEnabled: update.canRestartNow,
        disableHideOnClick: inMeeting,
    };
}

function shouldShowCloseToTrayNotice({ hasShownCloseNotice = false, willHideToTray = false } = {}) {
    return willHideToTray === true && hasShownCloseNotice !== true;
}

module.exports = {
    classifyDeviceAccessResult,
    getDestructiveNavigationDecision,
    getMediaPermissionTargets,
    getTrayPresentation,
    getToolbarWindowBounds,
    getUpdaterPresentation,
    shouldShowCloseToTrayNotice,
};
