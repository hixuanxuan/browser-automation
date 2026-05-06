#!/usr/bin/env node
/**
 * Collect browser console messages and runtime exceptions from a live CDP tab.
 *
 * Usage:
 *   node scripts/console-check.mjs [--duration 3000] [--fail-on error|warning|none]
 *     [--output .verify/console.json] [--tab <id> | --match <url-pattern>] [--cdp localhost:9222]
 *
 * Notes:
 * - CDP only streams console events after this script attaches; it cannot reliably read old logs.
 * - Start this before or immediately around the interaction you want to verify.
 */

import {writeFile} from 'fs/promises';
import {resolve as resolvePath} from 'path';
import {openSession, resolveTab, arg} from './cdp.mjs';

const cdpHost = arg('cdp') || 'localhost:9222';
const duration = Number(arg('duration') ?? 3000);
const output = arg('output');
const failOn = arg('fail-on') ?? 'error';

if (!['error', 'warning', 'none'].includes(failOn)) {
    console.error('Invalid --fail-on value. Use: error, warning, or none.');
    process.exit(1);
}

function normalizeRemoteObject(argValue) {
    if (!argValue) {
        return undefined;
    }
    if ('value' in argValue) {
        return argValue.value;
    }
    if (argValue.description) {
        return argValue.description;
    }
    if (argValue.unserializableValue) {
        return argValue.unserializableValue;
    }
    return argValue.type ?? String(argValue);
}

function severityRank(level) {
    if (level === 'error' || level === 'exception') {
        return 2;
    }
    if (level === 'warning' || level === 'warn') {
        return 1;
    }
    return 0;
}

const tabId = await resolveTab(cdpHost);
const cdp = await openSession(tabId, cdpHost);
const events = [];

await cdp.send('Runtime.enable');
await cdp.send('Log.enable').catch(() => {});
await cdp.send('Page.enable').catch(() => {});

cdp.on('Runtime.consoleAPICalled', params => {
    events.push({
        source: 'Runtime.consoleAPICalled',
        level: params.type === 'warning' ? 'warning' : params.type,
        text: params.args?.map(normalizeRemoteObject).join(' ') ?? '',
        args: params.args?.map(normalizeRemoteObject) ?? [],
        url: params.stackTrace?.callFrames?.[0]?.url,
        lineNumber: params.stackTrace?.callFrames?.[0]?.lineNumber,
        columnNumber: params.stackTrace?.callFrames?.[0]?.columnNumber,
        timestamp: new Date().toISOString(),
    });
});

cdp.on('Runtime.exceptionThrown', params => {
    const details = params.exceptionDetails ?? {};
    events.push({
        source: 'Runtime.exceptionThrown',
        level: 'exception',
        text: details.exception?.description ?? details.text ?? 'Runtime exception',
        url: details.url,
        lineNumber: details.lineNumber,
        columnNumber: details.columnNumber,
        timestamp: new Date().toISOString(),
    });
});

cdp.on('Log.entryAdded', params => {
    const entry = params.entry ?? {};
    events.push({
        source: 'Log.entryAdded',
        level: entry.level,
        text: entry.text,
        url: entry.url,
        lineNumber: entry.lineNumber,
        timestamp: new Date().toISOString(),
    });
});

await new Promise(resolve => setTimeout(resolve, Number.isFinite(duration) ? duration : 3000));
cdp.close();

const maxSeverity = events.reduce((max, event) => Math.max(max, severityRank(event.level)), 0);
const failed = failOn === 'error'
    ? maxSeverity >= 2
    : failOn === 'warning'
    ? maxSeverity >= 1
    : false;

const result = {
    tabId,
    durationMs: duration,
    failOn,
    failed,
    summary: {
        total: events.length,
        errors: events.filter(event => severityRank(event.level) >= 2).length,
        warnings: events.filter(event => severityRank(event.level) === 1).length,
    },
    events,
};

if (output) {
    const outputPath = resolvePath(output);
    await writeFile(outputPath, JSON.stringify(result, null, 2));
    console.error(`Saved: ${outputPath}`);
}

console.log(JSON.stringify(result, null, 2));
process.exit(failed ? 1 : 0);
