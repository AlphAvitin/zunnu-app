// ZUNNU brand icon generator
// Renders the purple rounded app icon (white outline cat + dog hugging)
// into Android mipmaps (legacy + adaptive foreground) and iOS AppIcon set.
// Uses headless Chrome (CDP) to rasterize SVG -> PNG at exact sizes.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9339;
const PROFILE = path.join(os.tmpdir(), 'zunnu_icon_profile');
const ROOT = path.resolve(__dirname, '..');
const MIPMAP = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const BRAND = path.join(ROOT, 'branding');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const PURPLE = '#7C3AED';
const WHITE = '#FFFFFF';

// --- Artwork: white outline cat + dog hugging (viewBox 0 0 512 512) ---
function artPaths() {
  const s = (d) => `<path d="${d}" fill="none" stroke="${WHITE}" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>`;
  const thick = (d) => `<path d="${d}" fill="none" stroke="${WHITE}" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `
  <g>
    ${thick('M206,205a95,95 0 1,0 0.1,0')}                         <!-- dog head -->
    <ellipse cx="128" cy="238" rx="30" ry="60" fill="none" stroke="${WHITE}" stroke-width="17" transform="rotate(-18 128 238)"/>  <!-- dog floppy ear -->
    <ellipse cx="150" cy="176" rx="24" ry="46" fill="none" stroke="${WHITE}" stroke-width="13" transform="rotate(-30 150 176)"/>  <!-- inner ear hint -->
    ${thick('M306,197a88,88 0 1,0 0.1,0')}                          <!-- cat head -->
    ${s('M244,152 L230,60 L300,104')}                                <!-- cat ear L -->
    ${s('M370,100 L402,52 L396,158')}                                <!-- cat ear R -->
    ${s('M258,118 L268,124 L260,128')}                               <!-- inner ear -->
    ${s('M386,110 L396,118 L390,120')}                               <!-- inner ear -->
    ${thick('M232,330a34,34 0 1,0 0.1,0')}                           <!-- dog muzzle -->
    <ellipse cx="224" cy="342" rx="12" ry="8" fill="${WHITE}"/>
    ${thick('M280,324a24,24 0 1,0 0.1,0')}                           <!-- cat muzzle -->
    ${s('M272,314 l6,6 -6,6')}                                       <!-- cat nose -->
    ${s('M250,352 l-34,-8 M250,366 l-34,6')}                         <!-- whiskers L -->
    ${s('M304,344 l30,-8 M304,358 l30,6')}                           <!-- whiskers R -->
    ${s('M150,252 q10,-9 20,0 M196,268 q10,-9 20,0')}                <!-- dog happy eyes -->
    ${s('M258,262 q9,-9 18,0 M322,256 q9,-9 18,0')}                  <!-- cat happy eyes -->
    ${thick('M108,352 C106,410 132,444 192,448')}                    <!-- dog arm -->
    <ellipse cx="204" cy="452" rx="22" ry="16" fill="none" stroke="${WHITE}" stroke-width="15"/>  <!-- dog paw -->
    ${s('M182,456 l8,-16 M204,460 l8,-16 M226,454 l8,-16')}         <!-- dog toes -->
    ${thick('M404,336 C404,398 372,428 324,438')}                    <!-- cat arm -->
    <ellipse cx="310" cy="440" rx="20" ry="14" fill="none" stroke="${WHITE}" stroke-width="15"/>  <!-- cat paw -->
    ${s('M288,442 l8,-14 M310,446 l8,-14 M331,440 l8,-14')}         <!-- cat toes -->
    <path d="M256,132 c-11,-20 -30,-13 -30,4 c0,15 16,26 30,36 c14,-10 30,-21 30,-36 c0,-17 -19,-24 -30,-4 z" fill="${WHITE}"/>  <!-- heart -->
    ${s('M118,106 l6,14 14,6 -14,6 -6,14 -6,-14 -14,-6 14,-6 z')}    <!-- sparkle -->
    ${s('M396,86 l5,12 12,5 -12,5 -5,12 -5,-12 -12,-5 12,-5 z')}     <!-- sparkle -->
  </g>`;
}

function iconSvg({ rounded = true, circle = false, transparent = false } = {}) {
  let bg = '';
  if (!transparent) {
    if (circle) bg = `<circle cx="256" cy="256" r="246" fill="${PURPLE}"/>`;
    else if (rounded) bg = `<rect x="14" y="14" width="484" height="484" rx="106" fill="${PURPLE}"/>`;
    else bg = `<rect x="0" y="0" width="512" height="512" fill="${PURPLE}"/>`;
  }
  let art = artPaths();
  if (transparent) {
    // center artwork into the 108dp adaptive safe zone (~ central 62%)
    art = `<g transform="translate(54 54) scale(0.20) translate(-256 -262)">${artPaths()}</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${bg}${art}</svg>`;
}

// --- CDP helpers ---
function launchChrome() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank'
  ];
  return spawn(CHROME, args, { stdio: 'ignore' });
}

async function getPageWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const tabs = await res.json();
      const page = tabs.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('CDP not available');
}

let msgId = 0;
const pending = new Map();
let ws;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
function onMessage(ev) {
  const data = JSON.parse(ev.data);
  if (data.id && pending.has(data.id)) {
    const p = pending.get(data.id); pending.delete(data.id);
    if (data.error) p.reject(new Error(data.error.message));
    else p.resolve(data.result);
  }
}
let seq = 0;
async function renderSvg(svg, size) {
  const key = 'r' + (++seq);
  const b64 = Buffer.from(svg, 'utf8').toString('base64');
  const url = 'data:text/html;base64,' + Buffer.from(
    `<!doctype html><meta charset="utf-8"><body style="margin:0;width:${size}px;height:${size}px;overflow:hidden;background:#fff"><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${b64}"></body>`
  ).toString('base64');
  await send('Page.navigate', { url });
  await waitIdle();
  await send('Runtime.evaluate', { expression: `document.querySelector('img').complete`, returnByValue: true });
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true, clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
  fs.writeFileSync(path.join(os.tmpdir(), key + '.png'), Buffer.from(shot.data, 'base64'));
  return path.join(os.tmpdir(), key + '.png');
}
async function waitIdle() {
  await new Promise(r => setTimeout(r, 400));
}

function writePng(name, svg, size, dir) {
  return renderSvg(svg, size).then(src => {
    const dst = path.join(dir, name);
    fs.copyFileSync(src, dst);
    return dst;
  });
}

(async () => {
  try {
    console.log('launching chrome...');
    const chrome = launchChrome();
    const wsUrl = await getPageWs();
    ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = onMessage;
    await send('Page.enable');
    await send('Runtime.enable');

    const legacySizes = { 'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192 };
    const fgSizes = { 'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432 };

    const written = [];
    // Legacy launcher (rounded square)
    for (const [d, s] of Object.entries(legacySizes)) {
      written.push(await writePng('ic_launcher.png', iconSvg({ rounded: true }), s, path.join(MIPMAP, 'mipmap-' + d)));
    }
    console.log('legacy launcher ok');
    // Round launcher
    for (const [d, s] of Object.entries(legacySizes)) {
      written.push(await writePng('ic_launcher_round.png', iconSvg({ circle: true }), s, path.join(MIPMAP, 'mipmap-' + d)));
    }
    console.log('round launcher ok');
    // Adaptive foreground (art only, transparent, 108dp canvas)
    for (const [d, s] of Object.entries(fgSizes)) {
      written.push(await writePng('ic_launcher_foreground.png', iconSvg({ transparent: true }), s, path.join(MIPMAP, 'mipmap-' + d)));
    }
    console.log('adaptive foreground ok');

    // Adaptive background color -> purple
    fs.writeFileSync(path.join(MIPMAP, 'values', 'ic_launcher_background.xml'),
      '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">' + PURPLE + '</color>\n</resources>\n');
    // Tidy the unused background vector to solid purple
    fs.writeFileSync(path.join(MIPMAP, 'drawable', 'ic_launcher_background.xml'),
      '<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android"\n    android:width="108dp"\n    android:height="108dp"\n    android:viewportWidth="108"\n    android:viewportHeight="108">\n    <path android:fillColor="' + PURPLE + '" android:pathData="M0,0h108v108h-108z" />\n</vector>\n');

    // iOS AppIcon set (full-square art, Apple masks corners)
    const labels = [
      ['Icon-App-20x20@1x.png', 20], ['Icon-App-20x20@2x.png', 40], ['Icon-App-20x20@3x.png', 60],
      ['Icon-App-29x29@1x.png', 29], ['Icon-App-29x29@2x.png', 58], ['Icon-App-29x29@3x.png', 87],
      ['Icon-App-40x40@1x.png', 40], ['Icon-App-40x40@2x.png', 80], ['Icon-App-40x40@3x.png', 120],
      ['Icon-App-60x60@2x.png', 120], ['Icon-App-60x60@3x.png', 180],
      ['Icon-App-76x76@1x.png', 76], ['Icon-App-76x76@2x.png', 152],
      ['Icon-App-83.5x83.5@2x.png', 167],
      ['Icon-App-1024x1024@1x.png', 1024]
    ];
    const setDir = path.join(BRAND, 'AppIcon.appiconset');
    fs.mkdirSync(setDir, { recursive: true });
    for (const [name, size] of labels) {
      await writePng(name, iconSvg({ rounded: false }), size, setDir);
      console.log('ios ' + name + ' (' + size + 'px)');
    }
    const contents = {
      images: labels.map(([filename, size]) => {
        const idiom = size === 1024 || size === 167 ? 'ios-marketing' : 'ios';
        return {
          filename,
          idiom,
          size: size === 1024 ? '1024x1024' : (size === 167 ? '83.5x83.5' : Math.round(size / 2) + 'x' + Math.round(size / 2)),
          scale: size === 1024 ? '1x' : (size === 167 ? '2x' : (size % 2 === 0 && size <= 40 ? '2x' : (size % 3 === 0 ? '3x' : '2x')))
        };
      })
    };
    // fix scales by name convention
    const scaleFor = { 'Icon-App-20x20@1x.png':'1x','Icon-App-20x20@2x.png':'2x','Icon-App-20x20@3x.png':'3x','Icon-App-29x29@1x.png':'1x','Icon-App-29x29@2x.png':'2x','Icon-App-29x29@3x.png':'3x','Icon-App-40x40@1x.png':'1x','Icon-App-40x40@2x.png':'2x','Icon-App-40x40@3x.png':'3x','Icon-App-60x60@2x.png':'2x','Icon-App-60x60@3x.png':'3x','Icon-App-76x76@1x.png':'1x','Icon-App-76x76@2x.png':'2x','Icon-App-83.5x83.5@2x.png':'2x','Icon-App-1024x1024@1x.png':'1x' };
    const pointFor = { 'Icon-App-20x20@1x.png':'20x20','Icon-App-20x20@2x.png':'20x20','Icon-App-20x20@3x.png':'20x20','Icon-App-29x29@1x.png':'29x29','Icon-App-29x29@2x.png':'29x29','Icon-App-29x29@3x.png':'29x29','Icon-App-40x40@1x.png':'40x40','Icon-App-40x40@2x.png':'40x40','Icon-App-40x40@3x.png':'40x40','Icon-App-60x60@2x.png':'60x60','Icon-App-60x60@3x.png':'60x60','Icon-App-76x76@1x.png':'76x76','Icon-App-76x76@2x.png':'76x76','Icon-App-83.5x83.5@2x.png':'83.5x83.5','Icon-App-1024x1024@1x.png':'1024x1024' };
    contents.images = labels.map(([filename, size]) => ({
      filename,
      idiom: size === 1024 ? 'ios-marketing' : 'ios',
      size: pointFor[filename],
      scale: scaleFor[filename]
    }));
    fs.writeFileSync(path.join(setDir, 'Contents.json'), JSON.stringify(contents, null, 2) + '\n');

    console.log('TOTAL PNGs: ' + written.length);
    console.log('DONE');
    chrome.kill();
  } catch (e) {
    console.error('gen-icons ERROR:', e.message);
    process.exit(1);
  }
})();