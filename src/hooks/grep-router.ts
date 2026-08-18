#!/usr/bin/env node
/*
 * sfcc-graph grep-router — PreToolUse hook (OBSERVE MODE).
 *
 * Reads the Claude Code hook payload on stdin. When a Grep pattern (or a Bash grep/rg/findstr search
 * command) looks like an SFCC "how is this wired" question a sfcc-graph tool answers exactly and
 * cheaply, it injects a NON-BLOCKING reminder pointing at the right tool. It NEVER denies and NEVER
 * throws — any error exits 0 silently, so it can't break tooling.
 *
 * Compiled to dist/hooks/grep-router.js; wire it via .claude/settings.json (see README).
 * To escalate observe -> enforce: swap the emitted hookSpecificOutput for
 * { permissionDecision: 'deny', permissionDecisionReason: msg } on the confident rules.
 */

interface Rule {
    re: RegExp;
    tools: string;
    why: string;
}

// pattern -> which sfcc-graph tool(s) answer it. Order matters (first match wins per rule).
const RULES: Rule[] = [
    { re: /module\.superModule|require\s*\(/i, tools: 'resolve_module / who_overrides / callers_of / dependencies_of', why: 'cartridge-path resolution, overrides, and blast radius' },
    { re: /server\.(get|post|use|append|prepend|replace|extend)\b/i, tools: 'route_info / who_overrides', why: 'route wiring / overlay' },
    { re: /getCustomPreferenceValue|customPreferences/i, tools: 'pref_usage / unresolved', why: 'site-preference reads vs metadata (silent-null)' },
    { re: /<isinclude|URLUtils\.(url|https)/i, tools: 'template_graph / route_info', why: 'ISML includes / remote includes / route links' },
    { re: /hooks\.json|calculateTax|"\s*hooks"\s*:/i, tools: 'hook_handler', why: 'hooks.json hook -> script mapping' },
    { re: /session\.(privacy|custom)/i, tools: 'global_usages / uses_global', why: 'ambient-global usage (session.privacy vs custom)' }
];

// Bash commands only qualify if they are actually a code search.
const SEARCH_CMD = /(^|[\s|&;])(grep|egrep|fgrep|rg|ripgrep|ag|findstr|git\s+grep)\b|Select-String/i;

interface HookPayload {
    tool_name?: string;
    tool_input?: { pattern?: string; command?: string };
}

/** Read all of stdin, resolving after end or a short timeout so the hook never hangs. */
function readStdin(): Promise<string> {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk: string) => {
            data += chunk;
        });
        process.stdin.on('end', () => resolve(data));
        setTimeout(() => resolve(data), 1500);
    });
}

/** Inspect the tool payload; print an observe-mode reminder when a wiring pattern is detected. */
function main(raw: string): void {
    let payload: HookPayload;
    try {
        payload = JSON.parse(raw || '{}') as HookPayload;
    } catch {
        return;
    }
    const tool = payload.tool_name || '';
    const input = payload.tool_input || {};

    let text = '';
    if (tool === 'Grep') {
        text = String(input.pattern || '');
    } else if (tool === 'Bash') {
        const cmd = String(input.command || '');
        if (!SEARCH_CMD.test(cmd)) return; // not a search — ignore
        text = cmd;
    } else {
        return;
    }
    if (!text) return;

    // Grep patterns are often regex-escaped (require\(, server\.get, <isinclude); strip backslashes
    // so the literal signal matchers still fire on the escaped forms.
    const norm = text.replaceAll('\\', '');
    const hits = RULES.filter((r) => r.re.test(norm));
    if (!hits.length) return;

    const lines = hits.map((h) => '  - mcp__graphify-sfcc__' + h.tools.replaceAll(' / ', ' / mcp__graphify-sfcc__') + '  → ' + h.why);
    const msg =
        'graphify-sfcc hint (observe mode): this search looks like an SFCC wiring question the code graph ' +
        'answers exactly in ~1 call, instead of a grep→read cycle that pulls whole files into context. ' +
        'Consider (after build_index):\n' + lines.join('\n') +
        '\nIf this is a plain content/string search (not a wiring question), ignore this and proceed with grep.';


    process.stdout.write(
        JSON.stringify({
            hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                additionalContext: msg
            },
            suppressOutput: true
        })
    );
}

try {
    const raw = await readStdin();
    main(raw);
} catch {
    /* fail open */
}

