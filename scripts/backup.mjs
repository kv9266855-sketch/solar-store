import { DatabaseSync, backup } from 'node:sqlite';
import { cp, mkdir, access } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = resolve(process.env.SOLAR_DATA_DIR || resolve(root, 'data'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = resolve(root, '_backup', `full-${stamp}`);
await access(resolve(data, 'solar.sqlite'));
await mkdir(resolve(destination, 'data'), { recursive: true });
const database = new DatabaseSync(resolve(data, 'solar.sqlite'), { readOnly: true });
try { await backup(database, resolve(destination, 'data', 'solar.sqlite')); }
finally { database.close(); }
for (const name of ['index.html', 'admin.html', 'server.mjs', 'package.json', 'README.md', 'Start-SOLAR.cmd', '.gitignore', '.env.example', '.claude', 'lib', 'scripts', 'js', 'css', 'fonts', 'images', 'docs', 'tests']) {
  await cp(resolve(root, name), resolve(destination, name), { recursive: true });
}
for (const name of ['uploads']) {
  try { await cp(resolve(data, name), resolve(destination, 'data', name), { recursive: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
console.log(`Complete backup saved: ${relative(root, destination)}`);
console.log('Includes database, accounts, orders, content, media and application files.');
