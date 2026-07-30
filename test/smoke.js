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
  BM.ads.enabled = false;   // 自動走行の邪魔になるので広告は止める
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

  /* ---- ゲームオーバー時の広告 ----
     出ること・スキップできること・結果画面に必ず戻ることを確かめる。
     広告のせいで結果が見られなくなるのが一番まずい。 */
  await page.evaluate(() => {
    BM.ads.everyN = 1; BM.ads.minGapMs = 0; BM.ads.skipAfter = 1;
    BM.ads._count = 0; BM.ads._lastAt = 0;
    BM.game.newRun(); BM.ui.hide();
    BM.game.crash(BM.game.player, 7, BM.rowOf(BM.game.player.y));
  });
  await page.waitForTimeout(300);
  check('ゲームオーバーで広告枠が出る', await page.isVisible('#ad-slot'));
  check('「広告」と明示されている',
    (await page.textContent('.ad-label')) === '広告');
  check('出た直後はスキップできない', await page.evaluate(() => document.getElementById('ad-skip').disabled));
  await shot('07-ad.png');
  await page.waitForTimeout(1400);
  check('一定秒後にスキップできるようになる',
    await page.evaluate(() => !document.getElementById('ad-skip').disabled));
  await page.click('#ad-skip');
  await page.waitForTimeout(200);
  check('スキップすると結果画面が出る',
    (await page.textContent('#panel')).indexOf('到達深度') >= 0);
  check('広告が消えている', !(await page.isVisible('#ad-slot')));
  await shot('08-result.png');

  // 頻度制御。毎回出したら邪魔なだけ
  check('everyN=2 なら次のゲームオーバーでは出ない', await page.evaluate(() => {
    BM.ads.everyN = 2; BM.ads._count = 0; BM.ads._lastAt = 0;
    BM.game.newRun(); BM.ui.hide();
    BM.game.crash(BM.game.player, 7, BM.rowOf(BM.game.player.y));
    return !document.getElementById('ad-slot');
  }));
  check('?noads=1 で広告を止められる', await page.evaluate(() => {
    BM.ads.enabled = false;
    BM.ads.everyN = 1; BM.ads._count = 0; BM.ads._lastAt = 0;
    BM.game.newRun(); BM.ui.hide();
    BM.game.crash(BM.game.player, 7, BM.rowOf(BM.game.player.y));
    const ok = !document.getElementById('ad-slot');
    BM.ads.enabled = true;
    return ok;
  }));

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
    log: BM.game.deathLog.map(d => ({ depth: d.depth, row: d.row, type: d.type, cells: d.cells }))
  }));
  await shot('06-inspect.png');
  await page.evaluate(() => { BM.game.noDeath = false; });

  /* 数えるのは「抜けられなかった層の数」。同じ層の中で岩に何回触ったかを
     数えると、1枚の壁が何十件にも化けて実態が分からなくなる。 */
  const jamRows = [...new Set(insp.log.map(d => d.row))];
  const firstOf = r => insp.log.find(d => d.row === r);
  const per100 = jamRows.length / Math.max(1, insp.passed) * 100;
  console.log(`  到達 ${insp.depth}m / ${insp.passed} 層を通過 / 抜けられなかった層 ${jamRows.length}` +
              ` (接触 ${insp.log.length} 回, 100層あたり ${per100.toFixed(1)} 層)`);
  if (jamRows.length) {
    const byType = {}, byBand = {};
    jamRows.map(firstOf).forEach(d => {
      byType[d.type] = (byType[d.type] || 0) + 1;
      const band = Math.floor(d.depth / 100) * 100;
      byBand[band] = (byBand[band] || 0) + 1;
    });
    console.log('    地層別:', JSON.stringify(byType));
    console.log('    深度帯別:', JSON.stringify(byBand));
    console.log('    最初の3層:', JSON.stringify(jamRows.slice(0, 3).map(firstOf)));
  }
  check(`最深部まで通しても構造が破綻しない（${insp.depth}m まで確認）`, insp.depth >= 400);
  check('抜けられない層が100層あたり2層未満', per100 < 2);

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

  /* ---- 200m ごとのご褒美の間 ----
     深さに終わりが無いので、ここが抜けると「潜る理由」が無くなる。
     節目が1つでも欠けていないこと・そこでは絶対に死なないことを見る。 */
  console.log('  --- ご褒美の間（200m ごと・底なし）---');
  const MC = await page.evaluate(() => ({
    rows: BM.MILESTONE_ROWS, bonus: BM.MILESTONE_BONUS, kinds: BM.REWARDS.length + 1
  }));
  const ms = await page.evaluate(() => {
    const w = new BM.World(); w.reset();
    // ensure() は1回で作る層数に上限があるので、少しずつ伸ばす
    for (let r = 600; r <= 6000; r += 600) w.ensure(r);
    const heads = w.layers.filter(l => l.reward).map(l => ({
      depth: l.reward.depth, kind: l.kind.key, bonus: l.reward.bonus, row: l.row
    }));
    const rew = w.layers.filter(l => l.type === 'reward');
    // 節目ごとに何枚開いているか
    const span = {};
    rew.forEach(l => { const m = Math.floor(l.row / BM.MILESTONE_ROWS); span[m] = (span[m] || 0) + 1; });
    // 全マス空か（＝そこでは死ねない）
    const notOpen = rew.filter(l => {
      for (let c = BM.PLAY_L; c <= BM.PLAY_R; c++) if (l.cells[c] !== BM.T_EMPTY) return true;
      return false;
    }).length;
    // 結晶が「落ちながら追える」間隔に並んでいるか
    let coinTooFar = 0, coinPairs = 0;
    rew.forEach(l => {
      const coins = l.items.filter(i => i.type === 'COIN').sort((a, b) => a.row - b.row);
      for (let i = 1; i < coins.length; i++) {
        const drow = coins[i].row - coins[i - 1].row;
        const reach = w.moveSpeed(l.row) * (drow * BM.TILE / w.vTerm(l.row)) / BM.TILE;
        coinPairs++;
        if (Math.abs(coins[i].col - coins[i - 1].col) > reach) coinTooFar++;
      }
    });
    return { heads, span, notOpen, coinTooFar, coinPairs };
  });
  const miles = ms.heads.map(h => h.depth);
  const wantMiles = [];
  for (let m = MC.rows; m <= 6000 - MC.rows; m += MC.rows) wantMiles.push(m);
  const missing = wantMiles.filter(m => miles.indexOf(m) < 0);
  console.log(`  節目 ${miles.length} 個: ${miles.slice(0, 8).join(', ')} ... ${miles.slice(-2).join(', ')}`);
  console.log('  中身:', JSON.stringify(ms.heads.slice(0, 10).map(h => h.depth + ':' + h.kind)));
  check(`${MC.rows}m ごとに必ずご褒美がある（欠け ${missing.length} 個）`, missing.length === 0);
  check('ご褒美の間は全マス空＝そこでは死なない', ms.notOpen === 0);
  const kinds = new Set(ms.heads.map(h => h.kind));
  check(`中身が${MC.kinds}種すべて出る（${[...kinds].join(',')}）`, kinds.size === MC.kinds);
  const bigs = ms.heads.filter(h => h.kind === 'cavern').map(h => h.depth);
  check(`1000m ごとが大空洞（${bigs.slice(0, 5).join(', ')}）`,
    bigs.length > 0 && bigs.every(d => d % 1000 === 0));
  check(`結晶が落ちながら追える間隔（${ms.coinPairs} 組中 ${ms.coinTooFar} 組が届かない）`, ms.coinTooFar === 0);
  check('節目ごとにボーナスが増える',
    ms.heads.length > 3 && ms.heads[1].bonus > ms.heads[0].bonus);

  // 底なし＝どんなに深くても節目が来る
  const deepMile = await page.evaluate(() => {
    const w = new BM.World(); w.reset();
    w.nextRow = 100000; w.lastRow = 100000; w.mileDone = Math.floor(100000 / BM.MILESTONE_ROWS);
    w.ensure(100600);
    const h = w.layers.filter(l => l.reward).map(l => ({ depth: l.reward.depth, kind: l.kind.key }));
    return h;
  });
  console.log('  100,000m 付近:', JSON.stringify(deepMile));
  check('10万m 付近でもご褒美が生成される（底なし）', deepMile.length >= 2);

  // 実プレイで本当に効くか（爆弾が満タンになる・点が入る）
  const grant = await page.evaluate(async () => {
    const g = BM.game;
    g.newRun(); BM.ui.hide();
    g.noDeath = true;
    g.player.bombs = 0;
    // 200m の直前まで一気に落とす
    const row = 200 - 4;
    g.player.y = row * BM.TILE;
    g.camY = g.player.y - BM.VIEW_H * 0.3;
    g.world.reset();
    g.world.nextRow = row - 12; g.world.lastRow = row - 12;
    g.world.mileDone = 0;
    g.world.ensure(row + 60);
    const before = { bombs: g.player.bombs, score: g.score };
    for (let i = 0; i < 900; i++) g.update(1 / 120);
    g.noDeath = false;
    return { before, bombs: g.player.bombs, score: g.score, depth: g.player.deepest,
             gotToast: !!document.querySelector('#reward-toast .rw-name'),
             toast: (document.querySelector('#reward-toast .rw-name') || {}).textContent || '' };
  });
  console.log(`  実プレイ: 爆弾 ${grant.before.bombs}→${grant.bombs} / 点 ${grant.before.score}→${grant.score}` +
              ` / ${grant.depth}m / トースト「${grant.toast}」`);
  check('ご褒美を通ると実際に補給される', grant.bombs > grant.before.bombs);
  check(`到達ボーナス ${MC.bonus} が入る`, grant.score >= grant.before.score + MC.bonus);
  check('もらった内容が画面に出る', grant.gotToast);

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
