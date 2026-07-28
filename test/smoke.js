/* =========================================================
   BLAST RUSH — ヘッドレス動作確認
     node test/smoke.js
   静的サーバーを立てて Chromium で一通り遊び、
   コンソールエラーが出ないこと・60fps 出ることを確認する。
   スクリーンショットは test/screenshots/ に出る。
   ========================================================= */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'screenshots');
const PORT = 8901;

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

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await serve();
  const exe = chromiumPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 700, height: 800 } });

  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '')));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const shot = n => page.screenshot({ path: path.join(SHOTS, n) });
  const snap = () => page.evaluate(() => ({
    state: BM.game.state, stage: BM.game.stage, score: BM.game.score,
    enemies: BM.game.enemies.length, bombs: BM.game.bombs.length,
    blocks: BM.game.map.blockCells().length,
    lives: BM.game.players[0] && BM.game.players[0].lives
  }));
  const check = (label, cond) => {
    console.log((cond ? '  ok   ' : '  FAIL ') + label);
    if (!cond) errors.push('ASSERT FAILED: ' + label);
  };

  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForTimeout(500);
  await shot('01-title.png');
  check('タイトルが表示される', await page.isVisible('button[data-act="solo"]'));

  // ---- 1P 開始 ----
  await page.click('button[data-act="solo"]');
  await page.waitForTimeout(400);
  const s = await snap();
  console.log('  開始:', JSON.stringify(s));
  check('プレイ状態になる', s.state === 'play');
  check('敵が湧いている', s.enemies > 0);
  check('ソフトブロックがある', s.blocks > 10);

  // ---- 実際にキー入力で歩いて爆弾を置く ----
  await page.evaluate(() => {
    const p = BM.game.players[0];
    p.power = 5; p.maxBombs = 5; p.speedLv = 2; p.kick = true; p.invuln = 9999;
  });
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
  for (let i = 0; i < 32; i++) {
    const k = keys[i % keys.length];
    await page.keyboard.down(k);
    await page.waitForTimeout(120);
    await page.keyboard.press(' ');
    await page.waitForTimeout(180);
    await page.keyboard.up(k);
    if (i === 10) await shot('02-play.png');
  }
  const s2 = await snap();
  console.log('  プレイ後:', JSON.stringify(s2));
  check('爆弾でブロックが壊れている', s2.blocks < s.blocks);
  check('スコアが入っている', s2.score > 0);

  // ---- 連鎖爆発 ----
  await page.evaluate(() => {
    const g = BM.game, p = g.players[0];
    p.power = 5; p.maxBombs = 8; p.pierce = true;
    const free = g.map.freeCells(false);
    for (let i = 0; i < 5; i++) {
      const c = free[Math.floor(Math.random() * free.length)];
      if (g.bombAt(c.x, c.y)) continue;
      const b = new BM.Bomb(c.x, c.y, p);
      b.fuse = 0.25 + i * 0.08;
      p.activeBombs++; g.bombs.push(b);
    }
  });
  await page.waitForTimeout(430);
  await shot('03-boom.png');
  await page.waitForTimeout(900);

  // ---- 出口 → ステージクリア ----
  await page.evaluate(() => {
    const g = BM.game;
    g.enemies.length = 0;
    for (const k in g.hidden) {
      if (g.hidden[k].door) { const n = Number(k); g.breakBlock(n % BM.COLS, Math.floor(n / BM.COLS), g.players[0]); break; }
    }
  });
  await page.waitForTimeout(600);
  check('敵全滅で出口が開く', await page.evaluate(() => !!(BM.game.door && BM.game.door.open)));
  await shot('04-door.png');

  await page.evaluate(() => {
    const g = BM.game;
    g.players[0].x = BM.centerOf(g.door.cx);
    g.players[0].y = BM.centerOf(g.door.cy);
  });
  await page.waitForTimeout(400);
  const s3 = await snap();
  check('出口に入るとクリアになる', s3.state === 'clear');
  check('クリアボーナスが入る', s3.score > s2.score);
  await shot('05-clear.png');

  await page.click('button[data-act="next"]');
  await page.waitForTimeout(500);
  const s4 = await snap();
  check('次のステージへ進む', s4.state === 'play' && s4.stage === 2);
  check('スコアは持ち越される', s4.score >= s3.score);

  // ---- 敵AIの放置シミュレーション（bomber が出るステージ） ----
  await page.evaluate(() => BM.game.startStage(9, false));
  await page.waitForTimeout(9000);
  const s5 = await snap();
  console.log('  ステージ9 放置9秒:', JSON.stringify(s5));
  check('AI が自爆で全滅していない', s5.enemies > 0);
  await shot('06-stage9.png');

  // ---- 対戦モード ----
  await page.evaluate(() => { BM.game.toTitle(); BM.ui.showTitle(BM.game); });
  await page.waitForTimeout(200);
  await page.click('button[data-act="vs"]');
  await page.waitForTimeout(600);
  check('2P が生成される', await page.evaluate(() => BM.game.players.length === 2));
  await shot('07-vs.png');
  await page.evaluate(() => BM.game.hurtPlayer(BM.game.players[1]));
  await page.waitForTimeout(400);
  const vs = await page.evaluate(() => ({ state: BM.game.state, w1: BM.game.players[0].wins }));
  check('決着でラウンド結果が出る', vs.state === 'vsround' && vs.w1 === 1);
  await shot('08-vsround.png');

  // ---- フレームレート ----
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
