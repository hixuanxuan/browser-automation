/**
 * Final verification: run all checkpoint assertions end-to-end, screenshot,
 * and diff against initial baseline to detect regressions.
 *
 * Usage:
 *   node final-verify.mjs --match <url-pattern> [--cdp localhost:9222]
 *
 * What it does:
 *   1. Find all .verify/checkpoint-*.json files (sorted by number)
 *   2. Run dom-assert.mjs on each in order
 *   3. Screenshot final state → .verify/final.png
 *   4. Diff .verify/baseline.png vs .verify/final.png → .verify/diff-final/
 *   5. Report overall pass/fail
 *
 * Exit code: 0 = all passed, 1 = any failure
 */

import {spawnSync} from 'child_process';
import {readdirSync, existsSync} from 'fs';
import {join, dirname} from 'path';
import {fileURLToPath} from 'url';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));

function arg(name) {
    const idx = process.argv.indexOf('--' + name);
    return idx !== -1 ? process.argv[idx + 1] : null;
}

const match = arg('match');
const cdp = arg('cdp') || 'localhost:9222';

if (!match) {
    console.error('Usage: node final-verify.mjs --match <url-pattern> [--cdp host:port]');
    process.exit(1);
}

function run(script, args, {failOk = false} = {}) {
    const result = spawnSync('node', [join(SCRIPTS, script), ...args], {stdio: 'inherit'});
    if (result.status !== 0 && !failOk) {
        process.exit(result.status ?? 1);
    }
    return result.status === 0;
}

const verifyDir = join(process.cwd(), '.verify');

// Step 1: collect checkpoint files sorted by number
const checkpoints = readdirSync(verifyDir)
    .filter(f => /^checkpoint-\d+\.json$/.test(f) || /^checkpoint-.+-\d+\.json$/.test(f))
    .sort((a, b) => {
        const na = parseInt(a.match(/(\d+)\.json$/)?.[1] ?? '0', 10);
        const nb = parseInt(b.match(/(\d+)\.json$/)?.[1] ?? '0', 10);
        return na - nb;
    });

if (checkpoints.length === 0) {
    console.error('No checkpoint-*.json files found in .verify/');
    process.exit(1);
}

console.log(`\n🔁 Final verification — ${checkpoints.length} checkpoint(s)\n`);

// Step 2: run assertions for each checkpoint
let allPassed = true;
for (const file of checkpoints) {
    console.log(`\n▶ Running ${file}`);
    const passed = run('dom-assert.mjs', [
        '--assertions',
        join(verifyDir, file),
        '--match',
        match,
        '--cdp',
        cdp,
    ], {failOk: true});
    if (!passed) {
        allPassed = false;
    }
}

// Step 3: screenshot final state
console.log('\n📸 Taking final screenshot...');
run('screenshot.mjs', ['--match', match, '--cdp', cdp, '--output', join(verifyDir, 'final.png')]);
console.log('   → .verify/final.png');

// Step 4: diff final vs initial baseline
const baselinePath = join(verifyDir, 'baseline.png');
if (existsSync(baselinePath)) {
    console.log('\n🔍 Diffing final state vs initial baseline...');
    run('image-diff.mjs', [
        '--standard',
        baselinePath,
        '--dev',
        join(verifyDir, 'final.png'),
        '--output-dir',
        join(verifyDir, 'diff-final'),
    ]);
    console.log('   → .verify/diff-final/diff-pixel.png');
    console.log('   Target change areas: expect red pixels. Non-target areas: expect none.');
}
else {
    console.log('\n⚠  .verify/baseline.png not found — skipping regression diff.');
}

// Step 5: summary
if (allPassed) {
    console.log('\n✅ All assertions passed. Final verification complete.');
    process.exit(0);
}
else {
    console.log('\n❌ Some assertions failed. Fix and re-run.');
    process.exit(1);
}
