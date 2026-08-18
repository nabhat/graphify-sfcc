// Form analyzer: turns a cartridge form definition (forms/<locale>/<name>.xml) into a form node,
// keyed by the name server.forms.getForm('<name>') uses. Field ids are collected via fast-xml-parser.

import path from 'pathe';
import { XMLParser } from 'fast-xml-parser';
import { Fragment, id, emptyFragment } from '../types.js';
import { relPath } from '../resolve/repo.js';

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/** Recursively collect every `formid` attribute (form field ids). */
function collectFieldIds(node: unknown, out: Set<string>): void {
    if (Array.isArray(node)) {
        for (const item of node) collectFieldIds(item, out);
        return;
    }
    if (node && typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        for (const key of Object.keys(obj)) {
            if (key === '@_formid') out.add(String(obj[key]));
            else if (!key.startsWith('@_')) collectFieldIds(obj[key], out);
        }
    }
}

/** The name server.forms.getForm() uses: the path under forms/<locale>/ without the .xml extension. */
function formName(rel: string): string {
    const m = /\/forms\/[^/]+\/(.+)\.xml$/.exec(rel);
    return m ? m[1] : path.basename(rel).replace(/\.xml$/, '');
}


/** Analyze a form definition XML. Emits a form node keyed by its getForm() name. */
export function parseFormFile(abs: string, source: string): Fragment {
    const frag = emptyFragment();
    const rel = relPath(abs);
    const name = formName(rel);
    const fields = new Set<string>();
    try {
        collectFieldIds(xml.parse(source), fields);
    } catch {
        /* unparseable form — still record the node */
    }
    frag.nodes.push({ id: id.form(name), kind: 'form', label: name, attrs: { file: rel, fields: [...fields] } });
    return frag;
}
