# Changelog

All notable changes to `graphify-sfcc` will be documented in this file.

## [0.1.1] - 2026-08-18

### ⚡ Performance & Visualization Optimizations
- **Adaptive Physics Solver:** Dynamically uses `forceAtlas2Based` physics solver for graphs >350 nodes, capping layout stabilization to <1s.
- **Straight Line Edge Acceleration:** Switches edge rendering to straight lines (`smooth: false`) for large graphs (>350 nodes), reducing canvas drawing overhead by up to 10x.
- **Zero Physics Jiggle:** Disabled continuous physics simulations and node wobbling after layout stabilization; node dragging is rock-solid.
- **Smart Anti-Overlap Labeling:** Hides minor node labels by default to prevent visual clutter while displaying labels for key high-degree hub nodes. High-contrast text strokes (`strokeColor: '#0d1117'`) added.
- **Interactive Hover Neighborhood Highlighting:** Hovering or clicking a node highlights connected 1-hop neighbor nodes and edges while dimming unrelated nodes (`opacity: 0.12`).
- **Enhanced Toolbar Controls:** Added `Labels: Smart / All / None`, `Reset Focus`, `Fit View`, and `Physics: Off/On` controls.

### 🛠️ CLI & User Experience
- **Interactive Terminal Guidance:** Running `graphify-sfcc` or `sfcc-graph` without arguments in an interactive terminal TTY now automatically builds/refreshes the index, displays graph statistics, and prints CLI command guidance instead of hanging on stdio.
- **AI Stdio Pipe Support:** Retains automatic stdio MCP server mode when spawned non-interactively by AI assistants (Claude Desktop, Cursor, Gemini, Claude Code).
- **Standalone Integration Smoke Test Guard:** Updated `test/smoke.js` to gracefully skip assertions when no target SFCC storefront repository is present at `SFCC_GRAPH_ROOT`.

### 🛡️ Security, CI & Quality
- **SonarQube Rule S6505:** Added `--ignore-scripts` to `npm ci` in GitHub Actions workflows (`build.yml`, `release.yml`) to prevent lifecycle script execution.
- **Dependency Locking:** Locked `typescript` version to `~5.9.3` to maintain full compatibility with `@typescript-eslint/typescript-estree` peer dependency requirements.
- **Complete Rebranding & Sanitization:** Verified zero synthetic IDs, telemetry trackers, or proprietary merchant/payment gateway domain strings exist across the entire project.

---

## [0.1.0] - 2026-08-18

### Initial Release
- Initial open-source release of `graphify-sfcc` MCP server and CLI tool.
