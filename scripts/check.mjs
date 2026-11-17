import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let count = 0;
async function check(directory) {
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const relative = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory() && ['js', 'lib', 'scripts', 'tests'].includes(relative)) await check(relative);
    else if (entry.isFile() && /\.(mjs|js)$/.test(entry.name)) {
      execFileSync(process.execPath, ['--check', resolve(root, relative)], { stdio: 'pipe' });
      count++;
    }
  }
}
await check('');
for (const name of ['index.html', 'admin.html']) {
  const html = await readFile(resolve(root, name), 'utf8');
  for (const [, source] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (source.trim()) new Function(source);
  }
  for (const [, asset] of html.matchAll(/(?:src|href)="((?:js|css|fonts)\/[^"?#]+)"/gi)) await readFile(resolve(root, asset));
}
console.log(`Syntax and local assets OK (${count} scripts, 2 pages).`);
