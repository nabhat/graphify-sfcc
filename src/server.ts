// sfcc-graph — a Demandware-aware code-graph MCP server.
//
// Models the SFCC resolution semantics plain grep/symbol tools miss: cartridge-path require
// resolution, overlay/superModule chains, server.* route wiring, hooks.json, ISML includes,
// site-preference-to-metadata joins, and dw ambient globals.
//
// Built on the official MCP TypeScript SDK v2 (@modelcontextprotocol/server). A single run() helper
// centralizes JSON formatting + error handling, so tool handlers stay one-liners with no per-tool
// try/catch. stdio transport: stdout is the JSON-RPC channel, so all diagnostics go to stderr.

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod';
import { Index } from './graph/indexer.js';

/** MCP tool-result content shape. */
type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

/** Wrap text as a tool result. */
function ok(text: string): ToolResult {
    return { content: [{ type: 'text', text }] };
}

/** Wrap an error message as a failed tool result. */
function fail(text: string): ToolResult {
    return { content: [{ type: 'text', text: 'Error: ' + text }], isError: true };
}

/** Run a query handler: pretty-print its result as JSON, or surface any thrown error. */
function run(produce: () => unknown): ToolResult {
    try {
        return ok(JSON.stringify(produce(), null, 2));
    } catch (e) {
        return fail((e as Error).message);
    }
}

let index: Index | null = null;
/** Lazily load (or reuse) the index. */
function idx(): Index {
    index ??= Index.load();
    return index;
}


/** Build an McpServer with every sfcc-graph tool registered. */
export function buildMcpServer(): McpServer {
    const server = new McpServer({ name: 'graphify-sfcc', version: '0.1.1' });


    server.registerTool(
        'build_index',
        {
            title: 'Build / refresh the SFCC code graph',
            description:
                'Parse all cartridge JS, ISML, hooks.json, and metadata and (re)build the graph, writing a ' +
                'disk cache. Run this ONCE at the start of a session, and again after you edit cartridge files ' +
                '(the graph does not auto-refresh). Returns node/edge counts by kind.',
            inputSchema: z.object({ force: z.boolean().optional().describe('Ignored placeholder; build always rebuilds from disk.') })
        },
        async () =>
            run(() => {
                index = Index.build();
                return { rebuilt: true, ...index.stats() };
            })
    );

    server.registerTool(
        'stats',
        {
            title: 'Graph statistics',
            description: 'Node and edge counts by kind, plus files parsed and when the graph was built.'
        },
        async () => run(() => idx().stats())
    );

    server.registerTool(
        'resolve_module',
        {
            title: 'Resolve a require() specifier',
            description:
                "Resolve an SFCC require specifier along the cartridge path from a given file. Handles " +
                "'*/cartridge/...' (leftmost-wins search), 'app_storefront_base/cartridge/...', 'base/...', " +
                "relative './...', and 'dw/...'/'server' (external). Reports the winning file and any shadowed " +
                'overrides in lower-priority cartridges.',
            inputSchema: z.object({
                specifier: z.string().describe('The require() argument, e.g. "*/cartridge/scripts/util/array".'),

                fromFile: z.string().describe('The file doing the require, relative to the project root or absolute.')
            })
        },
        async ({ specifier, fromFile }) => run(() => idx().resolveModule(specifier, fromFile))
    );

    server.registerTool(
        'who_overrides',
        {
            title: 'Cartridge-path override chain for a file',
            description:
                'Given a cartridge file, list every cartridge on the path that contains the same ' +
                'cartridge-relative file, in priority order. The first is the winner; the rest are shadowed. ' +
                'Answers "which copy of Checkout.js actually runs" and "what does my overlay shadow".',
            inputSchema: z.object({ file: z.string().describe('A cartridge file, relative to the project root or absolute.') })
        },
        async ({ file }) => run(() => idx().whoOverrides(file))
    );

    server.registerTool(
        'dependencies_of',
        {
            title: 'Modules a file requires',
            description: 'List the resolved require() targets of a JS/ISML file (with the winning cartridge per target).',
            inputSchema: z.object({ file: z.string().describe('A module or template path (as shown in node labels), relative to root.') })
        },
        async ({ file }) => run(() => idx().dependenciesOf(file))
    );

    server.registerTool(
        'callers_of',
        {
            title: 'What points at a file',
            description:
                'List everything that requires, hooks, or otherwise references a file, grouped by edge kind ' +
                '(requires / callsHook / ...). Use to gauge blast radius before editing a helper or script.',
            inputSchema: z.object({ file: z.string().describe('A module path (as shown in node labels), relative to root.') })
        },
        async ({ file }) => run(() => idx().callersOf(file))
    );

    server.registerTool(
        'route_info',
        {
            title: 'Who produces / references a route',
            description:
                'For a "Controller-Action" route, show which modules prepend/append/replace/add it and which ' +
                'templates remote-include or link to it. Note: server.extend does not create per-action edges — ' +
                'use who_overrides on the controller file to see overlay relationships.',
            inputSchema: z.object({ route: z.string().describe('A route id, e.g. "Checkout-Begin".') })

        },
        async ({ route }) => run(() => idx().routeInfo(route))
    );

    server.registerTool(
        'hook_handler',
        {
            title: 'Resolve a hooks.json hook to its script(s)',
            description: 'Given a hook name (e.g. "dw.order.calculateTax"), return the script file(s) it maps to.',
            inputSchema: z.object({ hookName: z.string().describe('A hook name from hooks.json or a HookMgr.callHook call, e.g. "dw.order.calculateTax".') })
        },
        async ({ hookName }) => run(() => idx().hookHandler(hookName))
    );

    server.registerTool(
        'defines_symbols',
        {
            title: 'List top-level functions defined in a module',
            description: 'List all top-level functions declared in a JS module with their def line numbers. Use to jump to a function without reading the whole file.',
            inputSchema: z.object({ file: z.string().describe('Relative file path, e.g. "app_storefront_base/cartridge/controllers/Checkout.js".') })
        },
        async ({ file }) => run(() => idx().definesSymbols(file))
    );

    server.registerTool(
        'symbol_usages',
        {
            title: 'Exact call sites of a function across the codebase',
            description:
                'Return every file:line call site of a function across the codebase, attributed to the target ' +
                'symbol. Identically named functions (Handle/Calculate/getValue across modules) are ' +
                'disambiguated by cartridge path (the module bound by require()). Also captures ' +
                'name (e.g. "Calculate") or "relPath#name" for one exact ' +
                'symbol. Identically named functions (Handle/Authorize/getValue across processors) are ' +
                'DISAMBIGUATED by cartridge-path resolution and returned as separate groups, one per defining ' +
                'module. Covers alias calls (h.method()), inline require().method(), member-extract/destructured ' +
                'requires, same-file calls, and hook-dispatched calls (HookMgr.callHook / SFRA hooksHelper, ' +
                'including dynamic name prefixes) joined through hooks.json to script#fn and tagged ' +
                'via: hook-dispatch. Only dw/* platform calls are not tracked.',
            inputSchema: z.object({ query: z.string().describe('A function name (e.g. "Handle") or "relPath#name" for an exact symbol.') })
        },
        async ({ query }) => run(() => idx().symbolUsages(query))
    );

    server.registerTool(
        'template_graph',
        {
            title: 'ISML include / link graph for a template',
            description:
                'For an ISML template, show its local includes, remote includes (to routes), route links, and ' +
                'require() reads, plus which templates include it.',
            inputSchema: z.object({ template: z.string().describe('A template path (as shown in node labels), relative to root.') })
        },
        async ({ template }) => run(() => idx().templateGraph(template))
    );

    server.registerTool(
        'pref_usage',
        {
            title: 'Site-preference usage + metadata join',
            description:
                'For a site-preference id (e.g. "MyCartridge_Enabled"), show where it is read in code ' +
                'and whether it is defined in customPreferences.js and in importable metadata. Flags silentNullRisk ' +
                '(read in code but missing from metadata) and orphan (defined but never read).',
            inputSchema: z.object({ pref: z.string().describe('A site-preference / attribute id.') })
        },
        async ({ pref }) => run(() => idx().prefUsage(pref))
    );

    server.registerTool(
        'uses_global',
        {
            title: 'dw ambient globals used by a file',
            description:
                'List the SFCC ambient globals (session, request, customer, response, pdict, slotcontent) a file ' +
                'touches and which members it accesses. Useful for spotting session.privacy vs session.custom usage.',
            inputSchema: z.object({ file: z.string().describe('A module or template path, relative to root.') })
        },
        async ({ file }) => run(() => idx().usesGlobalByFile(file))
    );

    server.registerTool(
        'global_usages',
        {
            title: 'Files that use a given dw global',
            description: 'Reverse of uses_global: every file that touches a given ambient global (session/request/customer/pdict/...).',
            inputSchema: z.object({ global: z.string().describe('A global name: session, request, customer, response, pdict, or slotcontent.') })
        },
        async ({ global }) => run(() => idx().globalUsages(global))
    );

    server.registerTool(
        'unresolved',
        {
            title: 'Dead links and site-preference mismatches',
            description:
                'Report broken wiring: require()/hook targets that look like cartridge paths but resolve to nothing, ' +
                'site-prefs read in code but missing from metadata (silent-null risk), and prefs defined but never read.'
        },
        async () => run(() => idx().unresolved())
    );

    server.registerTool(
        'search_nodes',
        {
            title: 'Search graph nodes',
            description: 'Substring search over node ids/labels, optionally filtered by kind (module, template, route, hook, pref, global, external, apiClass, symbol).',
            inputSchema: z.object({
                query: z.string().describe('Substring to match against node id/label (case-insensitive).'),
                kind: z.string().optional().describe('Optional node-kind filter.'),
                limit: z.number().int().positive().optional().describe('Max hits (default 50).')
            })
        },
        async ({ query, kind, limit }) => run(() => idx().searchNodes(query, kind, limit))
    );

    server.registerTool(
        'explain',
        {
            title: 'Explain a node with its links',
            description:
                'Show a node (module, template, route, hook, pref, global, external, apiClass, symbol) with its inbound ' +
                'and outbound edges. Each link carries its source line and an EXTRACTED (parsed from source) or ' +
                'INFERRED (derived from cartridge layout, e.g. superModule) confidence tag. Accepts a full node id, ' +
                'an exact label, or an unambiguous substring.',
            inputSchema: z.object({ node: z.string().describe('A node id, label, or unambiguous substring (see search_nodes).') })
        },
        async ({ node }) => run(() => idx().explain(node))
    );

    server.registerTool(
        'shortest_path',
        {
            title: 'Shortest path between two nodes',
            description:
                'Find the shortest directed path between two nodes (following out-edges: caller -> callee, ' +
                'template -> route, hook -> script, ...). Each endpoint accepts a node id, label, or unambiguous ' +
                'substring. Returns the node sequence and hop count, or found:false if unreachable.',
            inputSchema: z.object({
                from: z.string().describe('Start node (id, label, or substring).'),
                to: z.string().describe('End node (id, label, or substring).')
            })
        },
        async ({ from, to }) => run(() => idx().shortestPath(from, to))
    );

    return server;
}

/** Start the MCP server over stdio. */
export async function startServer(): Promise<void> {
    serveStdio(() => buildMcpServer());
    console.error('graphify-sfcc running on stdio; run build_index first, then query.');
}

