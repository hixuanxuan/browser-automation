/**
 * Execute structured DOM assertions against a live browser page via CDP.
 *
 * Usage:
 *   node dom-assert.mjs --assertions <json-file-or-inline-json> \
 *     [--tab <id>] [--match <url-pattern>] [--cdp localhost:9222]
 *
 * ─── Input Formats ────────────────────────────────────────────────────────────
 *
 * 1. FLAT ARRAY — simple single-state checks (original format):
 *
 *   [{ "id": "V1", "type": "visible", "selector": ".panel", "desc": "..." }]
 *
 * 2. SCENARIO — multi-step flow with actions and assertions at each step:
 *
 *   {
 *     "id": "CP1",
 *     "desc": "User opens panel, switches tab, then closes",
 *     "steps": [
 *       {
 *         "desc": "Open panel",
 *         "action": { "type": "click", "selector": ".panel-trigger" },
 *         "assertions": [
 *           { "id": "V1", "type": "visible", "selector": ".panel",
 *             "desc": "Panel appears" },
 *           { "id": "V2", "type": "custom",
 *             "desc": "Trigger button is now active",
 *             "script": "const b = document.querySelector('.panel-trigger'); return { pass: b.classList.contains('active'), reason: b.className }" }
 *         ]
 *       },
 *       {
 *         "desc": "Switch to tab 2",
 *         "action": { "type": "click", "selector": ".tab-item:nth-child(2)" },
 *         "assertions": [
 *           { "id": "V3", "type": "custom",
 *             "desc": "Tab 2 becomes selected",
 *             "script": "const t = document.querySelector('.tab-item:nth-child(2)'); return { pass: t.classList.contains('active'), reason: t.className }" },
 *           { "id": "V4", "type": "content", "selector": ".panel-content",
 *             "minChildren": 1, "desc": "Tab 2 content rendered" }
 *         ]
 *       }
 *     ]
 *   }
 *
 * 3. ARRAY OF SCENARIOS:
 *
 *   [{ "id": "CP1", "desc": "...", "steps": [...] }, ...]
 *
 * ─── Action Types (used in scenario steps) ───────────────────────────────────
 *
 *   { "type": "click",    "selector": "css-selector", "filter": { "text": "Save" } }
 *   { "type": "fill",     "selector": "css-selector", "value": "text" }
 *   { "type": "wait",     "selector": "css-selector", "timeout": 3000 }
 *   { "type": "navigate", "url": "https://..." }
 *   { "type": "eval",     "script": "arbitrary JS expression" }
 *
 * ─── Assertion Types ──────────────────────────────────────────────────────────
 *
 *   exists      — element exists in DOM
 *   visible     — exists + display/visibility/opacity all allow rendering
 *   rect        — geometry: minWidth?, minHeight?, maxWidth?, maxHeight?
 *   overflow    — scrollWidth/Height vs clientWidth/Height; allowX?, allowY?
 *   clipping    — not clipped by any ancestor's overflow:hidden/clip/scroll
 *   content     — textContent or child count: contains?, minChildren?, childSelector?
 *   icon        — rendered size > 0 (covers SVG, img, icon fonts)
 *   occlusion   — center point not covered by another element
 *   custom      — arbitrary JS returning boolean or { pass, reason }
 *
 * ─── Optional target filter ───────────────────────────────────────────────────
 *
 *   "filter": { "text": "Save" | "includes": "Save" | "ariaLabel": "Close" | "role": "button" }
 *   Applies after document.querySelectorAll(selector). Useful when visible text or aria-label is
 *   more stable than generated class names.
 *
 * ─── Output ───────────────────────────────────────────────────────────────────
 *
 *   {
 *     "passed": [{ "id", "desc", "step"?, "detail" }],
 *     "failed": [{ "id", "desc", "step"?, "reason", "detail" }],
 *     "summary": { "total", "passed", "failed", "errors", "allPassed" }
 *   }
 *
 *   Progress output goes to stderr (✅/❌/💥). Structured JSON goes to stdout.
 *   Exit code: 0 = all passed, 1 = any failure or error.
 */

import {readFile} from 'fs/promises';
import {existsSync} from 'fs';

let openSession, resolveTab, arg;

try {
    const cdpMod = await import('./cdp.mjs');
    openSession = cdpMod.openSession;
    resolveTab = cdpMod.resolveTab;
    arg = cdpMod.arg;
}
catch (err) {
    console.error('Failed to load cdp.mjs:', err.message);
    process.exit(1);
}

const assertionsArg = arg('assertions');
const cdpHost = arg('cdp') || 'localhost:9222';

if (!assertionsArg) {
    console.error(
        'Usage: node dom-assert.mjs --assertions <json-file-or-inline-json> [--tab <id>] [--match <url>] [--cdp host:port]'
    );
    process.exit(1);
}

let input;
if (existsSync(assertionsArg)) {
    input = JSON.parse(await readFile(assertionsArg, 'utf-8'));
}
else {
    input = JSON.parse(assertionsArg);
}

const tabId = await resolveTab(cdpHost);
const cdp = await openSession(tabId, cdpHost);

// ── CDP helpers ───────────────────────────────────────────────────────────────

async function evalInPage(expression) {
    const result = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
    });
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
}

function findElementExpression(target) {
    const selector = JSON.stringify(target.selector);
    const filter = JSON.stringify(target.filter ?? null);
    return `(function() {
    const elements = Array.from(document.querySelectorAll(${selector}));
    const filter = ${filter};
    if (!filter) return elements[0] || null;
    return elements.find(el => {
      const text = (el.textContent || '').trim();
      if (filter.text != null && text !== filter.text) return false;
      if (filter.includes != null && !text.includes(filter.includes)) return false;
      if (filter.ariaLabel != null && el.getAttribute('aria-label') !== filter.ariaLabel) return false;
      if (filter.role != null && el.getAttribute('role') !== filter.role) return false;
      return true;
    }) || null;
  })()`;
}

function targetLabel(target) {
    const filter = target.filter ? ` ${JSON.stringify(target.filter)}` : '';
    return `${target.selector}${filter}`;
}

// Execute a step action in the page
async function executeAction(action) {
    if (!action) {
        return;
    }
    switch (action.type) {
        case 'click': {
            await evalInPage(`(function() {
        const el = ${findElementExpression(action)};
        if (!el) throw new Error('Action target not found: ${targetLabel(action)}');
        el.click();
      })()`);
            // Brief settle time after click
            await new Promise(r => setTimeout(r, 100));
            break;
        }
        case 'fill': {
            await evalInPage(`(function() {
        const el = ${findElementExpression(action)};
        if (!el) throw new Error('Fill target not found: ${targetLabel(action)}');
        el.focus();
        el.value = ${JSON.stringify(action.value ?? '')};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
            break;
        }
        case 'wait': {
            const timeout = action.timeout ?? 5000;
            const interval = 100;
            const steps = timeout / interval;
            for (let i = 0; i < steps; i++) {
                await new Promise(r => setTimeout(r, interval));
                const found = await evalInPage(`!!${findElementExpression(action)}`);
                if (found) {
                    return;
                }
            }
            throw new Error(`wait: element not found after ${timeout}ms: ${targetLabel(action)}`);
        }
        case 'navigate': {
            await cdp.send('Page.navigate', {url: action.url});
            await new Promise(r => setTimeout(r, 500));
            break;
        }
        case 'eval': {
            await evalInPage(`(async () => { ${action.script} })()`);
            break;
        }
        default:
            throw new Error(`Unknown action type: ${action.type}`);
    }
}

// ── Assertion runners ─────────────────────────────────────────────────────────

const runners = {
    exists: a =>
        `(function() {
    const el = ${findElementExpression(a)};
    return el ? { pass: true } : { pass: false, reason: 'Element not found: ${a.selector}' };
  })()`,

    visible: a =>
        `(function() {
    const el = ${findElementExpression(a)};
    if (!el) return { pass: false, reason: 'Element not found: ${a.selector}' };
    const s = getComputedStyle(el);
    if (s.display === 'none') return { pass: false, reason: 'display: none' };
    if (s.visibility === 'hidden') return { pass: false, reason: 'visibility: hidden' };
    if (parseFloat(s.opacity) === 0) return { pass: false, reason: 'opacity: 0' };
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return { pass: false, reason: 'zero size (0×0)' };
    return { pass: true, detail: { width: r.width, height: r.height } };
  })()`,

    rect: a =>
        `(function() {
    const el = ${findElementExpression(a)};
    if (!el) return { pass: false, reason: 'Element not found: ${a.selector}' };
    const r = el.getBoundingClientRect();
    const fails = [];
    ${
            a.minWidth != null
                ? `if (r.width  < ${a.minWidth})  fails.push('width '  + r.width  + 'px < min ${a.minWidth}px');`
                : ''
        }
    ${
            a.minHeight != null
                ? `if (r.height < ${a.minHeight}) fails.push('height ' + r.height + 'px < min ${a.minHeight}px');`
                : ''
        }
    ${
            a.maxWidth != null
                ? `if (r.width  > ${a.maxWidth})  fails.push('width '  + r.width  + 'px > max ${a.maxWidth}px');`
                : ''
        }
    ${
            a.maxHeight != null
                ? `if (r.height > ${a.maxHeight}) fails.push('height ' + r.height + 'px > max ${a.maxHeight}px');`
                : ''
        }
    if (fails.length) return { pass: false, reason: fails.join('; '), detail: { width: r.width, height: r.height } };
    return { pass: true, detail: { width: r.width, height: r.height } };
  })()`,

    overflow: a =>
        `(function() {
    const el = ${findElementExpression(a)};
    if (!el) return { pass: false, reason: 'Element not found: ${a.selector}' };
    const fails = [];
    ${
            !a.allowX
                ? `if (el.scrollWidth  > el.clientWidth  + 1) fails.push('horizontal overflow: scrollW=' + el.scrollWidth  + ' clientW=' + el.clientWidth);`
                : ''
        }
    ${
            !a.allowY
                ? `if (el.scrollHeight > el.clientHeight + 1) fails.push('vertical overflow: scrollH='   + el.scrollHeight + ' clientH=' + el.clientHeight);`
                : ''
        }
    if (fails.length) return { pass: false, reason: fails.join('; ') };
    return { pass: true };
  })()`,

    clipping: a =>
        `(function() {
    const el = ${findElementExpression(a)};
    if (!el) return { pass: false, reason: 'Element not found: ${a.selector}' };
    const tRect = el.getBoundingClientRect();
    let cur = el.parentElement;
    while (cur && cur !== document.documentElement) {
      const s = getComputedStyle(cur);
      const ov = s.overflow + ' ' + s.overflowX + ' ' + s.overflowY;
      if (/hidden|clip|scroll|auto/.test(ov)) {
        const cRect = cur.getBoundingClientRect();
        if (tRect.top < cRect.top || tRect.left < cRect.left ||
            tRect.bottom > cRect.bottom || tRect.right > cRect.right) {
          const tag = cur.tagName.toLowerCase();
          const cls = cur.className ? '.' + String(cur.className).split(' ')[0] : '';
          return {
            pass: false,
            reason: 'Clipped by ancestor ' + tag + cls + ' (overflow: ' + s.overflow + ')',
            detail: {
              ancestor: tag + cls,
              ancestorRect: { x: Math.round(cRect.x), y: Math.round(cRect.y), w: Math.round(cRect.width), h: Math.round(cRect.height) },
              targetRect:   { x: Math.round(tRect.x), y: Math.round(tRect.y), w: Math.round(tRect.width), h: Math.round(tRect.height) },
            }
          };
        }
      }
      cur = cur.parentElement;
    }
    return { pass: true };
  })()`,

    content: a =>
        `(function() {
    const el = ${findElementExpression(a)};
    if (!el) return { pass: false, reason: 'Element not found: ${a.selector}' };
    const fails = [];
    ${
            a.contains != null
                ? `if (!el.textContent.includes(${
                    JSON.stringify(a.contains)
                })) fails.push('textContent does not contain "${a.contains}", got: ' + el.textContent.slice(0, 100));`
                : ''
        }
    ${
            a.minChildren != null
                ? `{
      const childSel = ${JSON.stringify(a.childSelector || '*')};
      const count = childSel === '*' ? el.children.length : el.querySelectorAll(childSel).length;
      if (count < ${a.minChildren}) fails.push('children(' + childSel + ') count ' + count + ' < min ${a.minChildren}');
    }`
                : ''
        }
    if (fails.length) return { pass: false, reason: fails.join('; ') };
    return { pass: true };
  })()`,

    icon: a =>
        `(function() {
    const el = ${findElementExpression(a)};
    if (!el) return { pass: false, reason: 'Element not found: ${a.selector}' };
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { pass: false, reason: 'Icon has zero rendered size (' + r.width + '×' + r.height + ')' };
    if (el.tagName === 'IMG' && el.naturalWidth === 0) return { pass: false, reason: 'IMG naturalWidth is 0 (failed to load)' };
    return { pass: true, detail: { width: r.width, height: r.height } };
  })()`,

    occlusion: a =>
        `(function() {
    const el = ${findElementExpression(a)};
    if (!el) return { pass: false, reason: 'Element not found: ${a.selector}' };
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top  + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    if (!top) return { pass: false, reason: 'elementFromPoint returned null at center (' + cx + ',' + cy + ')' };
    if (el === top || el.contains(top) || top.contains(el)) return { pass: true };
    const tag = top.tagName.toLowerCase();
    const cls = top.className ? '.' + String(top.className).split(' ')[0] : '';
    return {
      pass: false,
      reason: 'Occluded by ' + tag + cls + ' (z-index: ' + getComputedStyle(top).zIndex + ')',
      detail: { occluder: tag + cls }
    };
  })()`,

    custom: a =>
        `(async function() {
    const result = await (async () => { ${a.script} })();
    if (typeof result === 'object' && result !== null) return result;
    return result ? { pass: true } : { pass: false, reason: 'Custom assertion returned falsy' };
  })()`,
};

// ── Run a single assertion ────────────────────────────────────────────────────

async function runAssertion(a, stepLabel) {
    const runner = runners[a.type];
    if (!runner) {
        const entry = {
            id: a.id,
            desc: a.desc,
            ...(a.dim && {dim: a.dim}),
            ...(stepLabel && {step: stepLabel}),
            reason: `Unknown assertion type: ${a.type}`,
        };
        console.error(`  💥 ${a.id}: ${a.desc} — ${entry.reason}`);
        return {ok: false, entry};
    }
    try {
        const outcome = await evalInPage(runner(a));
        const base = {id: a.id, desc: a.desc, ...(a.dim && {dim: a.dim}), ...(stepLabel && {step: stepLabel})};
        if (outcome.pass) {
            console.error(`  ✅ ${a.id}${a.dim ? ' [' + a.dim + ']' : ''}: ${a.desc}`);
            return {ok: true, entry: {...base, detail: outcome.detail}};
        }
        else {
            console.error(`  ❌ ${a.id}${a.dim ? ' [' + a.dim + ']' : ''}: ${a.desc} — ${outcome.reason}`);
            return {ok: false, entry: {...base, reason: outcome.reason, detail: outcome.detail}};
        }
    }
    catch (err) {
        const entry = {
            id: a.id,
            desc: a.desc,
            ...(a.dim && {dim: a.dim}),
            ...(stepLabel && {step: stepLabel}),
            reason: err.message,
        };
        console.error(`  💥 ${a.id}: ${a.desc} — ${err.message}`);
        return {ok: false, entry};
    }
}

// ── Detect and normalize input format ────────────────────────────────────────

// Returns an array of { stepLabel, action, assertions } units
function normalizeInput(input) {
    // Single scenario object
    if (!Array.isArray(input) && input.steps) {
        return input.steps.map((step, i) => ({
            stepLabel: step.desc || `Step ${i + 1}`,
            action: step.action || null,
            assertions: step.assertions || [],
        }));
    }
    // Array of scenarios
    if (Array.isArray(input) && input.length > 0 && input[0].steps) {
        return input.flatMap(scenario =>
            scenario.steps.map((step, i) => ({
                stepLabel: `[${scenario.id || scenario.desc}] ${step.desc || 'Step ' + (i + 1)}`,
                action: step.action || null,
                assertions: step.assertions || [],
            }))
        );
    }
    // Flat array (original format)
    return [{stepLabel: null, action: null, assertions: input}];
}

// ── Execute ───────────────────────────────────────────────────────────────────

const results = {passed: [], failed: [], errors: []};
const units = normalizeInput(input);

for (const {stepLabel, action, assertions} of units) {
    if (stepLabel) {
        console.error(`\n▶ ${stepLabel}`);
    }

    if (action) {
        try {
            console.error(`  ⚡ action: ${action.type}${action.selector ? ' ' + action.selector : ''}`);
            await executeAction(action);
        }
        catch (err) {
            console.error(`  💥 action failed: ${err.message}`);
            // Mark all assertions in this step as errors due to action failure
            for (const a of assertions) {
                results.errors.push({
                    id: a.id,
                    desc: a.desc,
                    ...(a.dim && {dim: a.dim}),
                    step: stepLabel,
                    reason: `Action failed: ${err.message}`,
                });
            }
            continue;
        }
    }

    for (const a of assertions) {
        const {ok, entry} = await runAssertion(a, stepLabel);
        if (ok) {
            results.passed.push(entry);
        }
        else {
            results.errors.push ? results.failed.push(entry) : results.errors.push(entry);
        }
    }
}

cdp.close();

// ── Summary ───────────────────────────────────────────────────────────────────

const total = results.passed.length + results.failed.length + results.errors.length;
results.summary = {
    total,
    passed: results.passed.length,
    failed: results.failed.length,
    errors: results.errors.length,
    allPassed: results.failed.length === 0 && results.errors.length === 0,
};

console.error(
    `\n${results.summary.passed}/${total} passed, ${results.summary.failed} failed, ${results.summary.errors} errors`
);
console.log(JSON.stringify(results, null, 2));

process.exit(results.summary.allPassed ? 0 : 1);
