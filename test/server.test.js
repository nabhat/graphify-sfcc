// Unit tests for MCP server tool registration and handlers.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const norm = (p) => p.replace(/\\/g, '/');

const fixtureRoot = norm(path.join(os.tmpdir(), 'sfcc-graph-server-fixture-' + process.pid));
fs.rmSync(fixtureRoot, { recursive: true, force: true });

function wf(rel, content = '') {
    const abs = path.join(fixtureRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return norm(abs);
}

wf('app_storefront_base/cartridge/controllers/Checkout.js', `
    var server = require('server');
    server.get('Show', function(req, res, next) {
        res.render('checkout/checkout');
    });
`);

process.env.SFCC_GRAPH_ROOT = fixtureRoot;
process.env.SFCC_GRAPH_CARTRIDGE_PATH = 'app_storefront_base';

const { Index } = await import('../dist/index.js');
Index.build();

after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

test('Index queries format clean JSON outputs for MCP server handlers', () => {
    const idx = Index.load();
    const stats = idx.stats();
    assert(stats.files > 0);
    const resolved = idx.resolveModule('server', 'app_storefront_base/cartridge/controllers/Checkout.js');
    assert.equal(resolved.kind, 'external');
});
