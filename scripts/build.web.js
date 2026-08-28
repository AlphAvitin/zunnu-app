const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const wwwDir = path.join(root, 'www');
const disallowed = ['.jsx', '.tsx', '.ts', '.mts', '.cts', '.vue', '.svelte', '.scss', '.less', '.coffee', '.es6'];
const all = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else all.push(p);
  }
})(wwwDir);

const raw = all.filter(p => disallowed.some(ext => p.toLowerCase().endsWith(ext)));
if (raw.length) {
  console.error('BUILD FAIL: raw source files found in www/ (build/sync sequence quebrada):');
  raw.forEach(p => console.error('  ' + path.relative(wwwDir, p)));
  process.exit(1);
}

const indexHtml = path.join(wwwDir, 'index.html');
const html = fs.readFileSync(indexHtml, 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('BUILD FAIL: sem bloco <script> em www/index.html'); process.exit(1); }
try { new vm.Script(m[1]); }
catch (e) { console.error('BUILD FAIL: erro de sintaxe JS em www/index.html:\n  ' + e.message); process.exit(1); }

let commit = 'n/a';
const git = fs.existsSync('C:/Program Files/Git/bin/git.exe') ? 'C:/Program Files/Git/bin/git.exe' : 'git';
try { commit = execSync('"' + git + '" rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim(); } catch (e) {}
const manifest = {
  builtAt: new Date().toISOString(),
  builtBy: 'scripts/build.web.js',
  gitCommit: commit,
  files: all.map(p => path.relative(wwwDir, p).split('\\').join('/'))
};
const out = path.join(wwwDir, 'capacitor.build.json');
fs.writeFileSync(out, JSON.stringify(manifest, null, 2));

const rawCount = all.filter(p => /\.(jsx|tsx|ts|vue|svelte|scss|less)$/i.test(p)).length;
console.log('BUILD OK: ' + all.length + ' arquivos em www/, JS inline valido, commit ' + commit + (rawCount ? ', RAW=' + rawCount : ''));
console.log('Manifesto: ' + path.relative(root, out));