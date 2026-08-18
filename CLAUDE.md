# CLAUDE.md — sfcc-graph MCP server

Guidance for Claude Code when working **on the sfcc-graph tool itself** (this `sfcc-graph/`
directory). This is the *source of the graph*, not the cartridges it indexes. For usage/architecture
overview see `README.md`; for change history, known bugs, and the development roadmap see
`MEMORY.md` (read it first when picking up work here).

## What this is

A **Demandware/SFCC-aware code-graph MCP server + engine** (TypeScript, ESM, Node ≥20), a **single npm
package** (`sfcc-graph-mcp`) organized into folders under `src/`. It models the SFCC resolution semantics
that plain grep/symbol tools miss — cartridge-path require resolution, overlay/`superModule` chains,
`server.*` route wiring, `hooks.json`, ISML includes, site-preference↔metadata joins, `dw` ambient
globals, and a function/symbol layer — and exposes them as MCP query tools. It parses a **separate target
repo** (the SFCC/SFRA workspace at `SFCC_GRAPH_ROOT`), not its own code. The public engine API is exported
from `src/index.ts` (package `main`/`exports`), so it's still consumable by other projects via `npm link`
/ `file:` / publish (see `MIGRATION.md`) — one package, no monorepo.

Registered in the repo `.mcp.json` as the `sfcc-graph` server:
`node ${CLAUDE_PROJECT_DIR}/sfcc-graph/dist/cli.js serve`, with `SFCC_GRAPH_ROOT=${CLAUDE_PROJECT_DIR}`.

**Key dependencies:** the MCP layer is built on the **official SDK v2** (`@modelcontextprotocol/server`,
`serveStdio`) — currently a **pre-release, pinned exactly at `2.0.0-beta.5`** (no `^`, so it can't drift
onto a newer beta; bump deliberately when stable `2.0.0` ships). Tool input schemas use **zod v4**. All
filesystem paths go through **`pathe`** (not `node:path`) — see invariant #1.

## 🔴 The #1 gotcha — a rebuild does NOT reach the live tools

The MCP server is a **long-lived process** that loads `dist/` into memory once at startup. After you
edit `src/` and run `npm run build`:

- `mcp__sfcc-graph__build_index` **re-parses cartridge source but still runs the OLD compiled code** —
  it cannot hot-reload `dist/`. Stats/queries will look unchanged.
- **You MUST restart the MCP server process** for code changes to take effect: in Claude Code run
  `/mcp` → reconnect/restart `sfcc-graph`, or restart the session. Then run `build_index` once.

**How to tell the server is stale:** the fixed code produces `external≈87`, `pref≈89`,
`definesPref≈182`; the pre-fix code produced `external=119`, `pref=98`, `definesPref=191`. If
`build_index` still shows the old numbers, the server hasn't been restarted.

**Therefore: verify code changes against `dist/` directly (see below), not through the live MCP tools.**

## Build & verify workflow

```bash
cd sfcc-graph
npm install        # once
npm run build      # tsc -p tsconfig.json -> dist/   (no output = success)
npm run smoke      # node test/smoke.js — builds the graph + asserts known edges (regression gate)
```

For ad-hoc verification of a change **without restarting the MCP server**, run a throwaway Node script
against the freshly-built `dist` — this exercises the real code path deterministically:

```js
// _tmp.mjs  (delete when done)  — place at the sfcc-graph/ root
process.env.SFCC_GRAPH_ROOT = '/path/to/your/sfcc-project';   // the target repo to index
const { Index } = await import('./dist/index.js');
const idx = Index.build();                 // fresh parse with current dist
console.log(idx.whoOverrides('<overlay-cartridge>/cartridge/controllers/Checkout.js'));
console.log(idx.symbolUsages('<functionName>'));
```
`Index.build()` re-parses and rewrites the cache (`<target-repo-root>/.sfcc-graph-cache/graph.json`, via
`cacheDir()` — keyed per target project, not the tool, so multiple projects don't collide);
`Index.load()` reads it. Always `npm run build` then `Index.build()` after a code change.

## Architecture — single package, folders under src/ (see README.md for the full map)

```
src/
  index.ts            public API barrel (Index, types, CartridgeResolver, buildGraph, repo, cacheDir) — package main
  cli.ts              commander entry (serve | build | visualize | install) — the `sfcc-graph` bin
  server.ts           MCP server (official SDK v2: McpServer + serveStdio) + tool registration; a single
                      run() helper wraps each handler (JSON-format result or surface error) — no per-tool try/catch
  install.ts, skill.ts   Claude skill writer
  visualize.ts        standalone HTML visualizer
  types.ts            graph model: NodeKind, EdgeKind, id.* (single source of id formatting)
  resolve/repo.ts     root, path-safety, cartridge discovery, dw.json, cacheDir()
  resolve/cartridgePath.ts   THE resolver — require/template/superModule/shadowChain
  parsers/*.ts        js/isml/hooks/metadata/forms/expr analyzers (emit Fragment)
  graph/graph.ts      graphology MultiDirectedGraph wrapper (build/import/export)
  graph/indexer.ts    orchestration + every query method + resolveHookDispatches (Phase-2)
  hooks/grep-router.ts   standalone PreToolUse hook
test/smoke.js         regression assertions (imports ../dist/index.js)
```

- **Imports are relative with `.js` suffixes** (`./graph/indexer.js`); no package-name imports.
- **Nodes/edges** are addressed by stable string ids from core's `types.ts` `id.*` (e.g. `module:<relPath>`,
  `symbol:<relPath>#<name>`). Always use these helpers — never hand-format ids.
- **Parsers emit `Fragment {nodes, edges}`**; the indexer merges them and builds the graphology graph.
- Query tools in `mcp/server.ts` are thin — real logic lives in `core/graph/indexer.ts` methods.

## Invariants when editing (learned the hard way — see MEMORY.md)

1. **Filesystem paths are forward-slash everywhere — via `pathe`, not `node:path`.**
   Every path-using module imports `pathe` (a drop-in whose `resolve`/`relative`/`join`/`dirname` return
   `/`-separated paths on every OS, and which normalizes `\` input too). So `abs.startsWith(cartridgeDir +
   '/')` comparisons work on Windows with no hand normalization — `cartridgeDir` is `/`-normalized at
   discovery and `getRoot()`/`resolveInRoot()` route inputs through `pathe.resolve`. Historically this used
   `node:path`, whose `path.resolve()` yields `\` on Windows and silently broke `who_overrides` completely;
   that's why the old `.split(path.sep).join('/')` idiom existed. **Do not reintroduce `node:path` or manual
   separator normalization** — keep importing `pathe`.
2. **The resolver handles these require specifiers** (in `cartridgePath.ts` `resolve()`): `dw/…`,
   `server`, relative `./` `../`, `*/cartridge/…` (path search), `~/cartridge/…` (current cartridge),
   `app_storefront_base/cartridge/…`, `base/…`. `~/` is easy to forget — SFCC treats it as the current
   cartridge. If you add a new form, add a case here or it silently becomes an unresolved `external`
   node (and silently breaks `callers_of`/`dependencies_of` for that target).
3. **hooks.json script paths** are relative to the hooks.json location. In a *flattened* deployment a
   `../<cartridge>/cartridge/…` filesystem walk works; in this *split-root* dev workspace it doesn't,
   so `resolveScript` also resolves `<cartridge>/cartridge/…` by cartridge **name** via the resolver.
   `parseHooksFile` therefore needs the resolver passed in.
4. **Preference detection is a join, not a read-trace.** Reads go through a generated
   `getValue()->getCustomPreferenceValue(this.id)` accessor with a *non-literal* arg the parser can't
   see, so silent-null risk is keyed on the *declaration* (`definedInCustomPrefs && !definedInMeta`),
   not on a detected read. In `customPreferences.js`, a real pref has `id` **and** `type`; a group has
   `id` + `Preferences` (no `type`) — only count objects with a `type`.

## Conventions

- **TypeScript, ES modules** (`"type": "module"`); import paths end in `.js` (compiled output).
- **Use `pathe` for filesystem paths, never `node:path`** (invariant #1). zod schemas use **zod v4**.
- Match the existing style: **4-space indent, single quotes, semicolons**, JSDoc on exported functions.
- Keep generated-id formatting in `types.ts`; keep resolution logic in `resolve/`; keep query logic in
  `indexer.ts`. Parsers stay pure (source in → `Fragment` out).
- No test framework — `test/smoke.js` is a plain assert script; extend it when you add capabilities.

## Target-repo layouts it handles (relevant to resolution edge-cases)

The tool is project-agnostic — it indexes whatever repo `SFCC_GRAPH_ROOT` points at, taking the cartridge
path from that repo's `dw.json` `cartridgesPath` (or `SFCC_GRAPH_CARTRIDGE_PATH`). Two real-world shapes
the resolver must cope with, both exercised by the fixes recorded in `MEMORY.md`:

- **Split-root layouts** — overlay cartridges and the SFRA base (`app_storefront_base`) living under
  *different* top-level roots, not flattened siblings. `who_overrides`/dead-link resolution must match by
  cartridge path, not by filesystem adjacency (and normalize `\`→`/` on Windows).
- **`~/cartridge/…`-heavy code** — the "current cartridge" alias used pervasively for internal requires,
  plus base delegation via explicit `app_storefront_base/cartridge/…` requires that get re-exported (the
  "pass-through" pattern). The resolver handles `*/`, `~/`, `app_storefront_base/`, relative, and `dw/*`.
