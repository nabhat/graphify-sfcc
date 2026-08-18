# MIGRATION.md — modularizing sfcc-graph

> **STATUS: single package (Stage 0), 2026-07-22.** The Stage-1 npm-workspaces split was executed and then
> **reverted by preference** to a single `sfcc-graph-mcp` package with folders under `src/` (simpler to
> manage for a solo maintainer). The engine is still externally consumable — `src/index.ts` is the package
> `main`/`exports`, so other projects `import { Index, CartridgeResolver } from 'sfcc-graph-mcp'` via
> `npm link` / `file:` / publish (the "Reusable pieces" + "npm link" sections below still apply, as one
> package rather than several). Re-run Stage 1 only if independently-publishable sub-packages are ever needed.

## Context & goal

`sfcc-graph` has grown three distinct concerns — the **graph engine** (resolution + parsing + graph +
queries), the **MCP server** (tool surface), and **frontends/assets** (CLI, HTML visualizer, skill
installer, the grep-router hook). The goal of this plan is to make those parts **independently
consumable** — so someone can build on the engine alone (a web UI, a CI lint, a different agent
integration) without pulling in the MCP SDK or CLI — and to keep the project easy to manage as it
grows. This document is the target design + step-by-step; **no code has been changed.**

## Why it's feasible (current structure is already split-ready)

The internal import graph is **strictly acyclic and cleanly layered** (verified 2026-07-22). No parser
imports the server or CLI; the server imports only the indexer. The seams a split would follow already
exist:

```
Layer 0 (leaves):  types.ts · resolve/repo.ts · parsers/expr.ts · skill.ts
Layer 1:           resolve/cartridgePath.ts →repo · graph/graph.ts →types
Layer 2:           parsers/{js,isml,hooks,metadata,forms}.ts →types, resolve, expr
Layer 3 (ENGINE):  graph/indexer.ts →resolve, types, parsers, graph
Layer 4:           server.ts →indexer · visualize.ts →graph,repo · install.ts →repo,skill
Layer 5:           cli.ts →indexer, server, install, visualize
```

ESM with `.js`-suffixed relative imports is already in place, which is what TS project references +
Node workspaces expect. So the split is **mechanical, not surgical**.

## Target package boundaries

| Package | Source moved in | Depends on | 3rd-party deps |
|---|---|---|---|
| **`@sfcc-graph/core`** | `types.ts`, `resolve/`, `parsers/`, `graph/` (graph + indexer) | — | `@typescript-eslint/typescript-estree`, `fast-glob`, `fast-xml-parser`, `graphology`, `graphology-shortest-path`, `graphology-traversal`, `htmlparser2` |
| **`@sfcc-graph/mcp`** | `server.ts` | core | `@modelcontextprotocol/sdk`, `zod` |
| **`@sfcc-graph/cli`** | `cli.ts`, `install.ts`, `skill.ts` | core, mcp, viz | `commander` |
| **`@sfcc-graph/viz`** | `visualize.ts` | core | (none) |
| **`@sfcc-graph/hook`** (optional) | `src/hooks/grep-router.ts` (→ `dist/hooks/grep-router.js`) | — | (none) |

`core` is the reusable unit; everything else is a consumer.

## `core` public API to freeze (the contract others build on)

Expose via a `packages/core/src/index.ts` barrel:
- `Index` (`.build()`, `.load()`, `.stats()`, and every query: `resolveModule`, `whoOverrides`,
  `dependenciesOf`, `callersOf`, `routeInfo`, `hookHandler`, `templateGraph`, `prefUsage`,
  `usesGlobalByFile`, `globalUsages`, `unresolved`, `searchNodes`, `explain`, `shortestPath`,
  `definesSymbols`, `symbolUsages`).
- Types: `NodeKind`, `EdgeKind`, `GNode`, `GEdge`, `Fragment`, `id`, `classifyExternal`.
- `CartridgeResolver`, and `buildGraph` / `importGraph` / `exportGraph`.
- repo helpers used by frontends: `getRoot`, `relPath`, `resolveInRoot`, `discoverCartridges`.

Freeze these names first — everything else is internal.

## Recommended staged path

Do the smallest stage that meets the need. Stage 1 is only worth it once there is a real second
consumer of `core` or a publishing requirement.

### Stage 0 — Core API barrel (cheap, reversible, unlocks "build on top" + `npm link`)
1. Add `src/index.ts` exporting the frozen `core` surface above.
2. (Optional) regroup folders for clarity without splitting packages:
   `src/core/` (types, resolve, parsers, graph) and `src/frontends/` (server, cli, visualize, skill,
   install). Update relative imports accordingly.
3. Make the package importable as a library — add to `package.json` (today it only has `bin`):
   ```jsonc
   "main": "dist/index.js",
   "types": "dist/index.d.ts",
   "exports": { ".": "./dist/index.js", "./package.json": "./package.json" }
   ```
   Also set `"declaration": true` in tsconfig so `dist/index.d.ts` is emitted for consumers.
4. Document the engine API in README ("Programmatic use").
   Still one `package.json`, one `tsc` build. **This alone makes the whole tool `npm link`-consumable as
   a regular package** (see below) — no monorepo needed. It is also the prerequisite seam for Stage 1.

### Stage 1 — npm workspaces (core / mcp / cli), only if independent build/publish is needed
1. Create workspace root: `package.json` with `"workspaces": ["packages/*"]`, `"private": true`.
2. Move sources into `packages/{core,mcp,cli,viz}/src/...` preserving the layer mapping in the table.
3. Per package: `package.json` (name, `type: module`, `main`/`exports` → `dist/index.js`, `bin` only
   for cli) + `tsconfig.json` with `"composite": true`, `outDir: dist`, and `references` to upstream
   packages (`mcp`→core; `cli`→core,mcp,viz; `viz`→core).
4. Root `tsconfig.json` with `references` to all packages; build with `tsc -b`.
5. Rewrite boundary imports: `../graph/indexer.js` → `@sfcc-graph/core`, etc. (intra-package imports
   stay relative.)
6. Root scripts: `build` = `tsc -b`, `smoke` = run core's smoke, `start` = run cli serve.

### Stage 2 — optional: split `viz`, `skill`, and the `hook` asset into their own packages.

## Project-specific gotchas to handle during the split

- **`.mcp.json`** runs `node ${CLAUDE_PROJECT_DIR}/sfcc-graph/dist/cli.js serve`. If the CLI moves to
  `packages/cli/dist/cli.js`, update this path (and the README run instructions).
- **Cache path**: ~~module-relative depth assumption~~ **FIXED 2026-07-22** — `core/repo.ts` `cacheDir()`
  now returns `<getRoot()>/.sfcc-graph-cache` (env-overridable via `SFCC_GRAPH_CACHE`), computed lazily.
  The cache is a parse of the TARGET repo, so it lives under that repo's root — one cache per project, no
  collision when the tool is run against multiple SFCC projects. Gitignore `.sfcc-graph-cache/` in target repos.
- **grep-router hook path**: `.claude/settings.json` references
  `$CLAUDE_PROJECT_DIR/sfcc-graph/dist/hooks/grep-router.js` (source: `src/hooks/grep-router.ts`). If the
  hook moves to a package, update the hook command and the README setup snippet.
- **Skill install** (`install.ts` writes `.claude/skills/sfcc-graph/SKILL.md`) and **visualize output**
  (writes to repo root): both use `getRoot()`, so they keep working — just confirm after the move.
- **`test/smoke.js`** imports `../dist/graph/indexer.js`; repoint to `@sfcc-graph/core` (or the core
  package's dist) and keep it as the cross-package regression gate.
- **Publishing**: if these go to a registry, scope names (`@your-scope/…`) and set `files`/`exports`
  per package; otherwise keep `"private": true` and consume via workspace protocol.

## Verification after a migration (whichever stage)
1. `npm install` at the workspace root (hoists deps / links packages).
2. `npm run build` (`tsc -b` for Stage 1) — clean compile, no unresolved cross-package imports.
3. `npm run smoke` — the existing assertions must still pass (they exercise the full engine incl. the
   symbol layer).
4. If the MCP entry moved: update `.mcp.json`, then **restart the MCP server** (`/mcp` reconnect) and
   run `build_index` — confirm `stats` matches pre-migration counts.
5. Confirm `.cache` lands where expected and the grep-router hook still fires.

## Reusable pieces & how to consume them from other projects

What is genuinely worth exposing for "build anything else on top" (ranked by breadth of reuse):

1. **`CartridgeResolver`** (`resolve/cartridgePath.ts`) — the most broadly reusable single unit: SFCC
   cartridge-path resolution (`*/`, `~/`, `app_storefront_base/`, relative, superModule, dw.json
   hierarchy). Any SFCC tooling — linters, bundlers, doc generators, IDE plugins — needs this.
2. **`Index` engine + queries** — build and query a graph over *any* SFCC repo (the full 18-method API).
3. **repo utilities** (`resolve/repo.ts`) — `discoverCartridges`, `dwJsonCartridgePath`, `glob`,
   `getRoot`, `relPath`: generic SFCC repo helpers.
4. **Parsers** (`parsers/*`) — extract SFCC facts (requires, routes, hooks, prefs, globals, symbols)
   from source without needing the graph.
5. **types + `id` helpers** (`types.ts`) — the node/edge model, for anyone extending the graph.
6. **grep-router** (`src/hooks/grep-router.ts`) — standalone, zero-dep Claude Code hook asset.
7. **visualize** (`visualize.ts`) — graph → standalone HTML renderer.

### Making them accessible from outside

Expose named subpaths in `package.json` `exports` so consumers import exactly what they need (and TS
gets types), without pulling the whole engine:
```jsonc
"exports": {
  ".":         "./dist/index.js",              // the core barrel (Index, types, resolver, buildGraph)
  "./resolver":"./dist/resolve/cartridgePath.js",
  "./parsers": "./dist/parsers/index.js",
  "./repo":    "./dist/resolve/repo.js"
}
```
Add a `"files": ["dist"]` field so the built output ships in any tarball.

### Four consumption modes (pick per need)

| Mode | Command | Use when |
|---|---|---|
| **npm link** | `npm link` here, then `npm link sfcc-graph-mcp` in the consumer | active local dev across your own repos; symlinked, reflects a rebuild immediately |
| **file: dependency** | consumer: `"sfcc-graph-mcp": "file:../sfcc-graph"` | stable local dependency, no global symlink |
| **npm pack / tarball** | `npm pack` → install the `.tgz` | pinned snapshot, CI, air-gapped |
| **publish to a registry** | scope the name (`@your-scope/…`), `npm publish` (npm or GitHub Packages) | sharing with others / other teams |

Requirements for any external consumer: the package must be **built** (`dist/` present — it's gitignored,
so `npm run build` first), keep `"type": "module"` (consumers use ESM or interop), and ship `types` for
TS. Note the current `"private": true` — `npm link` / `file:` / `pack` all work with it, but **publishing
requires removing/adjusting it**.

### Recommendation for this goal
- **Reuse across your own projects** → Stage 0 barrel + `exports`, then `npm link` (or `file:`). No split
  needed; smallest change that makes the functions importable elsewhere.
- **Share externally with others** → do the Stage 1 split first and publish a scoped **`@sfcc-graph/core`**
  so consumers get the engine without the MCP SDK, CLI, or zod as transitive deps.

## Decision guidance
- **Default to Stage 0.** It delivers the "others can build on the engine" benefit at near-zero cost and
  keeps management simple (fewer files, one build) — consistent with "abstractions/layers must earn
  their existence."
- **Escalate to Stage 1** only when a concrete second consumer of `core` exists, or you need to publish
  parts independently. A multi-package monorepo adds real, ongoing tooling overhead; don't pay it
  speculatively.
