const BOOLEAN_STATE_KEYS = Object.freeze([
    'isMuted',
    'isScreenSharing',
    'isSharePaused',
    'micAvailable',
    'pauseSupported',
]);
const STRING_STATE_KEYS = Object.freeze(['qualityStage', 'sourceName', 'sourceType', 'speakerInitials', 'speakerName']);
const NUMBER_STATE_KEYS = Object.freeze(['participantCount']);

function normalizeToolbarState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }

    const state = {};

    for (const key of BOOLEAN_STATE_KEYS) {
        if (typeof value[key] === 'boolean') {
            state[key] = value[key];
        }
    }
    for (const key of STRING_STATE_KEYS) {
        if (typeof value[key] === 'string') {
            state[key] = value[key].slice(0, 240);
        }
    }
    for (const key of NUMBER_STATE_KEYS) {
        if (Number.isFinite(value[key])) {
            state[key] = value[key];
        }
    }

    return Object.keys(state).length ? state : undefined;
}

function normalizeToolbarCommandResult(command, result) {
    if (result && typeof result === 'object' && typeof result.ok === 'boolean') {
        const state = normalizeToolbarState(result.state);

        return {
            commandId: command.commandId,
            ok: result.ok,
            ...(state ? { state } : {}),
            ...(!result.ok && result.error ? { error: String(result.error).slice(0, 240) } : {}),
        };
    }

    return {
        commandId: command.commandId,
        ok: result !== false,
        ...(result === false ? { error: 'The screen-share command failed.' } : {}),
    };
}

module.exports = {
    normalizeToolbarCommandResult,
    normalizeToolbarState,
};
