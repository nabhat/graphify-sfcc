import fs from 'node:fs';
import path from 'node:path';

const lcovPath = 'coverage/lcov.info';
if (!fs.existsSync(lcovPath)) process.exit(0);

let lcov = fs.readFileSync(lcovPath, 'utf8');

lcov = lcov.split('\n').map((line) => {
    if (!line.startsWith('SF:')) return line;
    let filePath = line.substring(3).trim().replace(/\\/g, '/');
    filePath = filePath.replace(/(^|\/)dist\//, '$1src/');
    if (filePath.endsWith('.js')) {
        const tsPath = filePath.slice(0, -3) + '.ts';
        if (fs.existsSync(tsPath)) {
            filePath = tsPath;
        }
    }
    return 'SF:' + path.resolve(filePath);
}).join('\n');

fs.writeFileSync(lcovPath, lcov);
console.log('Successfully mapped lcov.info paths from dist/*.js to src/*.ts.');
