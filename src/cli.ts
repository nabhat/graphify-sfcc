#!/usr/bin/env node
// sfcc-graph CLI entry (commander): serve / build / install, with --version / --help built in.

import fs from 'node:fs';
import { Command } from 'commander';
import { Index } from './graph/indexer.js';
import { startServer } from './server.js';
import { installSkill } from './install.js';
import { visualize } from './visualize.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const program = new Command();

program
    .name('graphify-sfcc')
    .description('Demandware-aware code-graph MCP server & CLI')
    .version(pkg.version, '-v, --version', 'print version');


program
    .command('serve', { isDefault: true })
    .description('start the MCP server over stdio (default)')
    .action(async () => {
        await startServer();
    });

program
    .command('build')
    .description('build/refresh the graph and print stats')
    .option('--force', 'rebuild from disk (build always rebuilds)')
    .action(() => {
        console.log(JSON.stringify(Index.build().stats(), null, 2));
    });

program
    .command('visualize')
    .description('generate a standalone HTML graph visualisation and open it in the browser')
    .option('--output <file>', 'path for the HTML output (default: sfcc-graph-viz[-pruned].html in the repo root)')
    .option('--pruned', 'strip external nodes, requires edges, definesPref edges, and isolated nodes')
    .option('--no-open', 'write the file but do not open the browser')
    .action((opts: { output?: string; pruned?: boolean; open: boolean }) => {
        const outPath = visualize({ output: opts.output, open: opts.open !== false, pruned: !!opts.pruned });
        console.log('Wrote: ' + outPath);
    });

program
    .command('install')
    .description('write the Claude skill (.claude/skills/sfcc-graph/SKILL.md)')
    .option('--user', 'install to the user home (~/.claude)')
    .option('--project', 'install to the project (default)')
    .action((opts: { user?: boolean }) => {
        const scope = opts.user ? 'user' : 'project';
        console.log(`Wrote skill (${scope}): ${installSkill(scope)}`);
    });

program.addHelpText(
    'after',
    '\nEnvironment:\n' +
        '  SFCC_GRAPH_ROOT             Repo root (default: CLAUDE_PROJECT_DIR, else cwd)\n' +
        '  SFCC_GRAPH_CARTRIDGE_PATH   Override cartridge path (default: dw.json cartridgesPath)'
);

try {
    await program.parseAsync(process.argv);
} catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
}

