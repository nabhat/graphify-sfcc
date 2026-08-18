// Unit tests for the Index class and query methods over a full fixture repo.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const norm = (p) => p.replace(/\\/g, '/');

const fixtureRoot = norm(path.join(os.tmpdir(), 'sfcc-graph-indexer-fixture-' + process.pid));
fs.rmSync(fixtureRoot, { recursive: true, force: true });

function wf(rel, content = '') {
    const abs = path.join(fixtureRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return norm(abs);
}

wf('app_storefront_base/cartridge/controllers/Home.js', `
    var server = require('server');
    server.get('Show', function(req, res, next) {
        res.render('home/home');
    });
`);

wf('app_storefront_base/cartridge/controllers/Checkout.js', `
    var server = require('server');
    var helper = require('*/cartridge/scripts/checkoutHelper');
    function processCheckout() {
        var pref = Site.getCurrent().getCustomPreferenceValue('enableCheckout');
        var s = session.privacy.token;
    }
    server.get('Show', function(req, res, next) {
        processCheckout();
        helper.validate();
    });
`);

wf('app_storefront_base/cartridge/scripts/checkoutHelper.js', `
    function validate() {
        return true;
    }
    exports.validate = validate;
`);

wf('app_storefront_base/cartridge/templates/default/home/home.isml', `
    <isinclude template="components/header.isml" />
    <a href="\${URLUtils.url('Checkout-Show')}">Checkout</a>
`);

wf('app_storefront_base/cartridge/templates/default/components/header.isml', `
    <div>Header</div>
`);

wf('app_storefront_base/cartridge/hooks.json', JSON.stringify({
    hooks: [
        { name: 'dw.order.calculateTax', script: './cartridge/scripts/hooks/tax.js' }
    ]
}));

wf('app_storefront_base/cartridge/scripts/hooks/tax.js', `
    function calculateTax() {}
    exports.calculateTax = calculateTax;
`);

wf('app_storefront_base/cartridge/configuration/preferences/customPreferences.js', `
    module.exports = {
        enableCheckout: { id: 'enableCheckout', type: 'boolean' },
        orphanPref: { id: 'orphanPref', type: 'boolean' }
    };
`);

wf('app_storefront_base/meta/system-objecttype-extensions.xml', `
    <metadata>
        <attribute-definition attribute-id="enableCheckout"/>
        <attribute-definition attribute-id="metaOnlyPref"/>
    </metadata>
`);

wf('app_storefront_base/cartridge/forms/default/shipping.xml', `
    <form><field formid="address"/></form>
`);

process.env.SFCC_GRAPH_ROOT = fixtureRoot;
process.env.SFCC_GRAPH_CARTRIDGE_PATH = 'app_storefront_base';

const { Index } = await import('../dist/index.js');
const idx = Index.build();

after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

test('Index.stats() returns file, node, edge counts', () => {
    const stats = idx.stats();
    assert(typeof stats.files === 'number' && stats.files > 0);
    assert(typeof stats.nodes === 'number' && stats.nodes > 0);
    assert(typeof stats.edges === 'number' && stats.edges > 0);
});

test('Index.load() reloads or builds index', () => {
    const loaded = Index.load();
    assert(loaded.fileCount > 0);
});

test('Index.resolveModule() resolves specifier', () => {
    const res = idx.resolveModule('*/cartridge/scripts/checkoutHelper', 'app_storefront_base/cartridge/controllers/Checkout.js');
    assert.equal(res.kind, 'module');
});

test('Index.whoOverrides() returns override chain', () => {
    const res = idx.whoOverrides('app_storefront_base/cartridge/controllers/Checkout.js');
    assert.equal(res.file, 'app_storefront_base/cartridge/controllers/Checkout.js');
});

test('Index.dependenciesOf() returns module requires', () => {
    const deps = idx.dependenciesOf('app_storefront_base/cartridge/controllers/Checkout.js');
    assert(Array.isArray(deps.requires));
});

test('Index.callersOf() returns incoming caller edges', () => {
    const callers = idx.callersOf('app_storefront_base/cartridge/scripts/checkoutHelper.js');
    assert(typeof callers.callers === 'object');
});

test('Index.definesSymbols() returns defined functions', () => {
    const syms = idx.definesSymbols('app_storefront_base/cartridge/scripts/checkoutHelper.js');
    assert.equal(syms.count, 1);
    assert.equal(syms.symbols[0].name, 'validate');
});

test('Index.symbolUsages() finds usages of function', () => {
    const usages = idx.symbolUsages('validate');
    assert(usages.groupCount > 0);
});

test('Index.routeInfo() returns route producers', () => {
    const route = idx.routeInfo('Home-Show');
    assert.equal(route.route, 'Home-Show');
});

test('Index.hookHandler() returns hook script handlers', () => {
    const hook = idx.hookHandler('dw.order.calculateTax');
    assert.equal(hook.scripts.length, 1);
});

test('Index.templateGraph() returns template includes and outbound links', () => {
    const tpl = idx.templateGraph('app_storefront_base/cartridge/templates/default/home/home.isml');
    assert.equal(tpl.template, 'app_storefront_base/cartridge/templates/default/home/home.isml');
});

test('Index.prefUsage() inspects site preference reads and metadata declarations', () => {
    const pref = idx.prefUsage('enableCheckout');
    assert.equal(pref.pref, 'enableCheckout');
    assert.equal(pref.definedInCustomPrefs, true);
    assert.equal(pref.definedInMeta, true);
});

test('Index.usesGlobalByFile() and globalUsages() inspect global accesses', () => {
    const globals = idx.usesGlobalByFile('app_storefront_base/cartridge/controllers/Checkout.js');
    assert(Array.isArray(globals.globals));
    const usage = idx.globalUsages('session');
    assert.equal(usage.global, 'session');
});

test('Index.unresolved() returns dead links and orphan/silent-null prefs', () => {
    const un = idx.unresolved();
    assert(Array.isArray(un.deadLinks));
    assert(Array.isArray(un.silentNullPrefs));
    assert(Array.isArray(un.orphanPrefs));
});

test('Index.searchNodes() returns matching graph nodes', () => {
    const search = idx.searchNodes('Checkout', 'module');
    assert(search.count > 0);
});

test('Index.explain() returns node attributes and edges', () => {
    const exp = idx.explain('app_storefront_base/cartridge/controllers/Checkout.js');
    assert(Array.isArray(exp.outbound));
    assert(Array.isArray(exp.inbound));
});

test('Index.shortestPath() finds path between graph nodes', () => {
    const sp = idx.shortestPath(
        'app_storefront_base/cartridge/controllers/Checkout.js',
        'app_storefront_base/cartridge/scripts/checkoutHelper.js'
    );
    assert.equal(sp.found, true);
});
