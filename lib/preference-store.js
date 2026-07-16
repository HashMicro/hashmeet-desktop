const fs = require('node:fs');
const path = require('node:path');

const PREFERENCE_KEYS = Object.freeze({
    closeToTrayNoticeShown: 'closeToTrayNoticeShown',
});

function reportFailure(recordDiagnostic, operation, error) {
    try {
        recordDiagnostic('preference-store-error', {
            operation,
            message: error instanceof Error ? error.message : String(error),
        });
    } catch (_) {
        // Preference failures must never be able to interrupt app lifecycle events.
    }
}

function isPreferenceObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Create a small synchronous JSON preference store for main-process lifecycle
 * handlers. Read and write failures are reported but never thrown.
 *
 * @param {object} options Store configuration.
 * @param {string|null} options.filePath Absolute path to the JSON file.
 * @param {Function} [options.recordDiagnostic] Redacted diagnostic callback.
 * @param {object} [options.fileSystem] Injectable node:fs implementation.
 * @returns {{get: Function, set: Function}}
 */
function createPreferenceStore({ filePath, recordDiagnostic = () => {}, fileSystem = fs } = {}) {
    let preferences = {};

    if (typeof filePath === 'string' && filePath !== '') {
        try {
            const parsed = JSON.parse(fileSystem.readFileSync(filePath, 'utf8'));

            if (!isPreferenceObject(parsed)) {
                throw new TypeError('Preferences file must contain a JSON object.');
            }

            preferences = parsed;
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                reportFailure(recordDiagnostic, 'read', error);
            }
        }
    }

    return {
        get(key, fallbackValue) {
            if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(preferences, key)) {
                return fallbackValue;
            }

            return preferences[key];
        },

        set(key, value) {
            if (typeof key !== 'string' || key === '') {
                reportFailure(recordDiagnostic, 'write', new TypeError('Preference key must be a string.'));

                return false;
            }

            const nextPreferences = { ...preferences, [key]: value };

            // Keep the in-memory state useful even if persistence is unavailable.
            preferences = nextPreferences;

            if (typeof filePath !== 'string' || filePath === '') {
                return false;
            }

            const temporaryPath = `${filePath}.tmp`;

            try {
                const serialized = `${JSON.stringify(nextPreferences, null, 2)}\n`;

                fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
                fileSystem.writeFileSync(temporaryPath, serialized, 'utf8');
                fileSystem.renameSync(temporaryPath, filePath);

                return true;
            } catch (error) {
                try {
                    fileSystem.rmSync(temporaryPath, { force: true });
                } catch (_) {
                    // The original error is the useful diagnostic.
                }

                reportFailure(recordDiagnostic, 'write', error);

                return false;
            }
        },
    };
}

function createUserDataPreferenceStore(app, options = {}) {
    const { filename = 'preferences.json', recordDiagnostic, fileSystem } = options;
    let filePath = null;

    try {
        filePath = path.join(app.getPath('userData'), filename);
    } catch (error) {
        reportFailure(recordDiagnostic ?? (() => {}), 'resolve-path', error);
    }

    return createPreferenceStore({ filePath, recordDiagnostic, fileSystem });
}

module.exports = {
    PREFERENCE_KEYS,
    createPreferenceStore,
    createUserDataPreferenceStore,
};
