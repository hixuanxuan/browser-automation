/**
 * Set the viewport dimensions (and optionally mobile UA) for a tab via CDP Emulation API.
 *
 * Both STD_TAB and DEV_TAB should have their viewport synced to the Figma design dimensions
 * so that flexible layouts render at the correct width.
 * Mobile UA is intentionally only set on DEV_TAB — it has no effect on the static Figma HTML.
 *
 * Usage:
 *   node set-viewport.mjs --width <px> --height ght <px> [--mobile] [--dpr <n>]
 *                          [--tab <id>] [--match <url-pattern>] [--cdp localhost:9222]
 *
 * --mobile   Sets deviceScaleFactor=2, mobile=true, and injects an iPhone UA.
 *            Only pass this flag when targeting DEV_TAB.
 * --dpr      Override deviceScaleFactor explicitly (default: 2 for mobile, 1 for desktop).
 */

import {openSession, resolveTab, arg, flag} from './cdp.mjs';

const widthArg = arg('width');
const heightArg = arg('height');
const mobile = flag('mobile');
const dprArg = arg('dpr');
const cdpHost = arg('cdp') || 'localhost:9222';

if (!widthArg || !heightArg) {
    console.error(
        'Usage: node set-viewport.mjs --width <px> --height <px> [--mobile] [--dpr <n>] [--tab <id>] [--cdp localhost:9222]'
    );
    process.exit(1);
}

const width = parseInt(widthArg, 10);
const height = parseInt(heightArg, 10);
const deviceScaleFactor = dprArg ? parseFloat(dprArg) : (mobile ? 2 : 1);

const MOBILE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const tabId = await resolveTab(cdpHost);
const cdp = await openSession(tabId, cdpHost);

await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor,
    mobile,
});

if (mobile) {
    await cdp.send('Emulation.setUserAgentOverride', {userAgent: MOBILE_UA});
    console.log(`Viewport set: ${width}x${height} dpr=${deviceScaleFactor} mobile UA applied`);
}
else {
    console.log(`Viewport set: ${width}x${height} dpr=${deviceScaleFactor}`);
}

cdp.close();
