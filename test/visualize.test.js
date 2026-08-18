// Unit tests for visualize() HTML visualization generator.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const norm = (p) => p.replace(/\\/g, '/');

const fixtureRoot = norm(path.join(os.tmpdir(), 'sfcc-graph-viz-fixture-' + process.pid));
fs.rmSync(fixtureRoot, { recursive: true, force: true });

function wf(rel, content = '') {
    const abs = path.join(fixtureRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return norm(abs);
}

wf('app_storefront_base/cartridge/controllers/Home.js', 'var server = require("server");');

process.env.SFCC_GRAPH_ROOT = fixtureRoot;
process.env.SFCC_GRAPH_CARTRIDGE_PATH = 'app_storefront_base';

const { Index } = await import('../dist/index.js');
const { visualize } = await import('../dist/visualize.js');
Index.build();

after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

test('visualize() generates HTML visualization file', () => {
    const htmlFile = path.join(fixtureRoot, 'test-viz.html');
    const outPath = visualize({ output: htmlFile, open: false, pruned: false });
    assert.equal(norm(outPath), norm(htmlFile));
    assert.equal(fs.existsSync(outPath), true);
    const content = fs.readFileSync(outPath, 'utf8');
    assert(content.includes('<!DOCTYPE html>'));
    assert(content.includes('vis.Network'));
});

test('visualize() supports pruned mode', () => {
    const htmlFile = path.join(fixtureRoot, 'test-viz-pruned.html');
    const outPath = visualize({ output: htmlFile, open: false, pruned: true });
    assert.equal(norm(outPath), norm(htmlFile));
    assert.equal(fs.existsSync(outPath), true);
    const content = fs.readFileSync(outPath, 'utf8');
    assert(content.includes('PRUNED'));
});
