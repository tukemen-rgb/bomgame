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

/* テストは本体に載っている自動操縦（js/autopilot.js）をそのまま使う。
   テスト専用の複製を持つと、検査に通ったものと出荷されるものが別物になる。
   ここでは通過数と墜落地点を数えるフックだけを足す。 */
function installPilot() {
  window.__deaths = [];
  window.__passed = 0;
  BM.autopilot.enabled = true;
  const orig = BM.Game.prototype.update;
  BM.Game.prototype.update = function (dt) {
    const was = this.player.alive;
    const n0 = this.passedCount;
    const r = orig.call(this, dt);
    window.__passed += this.passedCount - n0;
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
  check('全走行が 60m 以上（=詰む生成が無い）', depths[0] >= 60);
  check('中央値 100m 以上（=抜け道が続いている）', median >= 100);

  const deaths = await page.evaluate(() => window.__deaths);
  const byType = {};
  deaths.forEach(d => { byType[d.type] = (byType[d.type] || 0) + 1; });
  console.log('  墜落した地層:', JSON.stringify(byType));

  /* ---- 構造の通し確認 ----
     無敵にして最後まで潜り、「本来なら死んでいた地点」を全部記録する。
     途中で終わると、その先の構造が永久に検査されない。深いほど層の間隔も
     穴の幅も詰まるので、浅いところだけ見ても意味がない。 */
  const INSPECT_SEC = 70;
  console.log(`  --- 構造の通し確認（無敵で ${INSPECT_SEC} 秒）---`);
  await page.evaluate(() => {
    BM.game.newRun(); BM.ui.hide();
    BM.game.noDeath = true;
    BM.game.deathLog = [];
    window.__passed = 0;
  });
  await page.waitForTimeout(INSPECT_SEC * 1000);
  const insp = await page.evaluate(() => ({
    depth: BM.game.player.deepest,
    passed: window.__passed,
    log: BM.game.deathLog.map(d => ({ depth: d.depth, type: d.type, cells: d.cells }))
  }));
  await shot('06-inspect.png');
  await page.evaluate(() => { BM.game.noDeath = false; });

  const per100 = insp.log.length / Math.max(1, insp.passed) * 100;
  console.log(`  到達 ${insp.depth}m / ${insp.passed} 層を通過 / 詰まり ${insp.log.length} 件` +
              ` (100層あたり ${per100.toFixed(1)} 件)`);
  if (insp.log.length) {
    const byType = {}, byBand = {};
    insp.log.forEach(d => {
      byType[d.type] = (byType[d.type] || 0) + 1;
      const band = Math.floor(d.depth / 100) * 100;
      byBand[band] = (byBand[band] || 0) + 1;
    });
    console.log('    地層別:', JSON.stringify(byType));
    console.log('    深度帯別:', JSON.stringify(byBand));
    console.log('    最初の3件:', JSON.stringify(insp.log.slice(0, 3)));
  }
  check(`最深部まで通しても構造が破綻しない（${insp.depth}m まで確認）`, insp.depth >= 400);
  check('詰まりが100層あたり2件未満', per100 < 2);

  /* ---- 地層の種類ごとに、本当に最後まで通れるか ----
     1種類だけを並べた縦坑を作り、自動操縦で潜らせる。
     どれか1つでも抜けられない型があれば、そこがゲームの穴になる。 */
  const TYPES = ['gap', 'twin', 'crack', 'crackmix', 'shutter', 'gate', 'button', 'bombrock', 'spinner'];
  console.log('  --- 地層ごとの通過試験（各12秒）---');
  for (const type of TYPES) {
    await page.evaluate(ty => {
      BM.game.newRun();
      BM.game.world.reset();
      BM.game.world.debugType = ty;
      BM.game.world.ensure(BM.rowOf(BM.game.camY) + BM.VIEW_ROWS + 24);
      window.__passed = 0;
      BM.ui.hide();
    }, type);
    await page.waitForTimeout(12000);
    const st = await page.evaluate(() => ({
      passed: window.__passed, alive: BM.game.player.alive, depth: BM.game.player.deepest
    }));
    // ボタン層は落差を大きく取るぶん通過数が少ないので、本質は「墜落しないこと」
    check(`${type.padEnd(9)} を ${String(st.passed).padStart(2)} 層通過 / ${st.depth}m ${st.alive ? '無傷' : '墜落'}`,
      st.alive && st.passed >= 3);
  }
  await page.evaluate(() => { BM.game.world.debugType = null; });

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

  /* ---- 次の層が、反応する前に画面に入っているか ----
     層の間隔を「時間」で決めた結果、深部では行間が広がる。
     カメラの先読みが足りないと、次の層が見えないまま突っ込むことになる。 */
  check('どの深度でも次の層は画面内に見えている', await page.evaluate(() => {
    const w = new BM.World();
    let worst = 0, bad = 0;
    for (let rows = 0; rows <= 600; rows += 10) {
      const cfg = w.difficulty(rows);
      const vt = w.vTerm(rows);
      const camAbove = BM.VIEW_H * 0.30 - Math.min(120, vt * 0.14);
      const below = BM.VIEW_H - camAbove;          // プレイヤーより下に見える範囲
      const need = cfg.spacing * BM.TILE;          // 次の層までの距離
      worst = Math.max(worst, need / below);
      if (need > below * 0.95) bad++;
    }
    window.__camWorst = worst;
    return bad === 0;
  }));
  console.log('  次の層までの距離 / 見えている範囲 の最悪値:',
    (await page.evaluate(() => window.__camWorst)).toFixed(2));

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

  /* ---- シールド ----
     持っていれば岩に触れても死なず、そのぶん1枚減る。
     厚い層で複数枚まとめて消えないよう、発動直後は無敵時間がある。
     ※ここでは自動操縦が爆弾で掘り抜けてしまわないよう、手持ちを0にしている */
  const solidAt = (off, rows) => page.evaluate(({ off, rows }) => {
    const g = BM.game;
    const base = BM.rowOf(g.player.y) + off;
    for (let k = 0; k < rows; k++) {
      const row = base + k;
      const cells = new Uint8Array(BM.COLS).fill(BM.T_ROCK);
      const l = { row, type: 'test', cells, gapX: 7, t: 0, phase: 0, exit: [7, 7], passed: false, item: null, buttons: null, dynamic: false };
      g.world.layers.push(l); g.world.byRow[row] = l;
    }
  }, { off, rows });

  await page.evaluate(() => { BM.game.newRun(); BM.ui.hide(); BM.game.player.shield = 2; BM.game.player.bombs = 0; });
  await page.waitForTimeout(400);
  await solidAt(4, 1);
  await page.waitForTimeout(900);
  const sh1 = await page.evaluate(() => ({
    alive: BM.game.player.alive, shield: BM.game.player.shield, state: BM.game.state
  }));
  check('シールドがあれば岩に触れても生存する', sh1.alive && sh1.state === 'play');
  check('発動でシールドが1枚減る', sh1.shield === 1);
  await shot('05-shield.png');

  // 2行ぶんの厚い岩を、残り1枚で抜けられるか（無敵時間が効いているか）
  await page.evaluate(() => { BM.game.newRun(); BM.ui.hide(); BM.game.player.shield = 1; BM.game.player.bombs = 0; });
  await page.waitForTimeout(400);
  await solidAt(5, 2);
  await page.waitForTimeout(1100);
  const sh2 = await page.evaluate(() => ({ alive: BM.game.player.alive, shield: BM.game.player.shield }));
  check('厚い岩でもシールドの消費は1枚だけ', sh2.alive && sh2.shield === 0);

  // シールド無しなら同じ状況で墜落する（対照）
  await page.evaluate(() => { BM.game.newRun(); BM.ui.hide(); BM.game.player.shield = 0; BM.game.player.bombs = 0; });
  await page.waitForTimeout(400);
  await solidAt(4, 1);
  await page.waitForTimeout(900);
  check('シールド無しなら墜落する（対照）', await page.evaluate(() => BM.game.state === 'over'));

  check('シールドの残数がHUDに出ている', await page.evaluate(() => {
    BM.game.newRun(); BM.ui.hide();
    BM.game.player.shield = 2;
    BM.ui.syncHud(BM.game);
    return document.querySelectorAll('#shield-pips .pip.on').length === 2;
  }));

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
