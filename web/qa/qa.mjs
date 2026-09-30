// End-to-end mobile QA for the web version: scan → review/fix → Stockfish analysis →
// history, plus editing, moves, promotion and "open in" links. Runs Chromium with
// iPhone emulation, records a video and saves a screenshot at every step.
//
//   BASE_URL      site to test (default http://localhost:8765/)
//   OUT           output directory (default ./out)
//   CAMERA_Y4M    optional .y4m video used as the phone camera
//   CHROMIUM      optional Chromium executable
//   HTTPS_PROXY   optional; localhost is never proxied
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const OUT = path.resolve(process.env.OUT || path.join(here, 'out'));
const FIXTURE = path.resolve(here, '../../ChessScannerUITests/Fixtures/physical_board.png');
// Reference prediction (Python ONNX Runtime) for the fixture.
const FIXTURE_PLACEMENT = 'r1b1k2r/p1q2p1p/1qnb2p1/1pnn2b1/1Q1N4/PP3N2/P1P1BPPP/R4R2';
const DEVICE = devices['iPhone 13'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
if (process.env.CAMERA_Y4M) args.push(`--use-file-for-fake-video-capture=${process.env.CAMERA_Y4M}`);
if (process.env.HTTPS_PROXY) args.push(`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=localhost;127.0.0.1');

const browser = await chromium.launch({ args, executablePath: process.env.CHROMIUM || undefined });
const context = await browser.newContext({
  ...DEVICE,
  permissions: ['camera'],
  // The sandbox proxy re-signs HTTPS; real phones never need this.
  ignoreHTTPSErrors: !!process.env.HTTPS_PROXY,
  recordVideo: { dir: OUT, size: DEVICE.viewport },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message} @ ${(e.stack || '').split('\n').slice(1, 3).join(' | ')}`));
page.on('console', (m) => { if (m.type() === 'error' && !/cpuid_info/.test(m.text())) errors.push(`console: ${m.text()}`); });

const results = [];
const timings = {};
let shot = 0;

async function screenshot(name) {
  await page.waitForTimeout(450); // let transitions settle
  await page.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, '0')}-${name}.png`) });
}

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, seconds: (Date.now() - started) / 1000 });
    console.log(`✓ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message.split('\n')[0] });
    console.log(`✗ ${name}\n  ${e.message.split('\n').slice(0, 3).join('\n  ')}`);
    await screenshot(`FAILED-${name.replace(/\W+/g, '-')}`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
const sq = (s) => page.locator(`[data-testid=square-${s}]`).first();
const pieceOn = (s, board = '#editor-board') => page.locator(`${board} [data-square=${s}]`).getAttribute('data-piece');
const analyzeButton = () => page.locator('[data-testid=editor-analyze]');

async function center(selector) {
  const box = await page.locator(selector).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await page.mouse.up();
}

async function dragSquare(board, from, to) {
  await drag(await center(`${board} [data-square=${from}]`), await center(`${board} [data-square=${to}]`));
}

async function readPlacement(board = '#editor-board') {
  return page.evaluate((b) => {
    const map = Object.fromEntries([...document.querySelectorAll(`${b} .sq`)].map((s) => [s.dataset.square, s.dataset.piece]));
    const ranks = [];
    for (let r = 8; r >= 1; r--) {
      let row = '', e = 0;
      for (const f of 'abcdefgh') {
        const p = map[f + r];
        if (p === 'empty') { e++; continue; }
        if (e) { row += e; e = 0; }
        row += p;
      }
      if (e) row += e;
      ranks.push(row);
    }
    return ranks.join('/');
  }, board);
}

async function waitDepth(min, timeout = 90000) {
  const started = Date.now();
  await page.waitForFunction((d) => Number(document.getElementById('engine-depth').dataset.depth) >= d, min, { timeout });
  return (Date.now() - started) / 1000;
}

async function editorMenu(label) {
  await page.tap('[data-testid=editor-menu]');
  await page.locator('.menu-panel button', { hasText: label }).tap();
}

async function back() {
  await page.locator('.view[data-active] [data-back]').tap();
  await page.waitForTimeout(400);
}

// MARK: - Tests

await page.goto(BASE);

await test('landing and camera', async () => {
  await page.waitForSelector('#view-scan[data-active]');
  if (process.env.CAMERA_Y4M) {
    await page.waitForSelector('#viewfinder.camera-on', { timeout: 10000 });
  }
  await screenshot('landing');
});

await test('scan a photo from the library', async () => {
  const started = Date.now();
  await page.setInputFiles('#file-input', FIXTURE);
  await page.waitForSelector('#viewfinder.processing', { timeout: 5000 });
  await screenshot('scanning');
  await page.waitForSelector('#view-editor[data-active]', { timeout: 240000 });
  timings.firstScanSeconds = (Date.now() - started) / 1000;
  const placement = await readPlacement();
  fs.writeFileSync(path.join(OUT, 'recognized-placement.txt'), `${placement}\nexpected: ${FIXTURE_PLACEMENT}\n`);
  assert(placement === FIXTURE_PLACEMENT, `recognized ${placement}, reference ${FIXTURE_PLACEMENT}`);
  assert(await page.locator('#btn-photo').isVisible(), 'photo thumbnail missing');
  await screenshot('editor-after-scan');
});

await test('fix the scan and analyze', async () => {
  // The reference photo has no white king; add one the way a user would.
  assert((await analyzeButton().textContent()) === 'Add a white king', 'expected the missing-king message');
  assert(await analyzeButton().isDisabled(), 'Analyze should be disabled');
  await page.tap('[data-testid=tray-wK]');
  await sq('g1').tap();
  await page.tap('[data-testid=tray-wK]'); // stop placing
  assert((await pieceOn('g1')) === 'K', 'tap-to-place failed');
  await page.waitForFunction(() => !document.querySelector('[data-testid=editor-analyze]').disabled);
  await screenshot('editor-fixed');
  await analyzeButton().tap();
  await page.waitForSelector('#view-analysis[data-active]');
  timings.depth12Seconds = await waitDepth(12);
  timings.depth18Seconds = await waitDepth(18);
  await screenshot('analysis-scanned');
});

await test('history saves and reopens', async () => {
  await back(); await back();
  await page.tap('[data-testid=scan-history]');
  const rows = page.locator('[data-testid=history-row]');
  await rows.first().waitFor();
  assert((await rows.count()) === 1, `expected 1 history row, got ${await rows.count()}`);
  await screenshot('history');
  await rows.first().tap();
  await page.waitForSelector('#view-analysis[data-active]');
  await page.waitForSelector('[data-testid=engine-line]');
  await back();
});

await test('manual setup and editing', async () => {
  await page.tap('[data-testid=scan-manual]');
  await page.waitForSelector('#view-editor[data-active]');
  assert((await readPlacement()) === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR', 'start position expected');
  assert(await page.locator('#btn-photo').isHidden(), 'no photo expected for manual setup');
  await screenshot('editor-start');

  await drag(await center('[data-testid=tray-wQ]'), await center('#editor-board [data-square=e4]'));
  assert((await pieceOn('e4')) === 'Q', 'tray drag did not place a queen');

  await page.tap('[data-testid=tray-bQ]');
  await sq('d4').tap();
  assert((await pieceOn('d4')) === 'q', 'tap-to-place failed');
  await sq('d4').tap();
  assert((await pieceOn('d4')) === 'empty', 'tapping again should remove');
  await page.tap('[data-testid=editor-undo]');
  assert((await pieceOn('d4')) === 'q', 'undo failed');
  await page.tap('[data-testid=tray-bQ]');

  // Drag a piece off the board onto the tray to remove it.
  await drag(await center('#editor-board [data-square=d4]'), await center('[data-testid=tray-wP]'));
  assert((await pieceOn('d4')) === 'empty', 'drag off the board did not remove');
  await screenshot('editor-edited');

  await editorMenu('Clear board');
  assert((await analyzeButton().textContent()) === 'Add a white king', 'missing validation on empty board');
  assert(await analyzeButton().isDisabled(), 'Analyze enabled on empty board');
  await screenshot('editor-invalid');

  await editorMenu('Starting position');
  assert(!(await analyzeButton().isDisabled()), 'Analyze disabled on start position');

  await dragSquare('#editor-board', 'g1', 'f3');
  assert((await pieceOn('f3')) === 'N', 'editor drag failed');
  await page.tap('[data-testid=editor-undo]');
  assert((await pieceOn('g1')) === 'N', 'undo of drag failed');

  // Side to move: a position with Black in check needs Black to move.
  await page.tap('[data-testid=side-black]');
  assert(await page.locator('[data-testid=side-black]').evaluate((b) => b.classList.contains('on')), 'side toggle failed');
  await page.tap('[data-testid=side-white]');
});

await test('analysis: moves, lines, navigation, engine toggle', async () => {
  await analyzeButton().tap();
  await page.waitForSelector('#view-analysis[data-active]');
  const lines = page.locator('[data-testid=engine-line]:not(.placeholder)');
  await lines.first().waitFor({ timeout: 60000 });

  await page.locator('#analysis-board [data-square=e2]').tap();
  await page.locator('#analysis-board [data-square=e4]').tap();
  assert((await pieceOn('e4', '#analysis-board')) === 'P', 'tap-tap e2-e4 failed');
  await dragSquare('#analysis-board', 'e7', 'e5');
  await page.waitForTimeout(300);
  assert((await pieceOn('e5', '#analysis-board')) === 'p', 'drag e7-e5 failed');
  assert(await page.locator('[data-testid=move-2]').isVisible(), 'move list missing');

  // Illegal drag snaps back.
  await dragSquare('#analysis-board', 'd2', 'd5');
  assert((await pieceOn('d2', '#analysis-board')) === 'P', 'illegal move was played');

  await waitDepth(14);
  assert((await lines.count()) === 3, `expected 3 lines, got ${await lines.count()}`);
  const arrow = await page.locator('#analysis-board .arrow-head').count();
  assert(arrow === 1, 'best-move arrow missing');
  const barValue = await page.locator('[data-testid=eval-bar]').getAttribute('data-value');
  assert(barValue && barValue !== 'pending', 'eval bar has no value');
  await screenshot('analysis-e4-e5');

  // A stable top line: record how often the best move changes between depths 14 and 20.
  const seen = [];
  for (let d = 15; d <= 20; d++) {
    await waitDepth(d, 120000);
    seen.push(await page.evaluate(() => document.querySelector('[data-testid=engine-line] .pv')?.textContent.split(' ').slice(0, 2).join(' ')));
  }
  timings.topLineChangesDepth15to20 = seen.filter((m, i) => i && m !== seen[i - 1]).length;

  await page.tap('[data-testid=analysis-back]');
  assert((await pieceOn('e5', '#analysis-board')) === 'empty', 'back failed');
  await page.tap('[data-testid=analysis-forward]');
  assert((await pieceOn('e5', '#analysis-board')) === 'p', 'forward failed');

  await page.tap('[data-testid=analysis-flip]');
  await screenshot('analysis-flipped');
  await page.tap('[data-testid=analysis-flip]');

  // Open-in links carry the current position.
  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
  const lichess = await page.getAttribute('[data-testid=open-lichess]', 'href');
  const chesscom = await page.getAttribute('[data-testid=open-chesscom]', 'href');
  assert(lichess === `https://lichess.org/analysis/${fen.replace(/ /g, '_')}`, `lichess link: ${lichess}`);
  assert(chesscom === `https://www.chess.com/analysis?fen=${encodeURIComponent(fen)}`, `chess.com link: ${chesscom}`);

  await page.locator('.switch').tap();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=engine-line]').length === 0);
  await screenshot('engine-off');
  await page.locator('.switch').tap();
  await lines.first().waitFor();
});

await test('promotion', async () => {
  await page.goto(`${BASE}?fen=${encodeURIComponent('7k/P7/8/8/8/8/8/4K3 w - - 0 1')}`);
  await page.waitForSelector('#view-editor[data-active]');
  await analyzeButton().tap();
  await page.waitForSelector('#view-analysis[data-active]');
  await dragSquare('#analysis-board', 'a7', 'a8');
  await page.waitForSelector('#promotion:not([hidden])');
  await screenshot('promotion-picker');
  await page.tap('[data-testid=promote-n]');
  await page.waitForTimeout(300);
  assert((await pieceOn('a8', '#analysis-board')) === 'N', 'underpromotion failed');
  await screenshot('after-promotion');
});

await test('camera capture', async () => {
  if (!process.env.CAMERA_Y4M) return;
  await page.goto(BASE);
  await page.waitForSelector('#viewfinder.camera-on', { timeout: 10000 });
  const started = Date.now();
  await page.tap('[data-testid=scan-shutter]');
  await page.waitForSelector('#view-editor[data-active]', { timeout: 120000 });
  timings.cameraScanSeconds = (Date.now() - started) / 1000;
  await screenshot('editor-from-camera');
});

await test('no page errors', async () => {
  assert(errors.length === 0, errors.join('\n'));
});

const video = page.video();
await context.close();
await browser.close();
if (video) fs.renameSync(await video.path(), path.join(OUT, 'session.webm'));

const passed = results.filter((r) => r.ok).length;
const summary = { passed, failed: results.length - passed, results, timings, errors };
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\n${passed}/${results.length} passed`, JSON.stringify(timings));
process.exit(passed === results.length ? 0 : 1);
