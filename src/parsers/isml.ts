// ISML analyzer: tag structure via htmlparser2, embedded expressions (${...} / <isscript>) via the
// AST expression analyzer. No regex parsing of the ISML itself.

import { Parser } from 'htmlparser2';
import { CartridgeResolver } from '../resolve/cartridgePath.js';
import { Fragment, GNode, id, emptyFragment, classifyExternal } from '../types.js';
import { relPath } from '../resolve/repo.js';
import { analyzeExpressions, extractDollarExpressions } from './expr.js';

/** Analyze an ISML template. Emits includesTemplate / remoteIncludes / linksToRoute / requires / usesGlobal. */
export function parseIsmlFile(abs: string, source: string, resolver: CartridgeResolver): Fragment {
    const frag = emptyFragment();
    const rel = relPath(abs);
    const templateId = id.template(rel);
    const owner = resolver.ownerCartridge(abs);

    const globals: Record<string, string[]> = {};
    const templateNode: GNode = {
        id: templateId,
        kind: 'template',
        label: rel,
        attrs: { cartridge: owner, globals }
    };
    frag.nodes.push(templateNode);

    const remoteSnippets: string[] = []; // ${...} inside <isinclude url=...>
    const exprSnippets: string[] = []; // every other ${...} and <isscript> body
    const seenInclude = new Set<string>();
    let inIsscript = false;

    const parser = new Parser({
        onopentag(name, attribs) {
            if (name === 'isscript') inIsscript = true;
            for (const attr of Object.keys(attribs)) {
                const exprs = extractDollarExpressions(attribs[attr]);
                if (name === 'isinclude' && attr === 'url') remoteSnippets.push(...exprs);
                else exprSnippets.push(...exprs);
            }
            if (name === 'isinclude' && attribs.template) {
                const r = resolver.resolveTemplate(attribs.template);
                if (r.kind === 'module' && r.abs) {
                    const targetId = id.template(relPath(r.abs));
                    const key = 'inc:' + targetId;
                    if (!seenInclude.has(key)) {
                        seenInclude.add(key);
                        frag.edges.push({
                            source: templateId,
                            target: targetId,
                            kind: 'includesTemplate',
                            attrs: { winner: r.winnerCartridge, shadows: r.shadows.map(relPath) }
                        });
                    }
                }
            }
        },
        ontext(text) {
            if (inIsscript) exprSnippets.push(text);
            else exprSnippets.push(...extractDollarExpressions(text));
        },
        onclosetag(name) {
            if (name === 'isscript') inIsscript = false;
        }
    });
    parser.write(source);
    parser.end();

    const remote = analyzeExpressions(remoteSnippets);
    const other = analyzeExpressions(exprSnippets);
    const remoteRoutes = new Set(remote.routeLinks);

    for (const ca of remote.routeLinks) {
        frag.nodes.push({ id: id.route(ca), kind: 'route', label: ca, attrs: {} });
        frag.edges.push({ source: templateId, target: id.route(ca), kind: 'remoteIncludes', attrs: {} });
    }
    for (const ca of other.routeLinks) {
        if (remoteRoutes.has(ca)) continue;
        frag.nodes.push({ id: id.route(ca), kind: 'route', label: ca, attrs: {} });
        frag.edges.push({ source: templateId, target: id.route(ca), kind: 'linksToRoute', attrs: {} });
    }
    for (const spec of other.requires) {
        const r = resolver.resolve(spec, abs);
        if (r.kind === 'module' && r.abs) {
            frag.edges.push({
                source: templateId,
                target: id.module(relPath(r.abs)),
                kind: 'requires',
                attrs: { specifier: spec, winner: r.winnerCartridge }
            });
        } else {
            const extId = id.external(spec);
            frag.nodes.push({ id: extId, kind: 'external', label: spec, attrs: { origin: classifyExternal(spec) } });
            frag.edges.push({ source: templateId, target: extId, kind: 'requires', attrs: { specifier: spec } });
        }
    }
    for (const g of Object.keys(other.globals)) {
        globals[g] = other.globals[g];
        const gid = id.global(g);
        frag.nodes.push({ id: gid, kind: 'global', label: g, attrs: {} });
        frag.edges.push({ source: templateId, target: gid, kind: 'usesGlobal', attrs: { members: other.globals[g] } });
    }

    return frag;
}
