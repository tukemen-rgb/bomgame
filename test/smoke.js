/* =========================================================
   DEEP FALL — ヘッドレス動作確認
     node test/smoke.js

   要は「生成された縦坑を本当に抜けられるか」の検証。
   落下は止められないので、届かない隙間を1つ作っただけで理不尽死になる。
   そこで隙間へ向かって操作する自動操縦を積んで、実際に潜らせて測る。
   ========================================================= */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'screenshots');
const PORT = 8911;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(PORT, () => resolve(srv));
  });
}

function chromiumPath() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!fs.existsSync(base)) return undefined;
  const dir = fs.readdirSync(base).find(d => /^chromium-\d+$/.test(d));
  return dir ? path.join(base, dir, 'chrome-linux', 'chrome') : undefined;
}

/* ページ内に仕込む自動操縦。人間と同じく2層先まで見て穴の中心を狙う。 */
function installPilot() {
  window.__deaths = [];
  function passable(l, c) {
    if (!l || !l.cells) return true;
    const t = l.cells[c];
    return t !== BM.T_ROCK && t !== BM.T_BOMB;
  }
  function options(g, l) {
    if (l.buttons) {
      const un = l.buttons.filter(b => !b.hit);
      if (un.length) return un.map(b => g.buttonPos(b).x);
    }
    const out = []; let run = [];
    for (let c = BM.PLAY_L; c <= BM.PLAY_R + 1; c++) {
      if (c <= BM.PLAY_R && passable(l, c)) run.push(c);
      else if (run.length) { out.push(BM.centerX((run[0] + run[run.length - 1]) / 2)); run = []; }
    }
    return out;
  }
  function pilot() {
    const g = BM.game, p = g.player, I = BM.input;
    I.keys['ArrowLeft'] = I.keys['ArrowRight'] = false;
    if (!p.alive || g.state !== 'play') return;
    const ahead = g.world.layers
      .filter(l => (l.row + 1) * BM.TILE > p.y - p.r)
      .sort((a, b) => a.row - b.row);
    const cur = ahead[0], nxt = ahead[1];
    if (!cur) return;
    const opts = options(g, cur);
    if (!opts.length) { I.just[' '] = true; return; }   // 抜け道が無ければ掘る
    const nextOpts = nxt ? options(g, nxt) : null;
    let best = opts[0], bestCost = Infinity;
    for (const x of opts) {
      let cost = Math.abs(x - p.x);
      if (nextOpts && nextOpts.length) {
        let nd = Infinity;
        for (const nx of nextOpts) nd = Math.min(nd, Math.abs(nx - x));
        cost += nd * 0.8;
      }
      if (cost < bestCost) { bestCost = cost; best = x; }
    }
    const dx = best - p.x;
    if (dx < -3) I.keys['ArrowLeft'] = true;
    else if (dx > 3) I.keys['ArrowRight'] = true;
  }
  const orig = BM.Game.prototype.update;
  BM.Game.prototype.update = function (dt) {
    if (this.state === 'play') pilot();
    const was = this.player.alive;
    const r = orig.call(this, dt);
    if (was && !this.player.alive) {
      const l = this.crashCell ? this.world.layerAt(this.crashCell.row) : null;
      window.__deaths.push({ depth: this.player.deepest, type: l ? l.type : '?' });
    }
    return r;
  };
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await serve();
  const exe = chromiumPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 700, height: 800 } });

  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '')));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const check = (label, cond) => {
    console.log((cond ? '  ok   ' : '  FAIL ') + label);
    if (!cond) errors.push('ASSERT FAILED: ' + label);
  };
  const shot = n => page.screenshot({ path: path.join(SHOTS, n) });

  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForTimeout(400);
  await shot('01-title.png');
  check('タイトルが表示される', await page.isVisible('button[data-act="play"]'));

  await page.click('button[data-act="play"]');
  await page.waitForTimeout(500);
  check('落下が始まっている', await page.evaluate(() => BM.game.state === 'play' && BM.game.player.vy > 100));
  check('カメラが下へ動いている', await page.evaluate(() => BM.game.camY > -400));

  /* ---- 静止しているとやられる（このゲームの唯一の負け条件） ---- */
  await page.evaluate(() => {
    const g = BM.game;
    // 目の前に岩を敷いて、ぶつかったら終わりになることを確かめる
    const row = BM.rowOf(g.player.y) + 3;
    const cells = new Uint8Array(BM.COLS).fill(BM.T_ROCK);
    const l = { row, type: 'test', cells, gapX: 7, t: 0, phase: 0, exit: [7, 7], passed: false, item: null, button: null, dynamic: false };
    g.world.layers.push(l); g.world.byRow[row] = l;
  });
  await page.waitForTimeout(800);
  check('岩に触れたら墜落する', await page.evaluate(() => BM.game.state === 'over' && !BM.game.player.alive));
  await shot('02-crash.png');

  /* ---- 自動操縦で実際に潜らせる ---- */
  await page.evaluate(installPilot);
  const depths = [];
  const RUNS = 6, SECONDS = 18;
  for (let i = 0; i < RUNS; i++) {
    await page.evaluate(() => { BM.game.newRun(); BM.ui.hide(); });
    await page.waitForTimeout(SECONDS * 1000);
    const st = await page.evaluate(() => ({ d: BM.game.player.deepest, alive: BM.game.player.alive, score: BM.game.score }));
    depths.push(st.d);
    console.log(`  走行${i + 1}: ${st.d}m / ${st.score}点 ${st.alive ? '(まだ落下中)' : '(墜落)'}`);
    if (i === 1 && st.alive) await shot('03-play.png');
  }
  depths.sort((a, b) => a - b);
  const median = depths[RUNS >> 1];
  console.log('  到達深度 最小/中央/最大:', depths[0], '/', median, '/', depths[RUNS - 1]);

  // 生成が理不尽でなければ、素直に穴を狙うだけで必ずある程度は潜れる
  check('自動操縦でも最低 25m は潜れる（=詰む生成が無い）', depths[0] >= 25);
  check('中央値 60m 以上（=抜け道が続いている）', median >= 60);

  const deaths = await page.evaluate(() => window.__deaths);
  const byType = {};
  deaths.forEach(d => { byType[d.type] = (byType[d.type] || 0) + 1; });
  console.log('  墜落した地層:', JSON.stringify(byType));

  /* ---- 隙間の作り方が一通り出てくるか ---- */
  const seen = await page.evaluate(() => {
    const w = new BM.World();
    const kinds = {};
    for (let k = 0; k < 40; k++) {
      w.reset();
      w.ensure(600);
      w.layers.forEach(l => { kinds[l.type] = (kinds[l.type] || 0) + 1; });
    }
    return kinds;
  });
  console.log('  出現した地層の種類:', JSON.stringify(seen));
  check('隙間の作り方が9種類とも出る', Object.keys(seen).length >= 9);

  /* ---- 動く穴がプレイヤーより速く逃げないこと ---- */
  const tooFast = await page.evaluate(() => {
    const w = new BM.World();
    let bad = 0;
    for (let k = 0; k < 30; k++) {
      w.reset(); w.ensure(600);
      for (const l of w.layers) {
        if (!l.dynamic || !l.range) continue;
        const span = l.range[1] - l.range[0];
        const vpx = Math.abs(l.speed) * (span / 2) * BM.TILE;
        if (vpx > BM.MOVE_SPEED) bad++;
      }
    }
    return bad;
  });
  check('動く穴はプレイヤーの横移動より遅い', tooFast === 0);

  /* ---- 爆弾で掘れること ---- */
  const dug = await page.evaluate(() => {
    const g = BM.game;
    g.newRun(); BM.ui.hide();
    const row = BM.rowOf(g.player.y) + 6;
    const cells = new Uint8Array(BM.COLS).fill(BM.T_ROCK);
    const l = { row, type: 'test', cells, gapX: 7, t: 0, phase: 0, exit: [7, 7], passed: false, item: null, button: null, dynamic: false };
    g.world.layers.push(l); g.world.byRow[row] = l;
    const before = Array.from(cells).filter(c => c === BM.T_ROCK).length;
    g.dropBomb(g.player);
    return { before, col: BM.colOf(g.player.x), row };
  });
  await page.waitForTimeout(500);
  const after = await page.evaluate(r => {
    const l = BM.game.world.layerAt(r);
    return l ? Array.from(l.cells).filter(c => c === BM.T_ROCK).length : -1;
  }, dug.row);
  check('落とした爆弾が地層に穴を開ける', after >= 0 && after < dug.before);
  await shot('04-dig.png');

  const fps = await page.evaluate(() => new Promise(res => {
    let n = 0; const t0 = performance.now();
    (function tick() {
      n++;
      if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
      else res(n / ((performance.now() - t0) / 1000));
    })();
  }));
  console.log('  fps ≈', fps.toFixed(1));
  check('60fps 近辺で動く', fps > 50);

  await browser.close();
  srv.close();

  if (errors.length) {
    console.log('\n=== 失敗 ===\n' + errors.join('\n---\n'));
    process.exit(1);
  }
  console.log('\nすべて OK（コンソールエラー 0 件）');
})();
