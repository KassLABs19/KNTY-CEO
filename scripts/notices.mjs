// Regenerates THIRD_PARTY_NOTICES.md from the installed packages that ship in the
// server image or the Windows app. Run after changing dependencies:
//   node scripts/notices.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
// What ships: the server's runtime packages, and what the desktop app bundles or runs on.
const roots = [
  ['@ceo/server', []],
  ['@ceo/desktop', []],
];
const extraDesktop = ['react', 'react-dom', 'qrcode', 'electron', 'zod'];

const found = new Map();
function walk(node) {
  for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
    if (name.startsWith('@ceo/')) {
      walk(dep);
      continue;
    }
    if (!dep.version) continue; // optional package that is not installed
    const key = `${name}@${dep.version}`;
    if (found.has(key)) continue;
    found.set(key, { name, version: dep.version });
    walk(dep);
  }
}
for (const [ws] of roots) {
  const json = JSON.parse(execFileSync('npm', ['ls', '--all', '--omit=dev', '--json', '-w', ws], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }));
  walk(json);
}
const extra = JSON.parse(execFileSync('npm', ['ls', '--all', '--json', '-w', '@ceo/desktop', ...extraDesktop], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }));
walk(extra);

function pkgDir(name, version) {
  const candidates = [join(root, 'node_modules', name)];
  for (const ws of ['apps/server', 'apps/desktop', 'packages/shared']) candidates.push(join(root, ws, 'node_modules', name));
  for (const c of candidates) {
    try {
      if (JSON.parse(readFileSync(join(c, 'package.json'), 'utf8')).version === version) return c;
    } catch {}
  }
  // Nested copies: search one level of node_modules/*/node_modules.
  const nm = join(root, 'node_modules');
  for (const d of readdirSync(nm)) {
    const dirs = d.startsWith('@') ? readdirSync(join(nm, d)).map((x) => join(nm, d, x)) : [join(nm, d)];
    for (const dir of dirs) {
      const c = join(dir, 'node_modules', name);
      try {
        if (JSON.parse(readFileSync(join(c, 'package.json'), 'utf8')).version === version) return c;
      } catch {}
    }
  }
  return null;
}

const MIT = `MIT License

Copyright (c) <holder>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

(The package states the MIT licence in its package.json but ships no licence file; this is the standard MIT text.)`;

const entries = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
const out = [
  '# Third-party notices',
  '',
  'KNTY CEO includes the open-source packages below. Each is used under its own licence,',
  'reproduced here. This file is regenerated with `node scripts/notices.mjs`.',
  '',
  'The Windows app is built on Electron, which also installs `LICENSES.chromium.html` next to',
  'the app with the notices for Chromium and the libraries it contains.',
  '',
  '| Package | Version | Licence |',
  '|---|---|---|',
];
const texts = [];
for (const e of entries) {
  const dir = pkgDir(e.name, e.version);
  let license = 'See package';
  let text = '';
  if (dir) {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type).join(' OR ') : 'See package');
    const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\.|$)/i.test(f));
    if (file && existsSync(join(dir, file))) text = readFileSync(join(dir, file), 'utf8').trim();
    if (license === 'See package' && /Permission is hereby granted, free of charge/.test(text)) license = 'MIT';
    if (!text && license === 'MIT') {
      const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name ?? 'the package authors';
      text = MIT.replace('<holder>', author);
    }
  }
  out.push(`| ${e.name} | ${e.version} | ${license} |`);
  texts.push(`## ${e.name} ${e.version}\n\nLicence: ${license}\n\n${text ? '```text\n' + text.replace(/```/g, "'''") + '\n```' : 'No licence file is included in the package; see its package.json and repository.'}\n`);
}
out.push('', '---', '', ...texts);
writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), out.join('\n'));
console.log(`Wrote THIRD_PARTY_NOTICES.md with ${entries.length} packages.`);
