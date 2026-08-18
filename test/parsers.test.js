// Unit tests for parsers (JS, ISML, Hooks, Form, Metadata, Expr).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const norm = (p) => p.replace(/\\/g, '/');

const fixtureRoot = norm(path.join(os.tmpdir(), 'sfcc-graph-parsers-fixture-' + process.pid));
fs.rmSync(fixtureRoot, { recursive: true, force: true });

function wf(rel, content = '') {
    const abs = path.join(fixtureRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return norm(abs);
}

process.env.SFCC_GRAPH_ROOT = fixtureRoot;

const { CartridgeResolver, classifyExternal, id } = await import('../dist/index.js');
const { parseJsFile } = await import('../dist/parsers/js.js');
const { parseIsmlFile } = await import('../dist/parsers/isml.js');
const { parseHooksFile } = await import('../dist/parsers/hooks.js');
const { parseMetaXml, parseCustomPrefs } = await import('../dist/parsers/metadata.js');
const { parseFormFile } = await import('../dist/parsers/forms.js');
const { analyzeExpressions, extractDollarExpressions } = await import('../dist/parsers/expr.js');

const r = new CartridgeResolver([{
    name: 'app_storefront_base',
    dir: fixtureRoot,
    cartridgeDir: norm(path.join(fixtureRoot, 'cartridge'))
}]);

after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

test('classifyExternal classifies dw platform and framework specifiers', () => {
    assert.equal(classifyExternal('dw/system/Site'), 'platform');
    assert.equal(classifyExternal('dw'), 'platform');
    assert.equal(classifyExternal('server'), 'framework');
    assert.equal(classifyExternal('base/checkout'), 'framework');
    assert.equal(classifyExternal('some-other-pkg'), 'unknown');
});

test('id helpers format node IDs correctly', () => {
    assert.equal(id.cartridge('app'), 'cartridge:app');
    assert.equal(id.module('foo.js'), 'module:foo.js');
    assert.equal(id.template('bar.isml'), 'template:bar.isml');
    assert.equal(id.route('Checkout-Show'), 'route:Checkout-Show');
    assert.equal(id.hook('dw.order.calculateTax'), 'hook:dw.order.calculateTax');
    assert.equal(id.pref('customPref'), 'pref:customPref');
    assert.equal(id.global('session'), 'global:session');
    assert.equal(id.external('dw/system/Site'), 'external:dw/system/Site');
    assert.equal(id.service('taxService'), 'service:taxService');
    assert.equal(id.form('shipping'), 'form:shipping');
    assert.equal(id.job('job.js'), 'job:job.js');
});

test('extractDollarExpressions extracts ISML ${...} expressions', () => {
    const exprs = extractDollarExpressions('Hello ${pdict.name} and ${URLUtils.url("Home-Show")}');
    assert.deepEqual(exprs, ['pdict.name', 'URLUtils.url("Home-Show")']);
});

test('analyzeExpressions extracts requires, routeLinks, and ambient globals', () => {
    const signals = analyzeExpressions([
        'var Site = require("dw/system/Site");',
        'var link = URLUtils.url("Checkout-Show");',
        'var action = new URLAction("Home-Show");',
        'var user = pdict.customer.profile;'
    ]);
    assert.deepEqual(signals.requires, ['dw/system/Site']);
    assert.deepEqual(signals.routeLinks, ['Checkout-Show', 'Home-Show']);
    assert.equal(signals.globals.pdict.length, 1);
});

test('parseFormFile parses form XML and handles invalid XML gracefully', () => {
    const abs = wf('cartridge/forms/default/shipping.xml', '<form><field formid="firstName"/><field formid="lastName"/></form>');
    const frag = parseFormFile(abs, fs.readFileSync(abs, 'utf8'));
    assert.equal(frag.nodes.length, 1);
    assert.equal(frag.nodes[0].id, 'form:shipping');
    assert.deepEqual(frag.nodes[0].attrs.fields, ['firstName', 'lastName']);

    const emptyFrag = parseFormFile(abs, 'not xml');
    assert.equal(emptyFrag.edges.length, 0);
});

test('parseHooksFile parses hooks.json and maps hook entries', () => {
    const abs = wf('hooks.json', JSON.stringify({
        hooks: [
            { name: 'dw.order.calculateTax', script: './cartridge/scripts/hooks/tax.js' }
        ]
    }));
    wf('cartridge/scripts/hooks/tax.js', 'exports.calculate = function() {};');
    const frag = parseHooksFile(abs, fs.readFileSync(abs, 'utf8'), r);
    assert.equal(frag.nodes.length, 1);
    assert.equal(frag.edges.length, 1);
    assert.equal(frag.edges[0].kind, 'callsHook');

    const emptyFrag = parseHooksFile(abs, 'invalid json', r);
    assert.equal(emptyFrag.nodes.length, 0);
});

test('parseCustomPrefs parses customPreferences.js declarations', () => {
    const abs = wf('cartridge/configuration/preferences/customPreferences.js', `
        module.exports = {
            prefOne: { id: 'prefOne', type: 'string' }
        };
    `);
    const frag = parseCustomPrefs(abs, fs.readFileSync(abs, 'utf8'));
    assert.equal(frag.nodes.length, 2);
    assert.equal(frag.edges.length, 1);
    assert.equal(frag.edges[0].kind, 'definesPref');

    const emptyFrag = parseCustomPrefs(abs, 'invalid js');
    assert.equal(emptyFrag.edges.length, 0);
});

test('parseMetaXml parses metadata XML attribute-id values', () => {
    const abs = wf('meta/system-objecttype-extensions.xml', '<metadata><attribute-definition attribute-id="prefOne"/></metadata>');
    const frag = parseMetaXml(abs, fs.readFileSync(abs, 'utf8'));
    assert.equal(frag.nodes.length, 2);
    assert.equal(frag.edges.length, 1);
    assert.equal(frag.edges[0].kind, 'definesPref');

    const emptyFrag = parseMetaXml(abs, 'not xml');
    assert.equal(emptyFrag.edges.length, 0);
});

test('parseIsmlFile extracts template dependencies and routes', () => {
    const abs = wf('cartridge/templates/default/checkout.isml', `
        <isinclude template="header.isml" />
        <ismodule template="footer.isml" name="footer" />
        <a href="\${URLUtils.url('Checkout-Show')}">Checkout</a>
    `);
    const frag = parseIsmlFile(abs, fs.readFileSync(abs, 'utf8'), r);
    assert(frag.nodes.length > 0);
    assert(frag.edges.length > 0);
});

test('parseJsFile extracts all framework, URLUtils, Transaction, hooks, and destructuring constructs', () => {
    const abs = wf('cartridge/controllers/Checkout.js', `
        var server = require('server');
        var Site = require('dw/system/Site');
        var OrderMgr = require('dw/order/OrderMgr');
        var { getOrder, updateOrder } = require('*/cartridge/scripts/orders');
        var helper = require('../scripts/helper');
        var hooks = require('*/cartridge/scripts/helpers/hooks.js');

        function doCheckout() {
            var val = Site.getCurrent().getCustomPreferenceValue('myPref');
            var s = session.privacy.name;
            var req = request.httpPath;
            var cust = customer.profile;
            var resp = response.redirect;

            Transaction.wrap(function() {
                var form = getForm('shipping');
                res.render('checkout/summary');
            });

            var url1 = URLUtils.abs('Checkout-Show');
            var url2 = URLUtils.httpsHome('Home-Show');
            var action = new URLAction('Home-Show');
            var api = new dw.system.SiteApi();
            hooks.callHook('dw.order.calculateTax', 'calculate');
        }

        server.extend(module.superModule);
        server.get('Show', function (req, res, next) {
            doCheckout();
        });
        server.post('Submit', function (req, res, next) {});
        server.append('Append', function (req, res, next) {});
        server.prepend('Prepend', function (req, res, next) {});
        server.replace('Replace', function (req, res, next) {});

        module.exports = server.exports();
    `);
    wf('cartridge/scripts/orders.js', 'exports.getOrder = function() {};');
    wf('cartridge/scripts/helper.js', 'exports.help = function() {};');
    wf('cartridge/scripts/helpers/hooks.js', 'exports.callHook = function() {};');

    const frag = parseJsFile(abs, fs.readFileSync(abs, 'utf8'), r);
    assert(frag.nodes.length > 0);
    assert(frag.edges.length > 0);

    const moduleNode = frag.nodes.find((n) => n.kind === 'module');
    assert(moduleNode);
    assert.equal(moduleNode.attrs.isController, true);
    assert.equal(moduleNode.attrs.usesSuperModule, true);
});

test('parseJsFile handles unparseable JavaScript gracefully', () => {
    const abs = wf('cartridge/controllers/Broken.js', 'function ( { invalid syntax');
    const frag = parseJsFile(abs, fs.readFileSync(abs, 'utf8'), r);
    assert.equal(frag.nodes.length, 1);
    assert.equal(frag.edges.length, 0);
});
