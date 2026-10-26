// End-to-end check: two Conteng copies (two "people") on one shared test board.
// Run: node tools/sync_test.js   — screenshots land in test-output/.
const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'test-output');
const appData = path.join(os.homedir(), 'Library', 'Application Support');
const room = `conteng-test-${crypto.randomBytes(5).toString('hex')}`;
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

function seed(profile, name) {
  const dir = path.join(appData, `Conteng-${profile}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ author: crypto.randomUUID(), room, name, size: 320 }));
  return dir;
}

async function open(profile) {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, CONTENG_PROFILE: profile } });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__conteng && window.__conteng.state.connected, null, { timeout: 15000 });
  return { app, page };
}
const count = (page) => page.evaluate(() => window.__conteng.state.strokes.size);
async function waitCount(page, n, ms = 5000) {
  try { await page.waitForFunction((n) => window.__conteng.state.strokes.size === n, n, { timeout: ms }); return true; } catch { return false; }
}
async function scribble(page, slow = false) {
  const box = await page.locator('#ink').boundingBox();
  await page.mouse.move(box.x + 60, box.y + 160);
  await page.mouse.down();
  for (let i = 0; i <= 30; i++) {
    await page.mouse.move(box.x + 60 + i * 6, box.y + 160 + Math.sin(i / 3) * 40);
    if (slow) await page.waitForTimeout(15);
  }
}
async function clickTool(page, id) {
  await page.hover('#ink');
  await page.click(`#${id}`);
}
const inkPixels = (page) => page.evaluate(() => {
  const c = document.getElementById('ink');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const dirs = [seed('testA', 'Luqman'), seed('testB', 'Friend')];
  let A = await open('testA');
  const B = await open('testB');
  await A.page.waitForTimeout(1500); // let presence settle

  let online = true;
  try { await B.page.waitForFunction(() => document.getElementById('statusText').textContent === 'Friend is here', null, { timeout: 6000 }); } catch { online = false; }
  check(online, 'B sees A online');

  // Live: B must see A's stroke while A is still drawing.
  await scribble(A.page, true);
  const liveOnB = await waitCount(B.page, 1, 3000);
  check(liveOnB, 'stroke appears on B while A is still drawing');
  await A.page.mouse.up();
  await B.page.waitForTimeout(800);
  const [ptsA, ptsB] = await Promise.all([A.page, B.page].map((p) => p.evaluate(() => [...window.__conteng.state.strokes.values()][0].points.length)));
  check(ptsA === ptsB && ptsA > 10, `B has every point of A's stroke (${ptsA} / ${ptsB})`);

  // B draws in red, A sees it.
  await B.page.click('.swatch[aria-label="Red"]', { force: true });
  await scribble(B.page); await B.page.mouse.up();
  check(await waitCount(A.page, 2), 'A sees B\'s stroke');
  await A.page.screenshot({ path: path.join(OUT, 'a-two-strokes.png') });

  // A fast, long scribble arrives whole (no dropped or doubled points).
  {
    const box = await A.page.locator('#ink').boundingBox();
    await A.page.mouse.move(box.x + 20, box.y + 40); await A.page.mouse.down();
    for (let i = 0; i < 300; i++) await A.page.mouse.move(box.x + 20 + (i % 50) * 5, box.y + 40 + Math.floor(i / 50) * 40 + (i % 2) * 6);
    await A.page.mouse.up();
    await waitCount(B.page, 3);
    await B.page.waitForTimeout(800);
    const last = (p) => p.evaluate(() => [...window.__conteng.state.strokes.values()].at(-1).points.length);
    const [fa, fb] = [await last(A.page), await last(B.page)];
    check(fa === fb && fa > 200, `fast scribble arrives whole (${fa} / ${fb})`);
    await clickTool(A.page, 'undo');
    await waitCount(B.page, 2);
  }

  // A undoes its own stroke; B loses it too.
  await clickTool(A.page, 'undo');
  check(await waitCount(B.page, 1), 'A\'s undo removes the stroke on B');

  // A draws again, then quits and reopens: the board comes back from the database.
  await scribble(A.page); await A.page.mouse.up();
  await waitCount(B.page, 2);
  await A.page.waitForTimeout(1500); // let the save finish
  await A.app.close();
  A = await open('testA');
  check(await waitCount(A.page, 2, 8000), 'A reopens with both strokes kept');
  check((await inkPixels(A.page)) > 500, 'reopened board actually shows ink');
  await A.page.screenshot({ path: path.join(OUT, 'a-after-reopen.png') });

  // Eraser stroke syncs as a stroke.
  await clickTool(B.page, 'eraser');
  await scribble(B.page); await B.page.mouse.up();
  check(await waitCount(A.page, 3), 'eraser stroke reaches A');

  // Drag strip moves the window; corner grip resizes it, square.
  const before = await B.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  await B.page.mouse.move(160, 10); await B.page.mouse.down();
  for (let i = 1; i <= 10; i++) await B.page.mouse.move(160 - i * 4, 10 + i * 3);
  await B.page.mouse.up();
  await B.page.waitForTimeout(300);
  const moved = await B.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  check(moved.x !== before.x || moved.y !== before.y, `drag strip moves the board (${before.x},${before.y} → ${moved.x},${moved.y})`);
  await B.page.hover('#ink');
  await B.page.mouse.move(before.width - 10, before.height - 10); await B.page.mouse.down();
  for (let i = 1; i <= 10; i++) await B.page.mouse.move(before.width - 10 + i * 6, before.height - 10 + i * 6);
  await B.page.mouse.up();
  await B.page.waitForTimeout(300);
  const sized = await B.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  check(sized.width > before.width && sized.width === sized.height, `corner grip resizes, still square (${before.width} → ${sized.width}x${sized.height})`);

  // B clears for both.
  await clickTool(B.page, 'clear');
  await B.page.click('#confirmYes');
  check(await waitCount(A.page, 0), 'clear empties A');
  await A.page.waitForTimeout(1000);
  await A.page.evaluate(() => window.__conteng.load());
  check((await count(A.page)) === 0, 'database is empty after clear');
  await B.page.screenshot({ path: path.join(OUT, 'b-cleared.png') });

  await A.app.close(); await B.app.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
