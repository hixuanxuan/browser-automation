/**
 * Evaluate JavaScript in the page and print the result.
 * The script is wrapped in a function scope to avoid global const/let redeclaration across repeated CDP evals.
 *
 * Usage:
 *   node eval.mjs --script <expression-or-statements> [--tab <id>] [--match <url-pattern>] [--cdp localhost:9222]
 *
 * The result is printed as JSON when it is an object/array, or as-is for primitives.
 */

import {openSession, resolveTab, arg} from './cdp.mjs';

const script = arg('script');
const cdpHost = arg('cdp') || 'localhost:9222';

if (!script) {
    console.error(
        'Usage: node eval.mjs --script <expression> [--tab <id>] [--match <url-pattern>] [--cdp localhost:9222]'
    );
    process.exit(1);
}

const tabId = await resolveTab(cdpHost);
const cdp = await openSession(tabId, cdpHost);

const trimmed = script.trim();
const isStatementBody = /\breturn\b/.test(trimmed) || /^(const|let|var|if|for|while|try|await)\b/.test(trimmed)
    || /;\s*($|\n)/.test(trimmed);
const expression = isStatementBody
    ? `(async function() { ${script} })()`
    : `(async function() { return (${script}); })()`;

const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
});

cdp.close();

if (result.exceptionDetails) {
    console.error('Error:', result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    process.exit(1);
}

const val = result.result.value;
if (val === undefined || val === null) {
    console.log(String(val));
}
else if (typeof val === 'object') {
    console.log(JSON.stringify(val, null, 2));
}
else {
    console.log(val);
}
