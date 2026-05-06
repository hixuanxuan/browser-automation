/**
 * Run after a checkpoint passes: take a rolling baseline screenshot and
 * optionally diff against the previous baseline to catch unintended changes.
 *
 * Usage:
 *   node checkpoint-pass.mjs --cp <N> --match <url-pattern> [--cdp localhost:9222]
 *
 * Creates:
 *   .verify/baseline-cp<N>.png   — rolling baseline for this checkpoint
 *   .verify/diff-cp<N>/          — pixel diff vs previous baseline (skipped if none exists)
 *
 * Previous baseline resolution order:
 *   1. .verify/baseline-cp<N-1>.png  (previous checkpoint)
 *   2. .verify/baseline.png          (initial baseline, for N=1)
 */

import {spawnSync} from 'child_process';
import {existsSync} from 'fs';
import {join, dirname} from 'path';
import {fileURLToPath} from 'url';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));

// Parse args
function arg(name) {
    const idx = process.argv.indexOf('--' + name);
    return idx !== -1 ? process.argv[idx + 1] : null;
}

const cp = parseInt(arg('cp') ?? '', 10);
const match = arg('match');
const cdp = arg('cdp') || 'localhost:9222';

if (!cp || !match) {
    console.error('Usage: node checkpoint-pass.mjs --cp <N> --match <url-pattern> [--cdp host:port]');
    process.exit(1);
}

function run(script, ...args) {
    const result = spawnSync('node', [join(SCRIPTS, script), ...args], {stdio: 'inherit'});
    if (result.status !== 0) {
        console.error(`\n✗ ${script} failed (exit ${result.status})`);
        process.exit(result.status ?? 1);
    }
}

const verifyDir = join(process.cwd(), '.verify');
const baselinePath = join(verifyDir, `baseline-cp${cp}.png`);

// Step 1: take rolling baseline screenshot
console.log(`\n📸 Taking baseline for CP${cp}...`);
run('screenshot.mjs', '--match', match, '--cdp', cdp, '--output', baselinePath);
console.log(`   → .verify/baseline-cp${cp}.png`);

// Step 2: diff against previous baseline if one exists
const prevPath = cp > 1
    ? join(verifyDir, `baseline-cp${cp - 1}.png`)
    : join(verifyDir, 'baseline.png');

if (existsSync(prevPath)) {
    const diffDir = join(verifyDir, `diff-cp${cp}`);
    console.log(`\n🔍 Diffing against ${cp > 1 ? `baseline-cp${cp - 1}.png` : 'baseline.png'}...`);
    run('image-diff.mjs', '--standard', prevPath, '--dev', baselinePath, '--output-dir', diffDir);
    console.log(`   → .verify/diff-cp${cp}/diff-pixel.png`);
    console.log('   Check diff-pixel.png — non-target areas should show no red pixels.');
}
else {
    console.log(`\n⚠  No previous baseline found at ${prevPath} — skipping diff.`);
}

console.log(`\n✅ CP${cp} baseline recorded.`);
