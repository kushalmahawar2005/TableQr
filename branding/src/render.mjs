import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const FPS = 30, TOTAL = 1080;
const root = import.meta.dirname;

// --- build film.built.html with the QR matrix injected ---
const qr = fs.readFileSync(path.join(root, 'qr.json'), 'utf8');
const src = fs.readFileSync(path.join(root, 'film.html'), 'utf8');
if (!src.includes('__QR_DATA__')) throw new Error('QR placeholder missing from film.html');
fs.writeFileSync(path.join(root, 'film.built.html'), src.replace('__QR_DATA__', qr));

// --- which frames? ---
const arg = process.argv[2] || 'all';
let frames;
if (arg === 'all') {
  frames = Array.from({ length: TOTAL }, (_, i) => i);
} else if (arg === 'sample') {
  // one frame from every beat worth looking at
  frames = [10, 45, 75, 110, 150, 200, 240, 265, 290, 320, 350, 365, 395,
            420, 450, 500, 530, 570, 600, 625, 660, 700, 725, 760, 790,
            810, 850, 880, 910, 940, 975, 1010, 1040, 1070];
} else {
  // accepts "12,40" and "250-340" mixed
  frames = [];
  for (const part of arg.split(',')) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      for (let i = a; i <= b; i++) frames.push(i);
    } else frames.push(Number(part));
  }
}

const PATCH = process.env.PATCH === '1';
const outDir = path.join(root, (arg === 'all' || PATCH) ? 'frames' : 'sample');
if (!PATCH) fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--force-device-scale-factor=1', '--hide-scrollbars', '--font-render-hinting=none',
         '--disable-lcd-text', '--allow-file-access-from-files']
});
const page = await browser.newPage({
  viewport: { width: 1080, height: 1920 },
  deviceScaleFactor: 1
});

await page.goto('file://' + path.join(root, 'film.built.html'), { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 30000 });

const errs = [];
page.on('pageerror', e => errs.push(String(e)));

const t0 = Date.now();
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  await page.evaluate(n => window.renderFrame(n), f);
  await page.screenshot({
    path: path.join(outDir, String(f).padStart(5, '0') + '.png'),
    animations: 'disabled'
  });
  if (arg === 'all' && i % 90 === 0) {
    const pct = ((i / frames.length) * 100).toFixed(0);
    const eta = i ? (((Date.now() - t0) / i) * (frames.length - i) / 1000).toFixed(0) : '?';
    console.log(`  ${pct}%  frame ${f}/${TOTAL}  eta ${eta}s`);
  }
}
await browser.close();

if (errs.length) { console.error('PAGE ERRORS:'); errs.slice(0, 10).forEach(e => console.error('  ' + e)); }
console.log(`rendered ${frames.length} frames -> ${outDir} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
