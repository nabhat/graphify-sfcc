// Unit tests for the cartridge-path resolver (CartridgeResolver).
//
// Zero dependencies: node:test + node:assert. Builds a tiny split-root cartridge fixture in a temp dir
// and drives the REAL resolver against it (exists() hits the filesystem), so these lock in the exact
// behaviours that were bugs before — `~/` current-cartridge, `*/` leftmost-wins, `.json`/index.js
// fallbacks, shadow chain, and superModule. Run with `npm test` (after `npm run build`).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const norm = (p) => p.replace(/\\/g, '/');

// ---- build a fixture repo: overlay > overlay_base > app_storefront_base --------------------------
const fixtureRoot = norm(path.join(os.tmpdir(), 'sfcc-graph-resolver-fixture-' + process.pid));
fs.rmSync(fixtureRoot, { recursive: true, force: true });

/** Write a fixture file (creating parents) and return its normalized absolute path. */
function wf(rel, content = '') {
    const abs = path.join(fixtureRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return norm(abs);
}

const overlayCheckout = wf('overlay/cartridge/controllers/Checkout.js', 'module.exports = {};');
const overlayFoo = wf('overlay/cartridge/scripts/helpers/foo.js');
const countries = wf('overlay/cartridge/config/countries.json', '{}');
const thingIndex = wf('overlay/cartridge/modules/thing/index.js');
const overlayTpl = wf('overlay/cartridge/templates/default/checkout/checkout.isml');

const overlayBaseCheckout = wf('overlay_base/cartridge/controllers/Checkout.js');
const obBar = wf('overlay_base/cartridge/scripts/helpers/bar.js');
const obBaz = wf('overlay_base/cartridge/scripts/helpers/baz.js');

const baseCheckout = wf('app_storefront_base/cartridge/controllers/Checkout.js');
const baseClient = wf('app_storefront_base/cartridge/client/default/js/checkout/checkout.js');
const baseTpl = wf('app_storefront_base/cartridge/templates/default/checkout/checkout.isml');

// Env must be set BEFORE constructing the resolver (its constructor reads these).
process.env.SFCC_GRAPH_ROOT = fixtureRoot; // so dwJsonCartridgePath() finds no dw.json here
process.env.SFCC_GRAPH_CARTRIDGE_PATH = 'overlay:overlay_base:app_storefront_base';

const { CartridgeResolver } = await import('../dist/index.js');

const cart = (name) => ({
    name,
    dir: norm(path.join(fixtureRoot, name)),
    cartridgeDir: norm(path.join(fixtureRoot, name, 'cartridge'))
});
const r = new CartridgeResolver([cart('overlay'), cart('overlay_base'), cart('app_storefront_base')]);

after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

// ---- tests ---------------------------------------------------------------------------------------

test('cartridge-path order comes from SFCC_GRAPH_CARTRIDGE_PATH', () => {
    assert.deepEqual(r.pathOrder(), ['overlay', 'overlay_base', 'app_storefront_base']);
    assert.equal(r.pathSource, 'env');
});

test('*/cartridge resolves leftmost-wins and reports shadows', () => {
    const res = r.resolve('*/cartridge/controllers/Checkout', baseCheckout);
    assert.equal(res.kind, 'module');
    assert.equal(res.winnerCartridge, 'overlay');
    assert.ok(res.abs.endsWith('overlay/cartridge/controllers/Checkout.js'));
    assert.equal(res.shadows.length, 2); // overlay_base + app_storefront_base
});

test('~/cartridge resolves to the current (owner) cartridge', () => {
    const res = r.resolve('~/cartridge/scripts/helpers/bar', obBaz);
    assert.equal(res.kind, 'module');
    assert.equal(res.winnerCartridge, 'overlay_base');
    assert.ok(res.abs.endsWith('overlay_base/cartridge/scripts/helpers/bar.js'));
});

test('~/cartridge falls back to path search when the owner lacks the file', () => {
    const res = r.resolve('~/cartridge/scripts/helpers/foo', obBaz); // overlay_base has no foo
    assert.equal(res.kind, 'module');
    assert.equal(res.winnerCartridge, 'overlay'); // only overlay has foo
});

test('app_storefront_base/cartridge resolves to base explicitly', () => {
    const res = r.resolve('app_storefront_base/cartridge/controllers/Checkout', overlayCheckout);
    assert.equal(res.winnerCartridge, 'app_storefront_base');
    assert.ok(res.abs.endsWith('app_storefront_base/cartridge/controllers/Checkout.js'));
});

test('.json extension is resolved (config/countries.json)', () => {
    const res = r.resolve('*/cartridge/config/countries', baseCheckout);
    assert.equal(res.kind, 'module');
    assert.ok(res.abs.endsWith('config/countries.json'));
});

test('directory specifier falls back to index.js', () => {
    const res = r.resolve('*/cartridge/modules/thing', baseCheckout);
    assert.equal(res.kind, 'module');
    assert.ok(res.abs.endsWith('modules/thing/index.js'));
});

test('relative ./ resolves against the requiring file directory', () => {
    const res = r.resolve('./bar', obBaz);
    assert.equal(res.kind, 'module');
    assert.ok(res.abs.endsWith('overlay_base/cartridge/scripts/helpers/bar.js'));
});

test('base/ resolves into the app_storefront_base client tree', () => {
    const res = r.resolve('base/checkout/checkout', overlayCheckout);
    assert.equal(res.winnerCartridge, 'app_storefront_base');
    assert.ok(res.abs.endsWith('client/default/js/checkout/checkout.js'));
});

test('dw/* and server specifiers are external', () => {
    assert.equal(r.resolve('dw/system/Site', overlayCheckout).kind, 'external');
    assert.equal(r.resolve('dw/order/OrderMgr', overlayCheckout).kind, 'external');
    assert.equal(r.resolve('server', overlayCheckout).kind, 'external');
});

test('an unknown */cartridge target is external, not a phantom module', () => {
    assert.equal(r.resolve('*/cartridge/does/not/exist', baseCheckout).kind, 'external');
});

test('shadowChain lists every cartridge holding the file, in priority order', () => {
    const chain = r.shadowChain(overlayCheckout);
    assert.deepEqual(
        chain.map((c) => c.cartridge),
        ['overlay', 'overlay_base', 'app_storefront_base']
    );
});

test('superModuleOf returns the next cartridge down that has the file', () => {
    assert.ok(r.superModuleOf(overlayCheckout).endsWith('overlay_base/cartridge/controllers/Checkout.js'));
    assert.equal(r.superModuleOf(baseCheckout), null); // nothing below base on the path
});

test('ownerCartridge identifies the containing cartridge', () => {
    assert.equal(r.ownerCartridge(overlayFoo), 'overlay');
    assert.equal(r.ownerCartridge(obBar), 'overlay_base');
});

test('resolveTemplate is leftmost-wins with shadows', () => {
    const res = r.resolveTemplate('checkout/checkout');
    assert.equal(res.kind, 'module');
    assert.equal(res.winnerCartridge, 'overlay');
    assert.equal(res.shadows.length, 1); // app_storefront_base (overlay_base has no template)
});
