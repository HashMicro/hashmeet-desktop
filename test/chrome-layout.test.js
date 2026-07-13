const assert = require('node:assert/strict');
const test = require('node:test');

const { CHROME_CSS_INSERT_OPTIONS, getChromeLayout, getChromeMetrics } = require('../lib/chrome-layout');

test('injects desktop chrome CSS at user origin so page important rules cannot override it', () => {
    assert.deepEqual(CHROME_CSS_INSERT_OPTIONS, { cssOrigin: 'user' });
    assert.equal(Object.isFrozen(CHROME_CSS_INSERT_OPTIONS), true);
});

test('uses macOS chrome height and traffic-light inset', () => {
    assert.deepEqual(getChromeMetrics('darwin'), {
        height: 28,
        leftInset: 84,
        rightInset: 0,
    });
});

test('uses the taller chrome and right-side controls inset on Windows and Linux', () => {
    const expected = {
        height: 36,
        leftInset: 0,
        rightInset: 144,
    };

    assert.deepEqual(getChromeMetrics('win32'), expected);
    assert.deepEqual(getChromeMetrics('linux'), expected);
});

test('fullscreen removes every chrome metric and hides the drag strip', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
        const layout = getChromeLayout(platform, true);

        assert.deepEqual(layout.metrics, {
            height: 0,
            leftInset: 0,
            rightInset: 0,
        });
        assert.equal(layout.dragStripVisible, false);
        assert.match(layout.css, /html::before\s*{[^}]*display: none;/s);
        assert.match(layout.css, /html::after\s*{[^}]*display: none;/s);
    }
});

test('CSS paints the desktop chrome across the full window width', () => {
    const { css } = getChromeLayout('win32');

    assert.match(css, /html::before\s*{[^}]*left: 0;[^}]*right: 0;/s);
    assert.match(css, /html::before\s*{[^}]*background: #1a1a1a;/s);
    assert.match(css, /html::before\s*{[^}]*pointer-events: none;/s);
    assert.doesNotMatch(css, /html::before\s*{[^}]*-webkit-app-region: drag;/s);
});

test('CSS uses native window-control geometry for the dedicated drag strip', () => {
    const { css } = getChromeLayout('win32');

    assert.match(
        css,
        /html::after\s*{[^}]*left: env\(titlebar-area-x, var\(--hashmeet-desktop-chrome-left-inset\)\);/s,
    );
    assert.match(css, /html::after\s*{[^}]*width: env\(\s*titlebar-area-width,/s);
    assert.match(css, /html::after\s*{[^}]*-webkit-app-region: drag;/s);
    assert.match(css, /html::after\s*{[^}]*pointer-events: none;/s);
});

test('CSS keeps page controls interactive below the desktop chrome', () => {
    const { css } = getChromeLayout('win32');

    assert.match(css, /body\s*{[^}]*padding-top: var\(--hashmeet-desktop-chrome-height\) !important;/s);
    assert.match(css, /body\s*{[^}]*-webkit-app-region: no-drag;/s);
    assert.doesNotMatch(css, /body\s*{[^}]*-webkit-app-region: drag;/s);
});

test('CSS lets body padding offset normal-flow navigation exactly once', () => {
    const { css } = getChromeLayout('win32');
    const normalNavbarRule = css.match(/body > header\.navbar,\s*body header\.navbar\s*{([^}]*)}/s);

    assert.ok(normalNavbarRule);
    assert.doesNotMatch(normalNavbarRule[1], /\btop:/);
    assert.match(css, /--hashmeet-desktop-chrome-right-inset: 144px;/);
    assert.doesNotMatch(css, /padding-(?:left|right): var\(--hashmeet-desktop-chrome-/);
});

test('CSS directly offsets only fixed and sticky navigation', () => {
    const { css } = getChromeLayout('win32');

    assert.match(css, /\.navbar\.fixed-top,/);
    assert.match(css, /\.navbar\.sticky-top\s*{[^}]*top: var\(--hashmeet-desktop-chrome-height\) !important;/s);
});

test('CSS keeps the fixed user sidebar below desktop chrome', () => {
    const { css } = getChromeLayout('linux');

    assert.match(
        css,
        /\.jm-user-sidebar\s*{[^}]*top: var\(--hashmeet-desktop-chrome-height\) !important;/s,
    );
    assert.match(
        css,
        /\.jm-user-sidebar\s*{[^}]*height: calc\(100dvh - var\(--hashmeet-desktop-chrome-height\)\) !important;/s,
    );
    assert.match(css, /\.jm-user-sidebar\s*{[^}]*min-height: 0 !important;/s);
});

test('CSS offsets desktop admin sidebars and their full-height content', () => {
    const { css } = getChromeLayout('linux');

    assert.match(
        css,
        /@media \(min-width: 992px\)\s*{\s*\.jm-admin-sidebar\.navbar-vertical\s*{[^}]*top: var\(--hashmeet-desktop-chrome-height\) !important;/s,
    );
    assert.match(
        css,
        /\.jm-admin-sidebar\.navbar-vertical\s*{[^}]*height: calc\(100dvh - var\(--hashmeet-desktop-chrome-height\)\) !important;/s,
    );
    assert.match(css, /\.jm-admin-sidebar > \.container-fluid\s*{[^}]*height: 100% !important;/s);
});

test('CSS keeps the mobile dashboard app bar below desktop chrome while sticky', () => {
    const { css } = getChromeLayout('linux');

    assert.match(
        css,
        /\.jm-mobile-appbar\s*{[^}]*top: var\(--hashmeet-desktop-chrome-height\) !important;/s,
    );
});

test('CSS places the show-menu button fully below desktop chrome', () => {
    const { css } = getChromeLayout('darwin');

    assert.match(
        css,
        /#headerToggleBtn\s*{[^}]*top: calc\(var\(--hashmeet-desktop-chrome-height\) \+ 8px\) !important;/s,
    );
    assert.match(css, /#headerToggleBtn\s*{[^}]*transform: translateX\(-50%\) !important;/s);
});

test('CSS calculates visible and hidden Jitsi viewports from the same chrome height', () => {
    const { css } = getChromeLayout('linux');

    assert.match(css, /#jitsi-container\.header-visible\s*{[^}]*top: calc\([^;]+ \+ 55px\) !important;/s);
    assert.match(
        css,
        /#jitsi-container\.header-visible\s*{[^}]*height: calc\(100dvh - var\(--hashmeet-desktop-chrome-height\) - 55px\) !important;/s,
    );
    assert.match(
        css,
        /#jitsi-container\.header-hidden\s*{[^}]*height: calc\(100dvh - var\(--hashmeet-desktop-chrome-height\)\) !important;/s,
    );
});
