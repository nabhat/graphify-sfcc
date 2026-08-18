// Unit tests for installSkill().

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const norm = (p) => p.replace(/\\/g, '/');

const fixtureRoot = norm(path.join(os.tmpdir(), 'sfcc-graph-install-fixture-' + process.pid));
fs.rmSync(fixtureRoot, { recursive: true, force: true });

process.env.SFCC_GRAPH_ROOT = fixtureRoot;

const { installSkill } = await import('../dist/install.js');

after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

test('installSkill() writes SKILL.md into project .claude directory', () => {
    const installed = installSkill('project');
    assert.equal(fs.existsSync(installed), true);
    const content = fs.readFileSync(installed, 'utf8');
    assert(content.includes('graphify-sfcc'));

});
