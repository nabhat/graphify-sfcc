// Writes the Claude skill file, graphify-style: project scope under the repo's .claude/skills,
// or user scope under ~/.claude/skills.

import fs from 'node:fs';
import path from 'pathe';
import os from 'node:os';
import { getRoot } from './resolve/repo.js';
import { SKILL_NAME, SKILL_MD } from './skill.js';

/** Write .claude/skills/sfcc-graph/SKILL.md at the given scope; returns the file path. */
export function installSkill(scope: 'project' | 'user'): string {
    const base = scope === 'user' ? os.homedir() : getRoot();
    const dir = path.join(base, '.claude', 'skills', SKILL_NAME);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'SKILL.md');
    fs.writeFileSync(file, SKILL_MD);
    return file;
}
