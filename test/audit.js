/* =========================================================
   DEEP FALL — 構造監査
     node test/audit.js

   このゲームは無限に続くので「最後」が無い。
   代わりに次の3つで「最後まで大丈夫か」に答える。

     1. 難易度カーブがどこで飽和して最終形になるかを出す
     2. その最終形を含む広い深度範囲の全層について、
        生成の不変条件を1層ずつ検査する（描画も物理も通さない静的検査）
     3. 実際に無敵で長時間潜り、本来なら死んでいた地点を記録する

   静的検査は実プレイの数万倍の深度を一瞬で見られるが、
   「生成器が自分のルールを守っているか」しか分からない。
   実プレイ検査は遅いが、物理・当たり判定・カメラまで含めて見られる。
   両方やって初めて「最後まで」と言える。
   ========================================================= */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8921;
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

/* ページ内で走る静的検査。世界を生成して、層ごとに不変条件を確かめる。 */
function auditWorld(maxRow) {
  const L = BM.PLAY_L, R = BM.PLAY_R, TILE = BM.TILE;
  const reachTiles = (rows, vt, ms) => (ms * (rows * TILE / vt) * BM.REACH_MARGIN) / TILE;

  const fail = { reach: [], blocked: [], tooFast: [], narrow: [], offscreen: [], button: [] };
  let layers = 0, byType = {};

  const w = new BM.World();
  w.reset();

  // 生成しては検査して捨てる（メモリを増やさない）
  let prevExit = { lo: 7, hi: 7, free: false, row: 0 };
  const CHUNK = 2000;
  for (let base = 0; base < maxRow; base += CHUNK) {
    w.ensure(base + CHUNK);
    for (const l of w.layers) {
      if (l.audited) continue;
      l.audited = true;
      layers++;
      byType[l.type] = (byType[l.type] || 0) + 1;

      const vt = w.vTerm(l.row);
      const ms = w.moveSpeed(l.row);
      const drop = l.row - prevExit.row;
      const reach = reachTiles(drop, vt, ms);

      // --- 1. 前の層の出口から届くか ---
      // プレイヤーの x は縦坑の中に固定されるので、出口も盤内に丸めて測る。
      // 丸めずに測ると、壁にはみ出した分まで「行かなければならない」と誤判定する。
      const lo = BM.clamp(Math.min(l.exit[0], l.exit[1]), L, R);
      const hi = BM.clamp(Math.max(l.exit[0], l.exit[1]), L, R);
      const win = prevExit.free
        ? [prevExit.lo - reach, prevExit.hi + reach]
        : [prevExit.hi - reach, prevExit.lo + reach];
      if (hi < win[0] - 0.01 || lo > win[1] + 0.01) {
        if (fail.reach.length < 5) fail.reach.push({ row: l.row, type: l.type, exit: [lo, hi], win, reach: +reach.toFixed(2), drop });
      }

      // --- 2. どの瞬間にも通れる場所があるか（動く層は位相を総なめ） ---
      const check = cells => {
        for (let c = L; c <= R; c++) if (cells[c] !== BM.T_ROCK && cells[c] !== BM.T_BOMB) return true;
        return false;
      };
      if (l.buttons) {
        // 全面岩。ボタンで開けるので通れなくて正しい。代わりにボタンの到達性を見る
        const near = l.buttons.map(b => Math.min(Math.abs(b.col - prevExit.lo), Math.abs(b.col - prevExit.hi)));
        const worst = Math.min(...l.buttons.map(b =>
          Math.max(Math.abs(b.col - prevExit.lo), Math.abs(b.col - prevExit.hi))));
        const btnDrop = l.buttons[0].row - prevExit.row;
        const btnReach = reachTiles(btnDrop, vt, ms);
        if (worst > btnReach + 0.01 && Math.min(...near) > btnReach + 0.01) {
          if (fail.button.length < 5) fail.button.push({ what: 'ボタンに届かない', row: l.row, worst, btnReach: +btnReach.toFixed(2), btnDrop });
        }
        // 押したあと、穴まで横断する時間があるか
        const holeDist = Math.max(Math.abs(l.holeCol - L), Math.abs(l.holeCol - R));
        const holeReach = reachTiles(l.row - l.buttons[0].row, vt, ms);
        if (holeDist > holeReach + 0.01) {
          if (fail.button.length < 5) fail.button.push({ what: 'ボタンから穴に届かない', row: l.row, holeDist, holeReach: +holeReach.toFixed(2) });
        }
      } else if (l.dynamic && l.refresh) {
        const save = l.cells;
        for (let k = 0; k < 64; k++) {
          l.refresh(k / 64 * (Math.PI * 2) / Math.abs(l.speed || 1));
          if (!check(l.cells)) { if (fail.blocked.length < 5) fail.blocked.push({ row: l.row, type: l.type, phase: k }); break; }
        }
        l.cells = save;
      } else if (l.cells && !check(l.cells)) {
        if (fail.blocked.length < 5) fail.blocked.push({ row: l.row, type: l.type });
      }

      // --- 3. 動く穴がプレイヤーより速く逃げないか ---
      if (l.dynamic && l.speed) {
        const span = l.range ? (l.range[1] - l.range[0]) : (l.amp ? l.amp * 2 : 0);
        const vpx = Math.abs(l.speed) * (span / 2) * TILE;
        if (vpx > ms) {
          if (fail.tooFast.length < 5) fail.tooFast.push({ row: l.row, type: l.type, vpx: Math.round(vpx) });
        }
      }

      // --- 4. 穴が狭すぎないか（当たり判定 24px に対し 1マス=40px は許容±8px） ---
      if (l.cells && !l.buttons) {
        let best = 0, run = 0;
        for (let c = L; c <= R + 1; c++) {
          if (c <= R && l.cells[c] !== BM.T_ROCK && l.cells[c] !== BM.T_BOMB) run++;
          else { best = Math.max(best, run); run = 0; }
        }
        if (best < 2 && l.type !== 'crack') {
          if (fail.narrow.length < 5) fail.narrow.push({ row: l.row, type: l.type, best });
        }
      }

      // --- 5. 「次に反応すべきもの」が、間に合ううちに画面へ入るか ---
      // ボタン層で反応すべきなのは岩の壁ではなく、その手前にあるボタン。
      // 岩の位置で測ると、ボタンを見てから動く時間を無視して落第にしてしまう。
      const targetRow = l.buttons ? l.buttons[0].row : l.row;
      const camAbove = BM.VIEW_H * 0.30 - Math.min(120, vt * 0.14);
      const below = BM.VIEW_H - camAbove;
      if ((targetRow - prevExit.row) * TILE > below) {
        if (fail.offscreen.length < 5) {
          fail.offscreen.push({
            row: l.row, type: l.type,
            need: (targetRow - prevExit.row) * TILE, below: Math.round(below),
            prev: prevExit.type, prevExitW: +(prevExit.hi - prevExit.lo).toFixed(1),
            extra: l.extraRows || 0
          });
        }
      }

      prevExit = { lo, hi, free: !!l.exitFree, row: l.row, type: l.type };
    }
    // 検査済みを捨てる
    w.prune(base + CHUNK - 4);
  }
  return { layers, byType, fail };
}

(async () => {
  const srv = await serve();
  const exe = chromiumPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 700, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForTimeout(400);

  const line = s => console.log(s);
  const bad = [];
  const check = (label, cond, detail) => {
    line((cond ? '  ok   ' : '  FAIL ') + label + (detail ? '  ' + detail : ''));
    if (!cond) bad.push(label);
  };

  /* ===== 1. 難易度カーブはどこで最終形になるか ===== */
  line('\n=== 1. 難易度カーブ ===');
  const curve = await page.evaluate(() => {
    const w = new BM.World();
    const rows = [0, 50, 100, 200, 300, 400, 500, 1000, 5000, 50000];
    return rows.map(r => {
      const c = w.difficulty(r);
      const vt = w.vTerm(r);
      return {
        m: r, vt: Math.round(vt), spacing: c.spacing,
        sec: +(c.gapTime).toFixed(2), gapW: c.gapW,
        ms: Math.round(c.moveSpeed),
        reach: +((c.moveSpeed * c.gapTime * BM.REACH_MARGIN) / BM.TILE).toFixed(2)
      };
    });
  });
  line('   深度     落下速度  横移動速度  層間    層間   穴幅  層間に横断できる幅');
  line('             (px/s)    (px/s)    (行)    (秒)  (マス)     (マス)');
  curve.forEach(c => line(
    `  ${String(c.m + 'm').padStart(7)}  ${String(c.vt).padStart(8)} ${String(c.ms).padStart(9)} ` +
    `${String(c.spacing).padStart(7)} ${String(c.sec).padStart(7)} ${String(c.gapW).padStart(5)} ` +
    `${String(c.reach).padStart(10)}`));
  const last = curve[curve.length - 1], at400 = curve.find(c => c.m === 400);
  check('400m 以降はカーブが飽和して変化しない（=そこから先は同じ構造の繰り返し）',
    at400.spacing === last.spacing && at400.gapW === last.gapW && at400.vt === last.vt && at400.ms === last.ms);
  check('最終形でも穴の幅より横移動の幅が広い',
    last.reach > last.gapW, `(${last.reach} > ${last.gapW})`);

  /* ===== 2. 静的検査：広い深度範囲の全層 ===== */
  const MAX_ROW = 200000;   // 20万m 相当
  line(`\n=== 2. 静的検査（深度 0〜${MAX_ROW}m の全層）===`);
  const t0 = Date.now();
  const res = await page.evaluate(auditWorld, MAX_ROW);
  line(`  ${res.layers.toLocaleString('en-US')} 層を ${((Date.now() - t0) / 1000).toFixed(1)} 秒で検査`);
  line('  内訳: ' + JSON.stringify(res.byType));
  check('前の層の出口から必ず届く', res.fail.reach.length === 0,
    res.fail.reach.length ? JSON.stringify(res.fail.reach[0]) : '');
  check('どの瞬間にも通れる場所がある（動く層は位相を64分割して総なめ）',
    res.fail.blocked.length === 0, res.fail.blocked.length ? JSON.stringify(res.fail.blocked[0]) : '');
  check('動く穴はプレイヤーの横移動より遅い', res.fail.tooFast.length === 0,
    res.fail.tooFast.length ? JSON.stringify(res.fail.tooFast[0]) : '');
  check('穴は必ず2マス以上', res.fail.narrow.length === 0,
    res.fail.narrow.length ? JSON.stringify(res.fail.narrow[0]) : '');
  check('次の層は常に画面内に入る', res.fail.offscreen.length === 0,
    res.fail.offscreen.length ? JSON.stringify(res.fail.offscreen[0]) : '');
  check('ボタンに届き、押したあと穴にも届く', res.fail.button.length === 0,
    res.fail.button.length ? JSON.stringify(res.fail.button[0]) : '');

  /* ===== 3. 実プレイ検査：無敵で長時間潜る ===== */
  const PLAY_SEC = 120;
  line(`\n=== 3. 実プレイ検査（無敵・自動操縦で ${PLAY_SEC} 秒）===`);
  const pilotSrc = fs.readFileSync(path.join(__dirname, 'smoke.js'), 'utf8');
  const inject = pilotSrc.slice(pilotSrc.indexOf('function installPilot()'), pilotSrc.indexOf('(async () => {'));
  await page.evaluate('(' + inject.trim() + ')()');
  await page.evaluate(() => {
    BM.game.newRun(); BM.ui.hide();
    BM.game.noDeath = true;
    BM.game.deathLog = [];
    window.__passed = 0;
    window.__fps = []; window.__mem = [];
    let n = 0, t0 = performance.now();
    (function tick() {
      n++;
      const dt = performance.now() - t0;
      if (dt >= 1000) {
        window.__fps.push(Math.round(n / (dt / 1000)));
        window.__mem.push(BM.game.world.layers.length);
        n = 0; t0 = performance.now();
      }
      requestAnimationFrame(tick);
    })();
  });
  await page.waitForTimeout(PLAY_SEC * 1000);
  const play = await page.evaluate(() => ({
    depth: BM.game.player.deepest,
    passed: window.__passed,
    log: BM.game.deathLog.map(d => ({ depth: d.depth, type: d.type })),
    fps: window.__fps, mem: window.__mem,
    y: BM.game.player.y, camY: BM.game.camY, score: BM.game.score
  }));
  const per100 = play.log.length / Math.max(1, play.passed) * 100;
  line(`  到達 ${play.depth}m / ${play.passed} 層を通過 / スコア ${play.score.toLocaleString('en-US')}`);
  line(`  本来なら死んでいた地点: ${play.log.length} 件 (100層あたり ${per100.toFixed(2)} 件)`);
  if (play.log.length) {
    const t = {}, b = {};
    play.log.forEach(d => { t[d.type] = (t[d.type] || 0) + 1; b[Math.floor(d.depth / 200) * 200] = (b[Math.floor(d.depth / 200) * 200] || 0) + 1; });
    line('    地層別: ' + JSON.stringify(t));
    line('    深度帯別: ' + JSON.stringify(b));
  }
  const fpsMin = Math.min(...play.fps), fpsAvg = play.fps.reduce((a, b) => a + b, 0) / play.fps.length;
  const memMax = Math.max(...play.mem);
  line(`  fps 最低/平均: ${fpsMin} / ${fpsAvg.toFixed(1)}    保持している層の最大数: ${memMax}`);
  check('飽和後の深度まで通しても詰まらない', play.depth >= 900 && per100 < 1,
    `(${play.depth}m, ${per100.toFixed(2)}件/100層)`);
  check('長時間でもフレームレートが落ちない', fpsMin >= 50, `(最低 ${fpsMin}fps)`);
  check('層が際限なく溜まらない（メモリ）', memMax <= 60, `(最大 ${memMax} 層保持）`);
  check('深い座標でも数値が壊れない',
    Number.isFinite(play.y) && Number.isFinite(play.camY) && play.y > 0, `(y=${Math.round(play.y)})`);

  await browser.close();
  srv.close();

  line('');
  if (errors.length) { line('コンソールエラー:\n' + errors.join('\n')); bad.push('コンソールエラー'); }
  if (bad.length) { line(`=== ${bad.length} 件の問題 ===\n` + bad.join('\n')); process.exit(1); }
  line('監査完了：問題なし');
})();
