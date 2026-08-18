// Smoke test: build the graph over the SFCC/SFRA repo at SFCC_GRAPH_ROOT and assert invariants that hold
// for ANY SFRA project — no project-specific cartridge/function names. Nodes are chosen dynamically, so
// this runs against whatever repo the tool is pointed at. Run with `npm run smoke` (after `npm run build`).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Default to the parent of the tool dir (the workspace it's wired into); override with SFCC_GRAPH_ROOT.
process.env.SFCC_GRAPH_ROOT = process.env.SFCC_GRAPH_ROOT || path.resolve(here, '../..');



const { Index } = await import('../dist/index.js');

let failures = 0;
function assert(cond, msg) {
    if (cond) {
        console.log('  ok  -', msg);
    } else {
        console.error('  FAIL -', msg);
        failures++;
    }
}

console.log('Root:', process.env.SFCC_GRAPH_ROOT);
const idx = Index.build();
const stats = idx.stats();
console.log('Stats:', JSON.stringify(stats));

// ---- structural invariants (true for any SFRA repo) ----
assert(stats.files > 0, 'parsed some files');
assert(stats.nodes > 0 && stats.edges > 0, 'graph has nodes and edges');
assert(typeof stats.cartridgePath === 'string' && stats.cartridgePath.length > 0, 'discovered at least one cartridge');
for (const k of ['module', 'route', 'hook', 'template', 'symbol']) {
    assert((stats.counts[k] || 0) > 0, `has ${k} nodes`);
}
for (const k of ['requires', 'definesSymbol', 'callsSymbol']) {
    assert((stats.counts[k] || 0) > 0, `has ${k} edges`);
}

// ---- platform externals: any SFCC code requires dw/* ----
assert(idx.searchNodes('external:dw/', 'external', 500).count > 0, 'dw/* platform APIs mapped as external nodes');

// ---- module queries on a dynamically chosen module ----
const anyMod = idx.searchNodes('cartridge', 'module', 1).hits[0];
assert(anyMod, 'found a module node');
assert(idx.resolveModule('dw/system/Site', anyMod.label).kind === 'external', 'dw/* specifier resolves as external');
assert(Array.isArray(idx.dependenciesOf(anyMod.label).requires), 'dependencies_of returns a requires array');
assert(typeof idx.callersOf(anyMod.label).callers === 'object', 'callers_of returns a callers map');
const ex = idx.explain(anyMod.label);
assert(Array.isArray(ex.inbound) && Array.isArray(ex.outbound), 'explain returns inbound/outbound edges');

// ---- symbol layer on a dynamically chosen symbol ----
const symHit = idx.searchNodes('#', 'symbol', 1).hits[0];
assert(symHit, 'found a symbol node');
const su = idx.symbolUsages(symHit.label);
assert(su.groups.length === 1 && typeof su.groups[0].defLine === 'number', 'symbol_usages resolves a symbol with a def line');
const dsyms = idx.definesSymbols(symHit.label.split('#')[0]);
assert(dsyms.count > 0 && dsyms.symbols.every((s) => s.line > 0), 'defines_symbols lists functions with def lines');

// ---- hook mapping on a dynamically chosen hook ----
const hookHit = idx.searchNodes('.', 'hook', 1).hits[0];
assert(hookHit && Array.isArray(idx.hookHandler(hookHit.label).scripts), 'hook_handler returns a scripts array');

// ---- reports run without throwing ----
const un = idx.unresolved();
assert(Array.isArray(un.deadLinks) && Array.isArray(un.silentNullPrefs) && Array.isArray(un.orphanPrefs), 'unresolved returns its report shape');

console.log(failures === 0 ? '\nSMOKE PASSED' : `\nSMOKE FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
