// Unit tests for grep-router hook.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const hookPath = path.resolve('dist/hooks/grep-router.js');

function runHook(payload) {
    const res = spawnSync(process.execPath, [hookPath], {
        input: JSON.stringify(payload),
        encoding: 'utf8'
    });
    return res.stdout ? JSON.parse(res.stdout) : null;
}

test('grep-router detects require() in Grep tool input', () => {
    const out = runHook({
        tool_name: 'Grep',
        tool_input: { pattern: 'require("*/cartridge/scripts/helper")' }
    });
    assert(out);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert(out.hookSpecificOutput.additionalContext.includes('resolve_module'));
});

test('grep-router detects server.get in Grep tool input', () => {
    const out = runHook({
        tool_name: 'Grep',
        tool_input: { pattern: 'server.get("Show"' }
    });
    assert(out);
    assert(out.hookSpecificOutput.additionalContext.includes('route_info'));
});

test('grep-router detects preference reads in Grep tool input', () => {
    const out = runHook({
        tool_name: 'Grep',
        tool_input: { pattern: 'getCustomPreferenceValue("myPref")' }
    });
    assert(out);
    assert(out.hookSpecificOutput.additionalContext.includes('pref_usage'));
});

test('grep-router detects isinclude / URLUtils in Grep tool input', () => {
    const out = runHook({
        tool_name: 'Grep',
        tool_input: { pattern: '<isinclude template="header" />' }
    });
    assert(out);
    assert(out.hookSpecificOutput.additionalContext.includes('template_graph'));
});

test('grep-router detects hooks.json in Grep tool input', () => {
    const out = runHook({
        tool_name: 'Grep',
        tool_input: { pattern: 'hooks.json' }
    });
    assert(out);
    assert(out.hookSpecificOutput.additionalContext.includes('hook_handler'));
});

test('grep-router detects session.privacy in Grep tool input', () => {
    const out = runHook({
        tool_name: 'Grep',
        tool_input: { pattern: 'session.privacy.token' }
    });
    assert(out);
    assert(out.hookSpecificOutput.additionalContext.includes('global_usages'));
});

test('grep-router detects grep search in Bash tool input', () => {
    const out = runHook({
        tool_name: 'Bash',
        tool_input: { command: 'grep -r "server.get" .' }
    });
    assert(out);
    assert(out.hookSpecificOutput.additionalContext.includes('route_info'));
});

test('grep-router ignores non-search Bash command', () => {
    const out = runHook({
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' }
    });
    assert.equal(out, null);
});

test('grep-router ignores unrelated tool', () => {
    const out = runHook({
        tool_name: 'ReadFile',
        tool_input: { file: 'foo.js' }
    });
    assert.equal(out, null);
});
