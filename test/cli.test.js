// Unit tests for CLI entry point (dist/cli.js).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const norm = (p) => p.replace(/\\/g, '/');

const fixtureRoot = norm(path.join(os.tmpdir(), 'sfcc-graph-cli-fixture-' + process.pid));
fs.rmSync(fixtureRoot, { recursive: true, force: true });

function wf(rel, content = '') {
    const abs = path.join(fixtureRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return norm(abs);
}

wf('app_storefront_base/cartridge/controllers/Home.js', 'var server = require("server");');

const cliPath = path.resolve('dist/cli.js');

function runCli(args = []) {
    return spawnSync(process.execPath, [cliPath, ...args], {
        cwd: fixtureRoot,
        env: {
            ...process.env,
            SFCC_GRAPH_ROOT: fixtureRoot,
            SFCC_GRAPH_CARTRIDGE_PATH: 'app_storefront_base'
        },
        encoding: 'utf8'
    });
}

after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

test('cli prints version with --version', () => {
    const res = runCli(['--version']);
    assert.equal(res.status, 0);
    assert(res.stdout.trim().length > 0);
});

test('cli executes build command', () => {
    const res = runCli(['build']);
    assert.equal(res.status, 0);
    const stats = JSON.parse(res.stdout);
    assert(typeof stats.files === 'number');
});

test('cli executes visualize command', () => {
    const outHtml = path.join(fixtureRoot, 'viz.html');
    const res = runCli(['visualize', '--output', outHtml, '--no-open']);
    assert.equal(res.status, 0);
    assert(res.stdout.includes('Wrote:'));
    assert(fs.existsSync(outHtml));
});

test('cli executes install command', () => {
    const res = runCli(['install', '--project']);
    assert.equal(res.status, 0);
    assert(res.stdout.includes('Wrote skill (project):'));
});
