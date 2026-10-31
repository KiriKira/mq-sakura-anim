// Self-check for scene.js: node test/shots.mjs [--shots-only]
// Serves the repo with python3 -m http.server, opens index.html in headless Chromium (Playwright), runs the
// self-check (index.html?test=1), then takes screenshots from the four oblique corners and from straight above
// into screenshots/, plus the walkers' model sheet (walkers.html). Fails on console errors, page errors, requests outside this server, or a failed check.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8123, BASE = `http://127.0.0.1:${PORT}/`;
const OUT = path.join(ROOT, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
let failed = false;
const fail = m => { console.error('FAIL: ' + m); failed = true; };

try {
  for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  async function open(query, size = { width: 1000, height: 800 }, page0 = 'index.html') {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
    const problems = [];
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.type() + ': ' + m.text()); });
    page.on('pageerror', e => problems.push('pageerror: ' + e.message));
    page.on('request', r => { if (!r.url().startsWith(BASE)) problems.push('external request: ' + r.url()); });
    page.on('requestfailed', r => problems.push('request failed: ' + r.url()));
    await page.goto(BASE + page0 + '?' + (page0 === 'index.html' ? 'nomusic=1&' : '') + query);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
    return { page, problems, report: await page.evaluate(() => window.__report) };
  }

  if (!process.argv.includes("--shots-only")) {
  const { page, problems, report } = await open("test=1&pause=1");
  console.log(JSON.stringify(report, (k, v) => Array.isArray(v) && v.every(n => typeof n === "number") ? JSON.stringify(v) : v, 1));
  if (problems.length) fail(problems.join('\n'));
  if (!report.walkersShown) fail('the walkers are not all shown (no path?)');
  if (report.insideTree.length) fail('something inside the tree');
  if (report.showErrors.length) fail('the show is off its timeline');
  if (report.petalsAboveCanopy) fail('petals floating above the canopy');
  if (report.petalsFloating) fail('resting petals with nothing under them');
  if (report.stageAfterDispose.join() !== 'SakuraQR') fail('dispose() left ' + report.stageAfterDispose.join());
  if (report.outOfBounds.length) fail('something out of bounds');
  if (report.offPlate.length) fail('a walker stepped off the plate');
  if (report.walkerOverlap) fail('walkers bumped into each other');
  if (report.drawCalls > 60) fail('too many draw calls: ' + report.drawCalls);
  if (report.triangles > 80000) fail('too many triangles: ' + report.triangles);
  if (report.updateMs.p95 > 2) fail('update() too slow: ' + report.updateMs.p95 + ' ms');
  await page.close();
  }

  for (const view of ['ne', 'nw', 'se', 'sw', 'top']) {
    const { page, problems } = await open(`view=${view}&t=12&pause=1`);
    if (problems.length) fail(view + ': ' + problems.join('\n'));
    await page.screenshot({ path: path.join(OUT, view + '.png') });
    await page.close();
  }
  // the show: the whale diving in, everyone watching, the whale circling while they run, climbing away, the hop
  for (const [view, t, name] of [['wide', 18.8, 'show-1-dive'], ['wide', 24, 'show-2-watch'], ['group', 24, 'show-2-watch-close'],
    ['wide', 40, 'show-3-circle'], ['wide', 59.5, 'show-4-climb'], ['group', 70, 'show-5-hop']]) {
    const { page, problems } = await open(`view=${view}&t=${t}&pause=1`, view === 'group' ? { width: 600, height: 600 } : { width: 1000, height: 800 });
    if (problems.length) fail(name + ': ' + problems.join('\n'));
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    await page.close();
  }
  // close-ups: each walker, then the group over a second and a half
  const close = [['w0', 12, 'walker-0'], ['w1', 12, 'walker-1'], ['w2', 12, 'walker-2']];
  for (let k = 0; k < 4; k++) close.push(['group', 20 + k * 0.5, 'group-' + k]);
  for (const [view, t, name] of close) {
    const { page, problems } = await open(`view=${view}&t=${t}&pause=1`, { width: 600, height: 600 });
    if (problems.length) fail(view + ': ' + problems.join('\n'));
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    await page.close();
  }
  // model sheet of the three walkers
  {
    const { page, problems } = await open('', { width: 1200, height: 1500 }, 'walkers.html');
    if (problems.length) fail('walkers.html: ' + problems.join('\n'));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'walkers.png') });
    await page.close();
  }
  await browser.close();
} finally {
  server.kill();
}
if (failed) process.exit(1);
console.log('ok');
