// The Claude Code skill written by `sfcc-graph install`. Single source of truth for the SKILL.md.

export const SKILL_NAME = 'graphify-sfcc';

export const SKILL_MD = `---
name: graphify-sfcc
description: >-
  Answer SFCC/Demandware "how is this wired" questions with the graphify-sfcc MCP tools instead of
  guessing with grep. Use whenever the question is about cartridge-path resolution (which copy of a
  file WINS, what OVERRIDES/extends a controller), what require()s or calls a module (blast radius),
  which script a hooks.json hook maps to, what an ISML template includes or which route it links to,
  where a site preference is read vs defined in metadata (silent-null risk), which files touch a dw
  ambient global (session/request/customer/pdict) or a platform API (dw/*). Run build_index first.
---

# graphify-sfcc — Demandware code graph

This repo ships an MCP server (\`graphify-sfcc\`) that models the SFCC resolution semantics plain grep and

symbol search miss. Prefer it over grep for any "how is X wired / what resolves to what / what depends
on what" question in the cartridges.

## Always run build_index first

The graph is cached on disk and does **not** auto-refresh. Call \`build_index\` once at the start of a
session, and again after you edit cartridge JS/ISML/hooks/metadata.

## When to use which tool

- **"Which file actually runs / what does my overlay shadow?"** → \`who_overrides <file>\` (cartridge-path winner + shadowed copies), or \`resolve_module <specifier> <fromFile>\` for a specific require.
- **"What depends on this / is it safe to edit?"** → \`callers_of <file>\` (requires, hooks, links in) and \`dependencies_of <file>\` (what it requires out). These are **file-level** (require edges) — use them for module blast-radius, not to find one function.
- **"Where is this *function* called / what does a module define?"** → \`symbol_usages <name | relPath#name>\` (every call site as \`file:line\`, disambiguated per cartridge) and \`defines_symbols <file>\` (a module's top-level functions + their def lines). These are **function-level**: prefer them when the question is about a specific function, then read only the exact lines instead of the whole file. Hook-dispatched calls (\`HookMgr.callHook\` / SFRA \`hooksHelper\`, incl. dynamic name prefixes) **are** resolved through \`hooks.json\` to \`script#fn\` (tagged \`via: hook-dispatch\`). Only \`dw/*\` platform calls aren't tracked — use \`explain external:dw/...\` for those.
- **"Who handles this hook?"** → \`hook_handler <hook-name>\` (e.g. dw.order.calculateTax).

- **"What produces or references this route?"** → \`route_info <Controller-Action>\`. Note: server.extend is not per-action — use who_overrides on the controller file.
- **"What does this template pull in?"** → \`template_graph <template>\` (local + remote includes, route links, includers).
- **"What ISML does this controller render / who renders this template?"** → \`explain <controller>\` (rendersTemplate out-edges) or \`callers_of <template>\`.
- **"Where is a form used / what fields does it have?"** → \`explain <formName>\` (usesForm in-edges + field ids from the form definition).
- **"Is this preference actually wired?"** → \`pref_usage <PrefId>\` — flags silentNullRisk (read in code, missing from metadata) and orphan (defined, never read). Or \`unresolved\` for a repo-wide sweep of dead links + pref mismatches.
- **"Where is session/request/customer/pdict used?"** → \`uses_global <file>\` / \`global_usages <name>\`.
- **"Show me a node and its links."** → \`explain <node>\` — inbound/outbound edges, each with a source line and an EXTRACTED (parsed) or INFERRED (structural) confidence tag.
- **"How does A connect to B?"** → \`shortest_path <from> <to>\`.
- **"Find nodes."** → \`search_nodes <query> [kind]\`.

## Token discipline — query first, read narrow

The point of the graph is to **read less**. For any "where does this go / come from" question, resolve it to \`file:line\` with a query first, then do a ranged read of just those lines — do **not** read whole files to hunt for a function.

- Function target → \`symbol_usages\` / \`defines_symbols\` → \`Read\` with an offset/limit around the returned line.
- Module blast-radius → \`callers_of\` / \`dependencies_of\` (file-level is correct here; don't force it to functions).
- Reach for \`callers_of\`/\`dependencies_of\` only when you genuinely mean the whole module; use \`symbol_usages\` when you mean one function — reading every caller file to locate a single function wastes the tokens the graph exists to save.

## Notes

- Platform APIs (\`dw/*\`) and framework (\`server\`, \`base/*\`) are modeled as **external** nodes, not files — they live in the platform at runtime. \`explain external:dw/order/OrderMgr\` lists every file that uses that API.
- The cartridge path comes from \`dw.json\` (\`cartridgesPath\`); \`stats\` shows the resolved path and its source.
`;
