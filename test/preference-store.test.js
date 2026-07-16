const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    PREFERENCE_KEYS,
    createPreferenceStore,
    createUserDataPreferenceStore,
} = require('../lib/preference-store');

function withTempDirectory(run) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hashmeet-preferences-'));

    try {
        run(directory);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

test('uses a fallback for a missing preference and persists changes', () => {
    withTempDirectory((directory) => {
        const filePath = path.join(directory, 'nested', 'preferences.json');
        const store = createPreferenceStore({ filePath });

        assert.equal(store.get(PREFERENCE_KEYS.closeToTrayNoticeShown, false), false);
        assert.equal(store.set(PREFERENCE_KEYS.closeToTrayNoticeShown, true), true);

        const reloadedStore = createPreferenceStore({ filePath });

        assert.equal(reloadedStore.get(PREFERENCE_KEYS.closeToTrayNoticeShown, false), true);
        assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {
            closeToTrayNoticeShown: true,
        });
    });
});

test('recovers from malformed JSON and replaces it on the next write', () => {
    withTempDirectory((directory) => {
        const filePath = path.join(directory, 'preferences.json');
        const diagnostics = [];

        fs.writeFileSync(filePath, '{not-json', 'utf8');

        const store = createPreferenceStore({
            filePath,
            recordDiagnostic: (type, payload) => diagnostics.push({ type, payload }),
        });

        assert.equal(store.get('missing', 'fallback'), 'fallback');
        assert.equal(diagnostics[0].type, 'preference-store-error');
        assert.equal(diagnostics[0].payload.operation, 'read');
        assert.equal(store.set('recovered', true), true);
        assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), { recovered: true });
    });
});

test('write failures remain in memory and do not throw', () => {
    withTempDirectory((directory) => {
        const parentFile = path.join(directory, 'not-a-directory');
        const diagnostics = [];

        fs.writeFileSync(parentFile, 'occupied', 'utf8');

        const store = createPreferenceStore({
            filePath: path.join(parentFile, 'preferences.json'),
            recordDiagnostic: (type, payload) => diagnostics.push({ type, payload }),
        });

        assert.equal(store.set(PREFERENCE_KEYS.closeToTrayNoticeShown, true), false);
        assert.equal(store.get(PREFERENCE_KEYS.closeToTrayNoticeShown, false), true);
        assert.equal(diagnostics.at(-1).type, 'preference-store-error');
        assert.equal(diagnostics.at(-1).payload.operation, 'write');
    });
});

test('user-data factory resolves the preferences file without importing Electron', () => {
    withTempDirectory((directory) => {
        const store = createUserDataPreferenceStore({
            getPath(name) {
                assert.equal(name, 'userData');

                return directory;
            },
        });

        assert.equal(store.set('notice', 'shown'), true);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'preferences.json'), 'utf8')), {
            notice: 'shown',
        });
    });
});

test('path and diagnostic failures cannot interrupt preference access', () => {
    const store = createUserDataPreferenceStore(
        {
            getPath() {
                throw new Error('userData is unavailable');
            },
        },
        {
            recordDiagnostic() {
                throw new Error('diagnostics are unavailable');
            },
        },
    );

    assert.equal(store.get('notice', false), false);
    assert.equal(store.set('notice', true), false);
    assert.equal(store.get('notice', false), true);
});
