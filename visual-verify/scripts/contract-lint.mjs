#!/usr/bin/env node
/**
 * Static validation for visual-verify checkpoint contracts.
 * Catches unsupported assertion/action types and missing required fields before browser execution.
 *
 * Usage:
 *   node scripts/contract-lint.mjs --assertions .verify/checkpoint-1.json
 */

import {readFile} from 'fs/promises';
import {existsSync} from 'fs';

function arg(name) {
    const index = process.argv.indexOf(`--${name}`);
    if (index === -1) {
        return null;
    }
    return process.argv[index + 1] ?? null;
}

const assertionsArg = arg('assertions');

if (!assertionsArg) {
    console.error('Usage: node scripts/contract-lint.mjs --assertions <json-file-or-inline-json>');
    process.exit(1);
}

let input;
try {
    if (existsSync(assertionsArg)) {
        input = JSON.parse(await readFile(assertionsArg, 'utf-8'));
    }
    else {
        input = JSON.parse(assertionsArg);
    }
}
catch (err) {
    console.error(`Invalid JSON: ${err.message}`);
    process.exit(1);
}

const assertionTypes = new Set([
    'exists',
    'visible',
    'rect',
    'overflow',
    'clipping',
    'content',
    'icon',
    'occlusion',
    'custom',
]);
const actionTypes = new Set(['click', 'fill', 'wait', 'navigate', 'eval']);

const assertionRequired = {
    exists: ['selector'],
    visible: ['selector'],
    rect: ['selector'],
    overflow: ['selector'],
    clipping: ['selector'],
    content: ['selector'],
    icon: ['selector'],
    occlusion: ['selector'],
    custom: ['script'],
};

const actionRequired = {
    click: ['selector'],
    fill: ['selector', 'value'],
    wait: ['selector'],
    navigate: ['url'],
    eval: ['script'],
};

const errors = [];
const warnings = [];

function pathOf(parts) {
    return parts.join('.');
}

function requireFields(obj, fields, path) {
    for (const field of fields) {
        if (obj[field] == null || obj[field] === '') {
            errors.push(`${path}: missing required field \`${field}\``);
        }
    }
}

function lintFilter(target, path) {
    if (!target.filter) {
        return;
    }
    if (typeof target.filter !== 'object' || Array.isArray(target.filter)) {
        errors.push(`${path}.filter: must be an object`);
        return;
    }
    const allowed = new Set(['text', 'includes', 'ariaLabel', 'role']);
    for (const key of Object.keys(target.filter)) {
        if (!allowed.has(key)) {
            warnings.push(
                `${path}.filter.${key}: unsupported filter key; supported keys are text, includes, ariaLabel, role`
            );
        }
    }
}

function lintAssertion(assertion, path) {
    if (!assertion || typeof assertion !== 'object') {
        errors.push(`${path}: assertion must be an object`);
        return;
    }
    if (!assertion.id) {
        warnings.push(`${path}: missing \`id\` makes reports harder to read`);
    }
    if (!assertion.desc) {
        warnings.push(`${path}: missing \`desc\` makes reports harder to read`);
    }
    if (!assertion.type) {
        errors.push(`${path}: missing required field \`type\``);
        return;
    }
    if (!assertionTypes.has(assertion.type)) {
        errors.push(
            `${path}: unsupported assertion type \`${assertion.type}\`. Use one of: ${
                Array.from(assertionTypes).join(', ')
            }`
        );
        return;
    }
    requireFields(assertion, assertionRequired[assertion.type], path);
    lintFilter(assertion, path);
    if (assertion.dim) {
        warnings.push(`${path}.dim: dimension labels are optional and discouraged; prefer a clear \`desc\``);
    }
}

function lintAction(action, path) {
    if (!action) {
        return;
    }
    if (!action.type) {
        errors.push(`${path}: missing required field \`type\``);
        return;
    }
    if (!actionTypes.has(action.type)) {
        errors.push(
            `${path}: unsupported action type \`${action.type}\`. Use one of: ${Array.from(actionTypes).join(', ')}`
        );
        return;
    }
    requireFields(action, actionRequired[action.type], path);
    lintFilter(action, path);
}

function lintAssertions(assertions, path) {
    if (!Array.isArray(assertions)) {
        errors.push(`${path}: must be an array`);
        return;
    }
    assertions.forEach((assertion, index) => lintAssertion(assertion, pathOf([path, index])));
}

function lintScenario(scenario, path) {
    if (!Array.isArray(scenario.steps)) {
        errors.push(`${path}.steps: must be an array`);
        return;
    }
    scenario.steps.forEach((step, index) => {
        const stepPath = pathOf([path, 'steps', index]);
        if (!step || typeof step !== 'object') {
            errors.push(`${stepPath}: step must be an object`);
            return;
        }
        lintAction(step.action, `${stepPath}.action`);
        lintAssertions(step.assertions ?? [], `${stepPath}.assertions`);
    });
}

if (Array.isArray(input)) {
    if (input.length > 0 && input[0]?.steps) {
        input.forEach((scenario, index) => lintScenario(scenario, `root[${index}]`));
    }
    else {
        lintAssertions(input, 'root');
    }
}
else if (input && typeof input === 'object' && input.steps) {
    lintScenario(input, 'root');
}
else {
    errors.push('root: expected a flat assertion array, a scenario object with steps, or an array of scenarios');
}

for (const warning of warnings) {
    console.error(`⚠️  ${warning}`);
}
for (const error of errors) {
    console.error(`❌ ${error}`);
}

const result = {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {errors: errors.length, warnings: warnings.length},
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.valid ? 0 : 1);
