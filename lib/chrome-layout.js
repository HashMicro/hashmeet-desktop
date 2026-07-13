const MAC_CHROME_HEIGHT = 28;
const DEFAULT_CHROME_HEIGHT = 36;
const MAC_TRAFFIC_LIGHT_INSET = 84;
const WINDOW_CONTROLS_INSET = 144;
const MEETING_HEADER_HEIGHT = 55;
// The meeting page has late author-level !important positioning rules.
const CHROME_CSS_INSERT_OPTIONS = Object.freeze({ cssOrigin: 'user' });

function getChromeMetrics(platform, fullscreen = false) {
    if (fullscreen) {
        return {
            height: 0,
            leftInset: 0,
            rightInset: 0,
        };
    }

    if (platform === 'darwin') {
        return {
            height: MAC_CHROME_HEIGHT,
            leftInset: MAC_TRAFFIC_LIGHT_INSET,
            rightInset: 0,
        };
    }

    return {
        height: DEFAULT_CHROME_HEIGHT,
        leftInset: 0,
        rightInset: WINDOW_CONTROLS_INSET,
    };
}

function createChromeCSS(metrics, dragStripVisible) {
    const { height, leftInset, rightInset } = metrics;
    const dragStripDisplay = dragStripVisible ? 'block' : 'none';

    return `
        :root {
            --hashmeet-desktop-chrome-height: ${height}px;
            --hashmeet-desktop-chrome-left-inset: ${leftInset}px;
            --hashmeet-desktop-chrome-right-inset: ${rightInset}px;
        }

        html::before {
            content: "";
            display: ${dragStripDisplay};
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            height: var(--hashmeet-desktop-chrome-height);
            z-index: 2147483646;
            background: #1a1a1a;
            pointer-events: none;
        }

        html::after {
            content: "";
            display: ${dragStripDisplay};
            position: fixed;
            top: 0;
            left: env(titlebar-area-x, var(--hashmeet-desktop-chrome-left-inset));
            width: env(
                titlebar-area-width,
                calc(
                    100vw
                    - var(--hashmeet-desktop-chrome-left-inset)
                    - var(--hashmeet-desktop-chrome-right-inset)
                )
            );
            height: var(--hashmeet-desktop-chrome-height);
            z-index: 2147483646;
            background: transparent;
            -webkit-app-region: drag;
            pointer-events: none;
        }

        body {
            box-sizing: border-box !important;
            padding-top: var(--hashmeet-desktop-chrome-height) !important;
            -webkit-app-region: no-drag;
        }

        body > header.navbar,
        body header.navbar {
            box-sizing: border-box !important;
            -webkit-app-region: no-drag;
        }

        .navbar.fixed-top,
        .navbar.sticky-top {
            box-sizing: border-box !important;
            top: var(--hashmeet-desktop-chrome-height) !important;
            -webkit-app-region: no-drag;
        }

        .jm-user-sidebar {
            top: var(--hashmeet-desktop-chrome-height) !important;
            bottom: 0 !important;
            min-height: 0 !important;
            height: calc(100vh - var(--hashmeet-desktop-chrome-height)) !important;
            height: calc(100dvh - var(--hashmeet-desktop-chrome-height)) !important;
            -webkit-app-region: no-drag;
        }

        .jm-mobile-appbar {
            top: var(--hashmeet-desktop-chrome-height) !important;
            -webkit-app-region: no-drag;
        }

        @media (min-width: 992px) {
            .jm-admin-sidebar.navbar-vertical {
                top: var(--hashmeet-desktop-chrome-height) !important;
                bottom: 0 !important;
                min-height: 0 !important;
                height: calc(100vh - var(--hashmeet-desktop-chrome-height)) !important;
                height: calc(100dvh - var(--hashmeet-desktop-chrome-height)) !important;
                -webkit-app-region: no-drag;
            }

            .jm-admin-sidebar > .container-fluid {
                height: 100% !important;
            }
        }

        #headerToggleBtn {
            top: calc(var(--hashmeet-desktop-chrome-height) + 8px) !important;
            transform: translateX(-50%) !important;
            -webkit-app-region: no-drag;
        }

        #jitsi-container,
        #jitsi-container.header-visible {
            top: calc(var(--hashmeet-desktop-chrome-height) + ${MEETING_HEADER_HEIGHT}px) !important;
            height: calc(100vh - var(--hashmeet-desktop-chrome-height) - ${MEETING_HEADER_HEIGHT}px) !important;
            height: calc(100dvh - var(--hashmeet-desktop-chrome-height) - ${MEETING_HEADER_HEIGHT}px) !important;
        }

        #jitsi-container.header-hidden {
            top: var(--hashmeet-desktop-chrome-height) !important;
            height: calc(100vh - var(--hashmeet-desktop-chrome-height)) !important;
            height: calc(100dvh - var(--hashmeet-desktop-chrome-height)) !important;
        }
    `;
}

function getChromeLayout(platform, fullscreen = false) {
    const metrics = getChromeMetrics(platform, fullscreen);
    const dragStripVisible = !fullscreen && metrics.height > 0;

    return {
        metrics,
        dragStripVisible,
        css: createChromeCSS(metrics, dragStripVisible),
    };
}

module.exports = {
    CHROME_CSS_INSERT_OPTIONS,
    getChromeLayout,
    getChromeMetrics,
};
