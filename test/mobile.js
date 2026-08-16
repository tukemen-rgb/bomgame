/* =========================================================
   DEEP FALL — スマホでの動作確認
     node test/mobile.js

   実機を触る前に、機械で分かることは全部ここで潰しておく。
   実機でしか分からないのは「指の届く位置か」「重くないか」「音が出るか」
   くらいで、それ以外（レイアウトが崩れないか・タッチだけで操作できるか・
   ボタンが小さすぎないか）はここで確かめられる。

   一番大事なのは【タッチだけで実際に潜れるか】。
   キーボードで動くことは smoke で確認済みだが、
   タッチのイベント配線が切れていても smoke は全部通ってしまう。
   なので自動操縦の判断を「本物のボタンへの pointer イベント」に変換して、
   タッチの経路だけで潜らせる。
   ========================================================= */
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'screenshots');
const PORT = 8931;
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

/* 実機に近い組み合わせを並べる。縦持ちだけでなく横持ちも見る。
   横持ちは画面が低くなるので、HUD と操作ボタンが最初に壊れる形。 */
const PROFILES = [
  { name: 'iPhone SE 相当',  device: devices['iPhone SE'] },
  { name: 'iPhone 13',       device: devices['iPhone 13'] },
  { name: 'Pixel 7',         device: devices['Pixel 7'] },
  { name: 'iPhone 13 横',    device: devices['iPhone 13 landscape'] },
  { name: '小さめ 320x568',  device: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } }
];

// 指で押す的の最小寸法。Apple HIG は 44pt、WCAG 2.5.5 も 44px を目安にしている
const MIN_TAP = 44;

/* 自動操縦の判断を、本物のボタンへの pointer イベントに変える。
   キー入力を直接書き込む経路は毎フレーム消してから触るので、
   ここを通って動いたなら「タッチの配線が生きている」と言える。 */
function installTouchPilot() {
  const I = BM.input;
  const btn = k => document.querySelector('#touch .tbtn[data-key="' + (k === ' ' ? ' ' : k) + '"]');
  const held = {};
  window.__touch = { down: 0, up: 0, taps: 0 };

  function press(el, type) {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch' }));
  }

  const orig = BM.autopilot.step.bind(BM.autopilot);
  BM.autopilot.step = function (g) {
    orig(g);
    // 自動操縦が書いた意図を読み取り、キーは消す
    const want = I.keys['ArrowLeft'] ? 'ArrowLeft' : (I.keys['ArrowRight'] ? 'ArrowRight' : null);
    const bomb = !!I.just[' '];
    I.keys['ArrowLeft'] = I.keys['ArrowRight'] = false;
    I.just[' '] = false;

    ['ArrowLeft', 'ArrowRight'].forEach(k => {
      const el = btn(k);
      if (!el) return;
      if (k === want) {
        if (!held[k]) { press(el, 'pointerdown'); held[k] = true; window.__touch.down++; }
        // 押し続けている状態を毎フレーム作り直す。
        // 直接書き込みを消したままだと、次のフレームには無入力になってしまう
        else press(el, 'pointerdown');
      } else if (held[k]) { press(el, 'pointerup'); held[k] = false; window.__touch.up++; }
    });
    if (bomb) {
      const el = btn(' ');
      if (el) { press(el, 'pointerdown'); press(el, 'pointerup'); window.__touch.taps++; }
    }
  };
  BM.autopilot.enabled = true;
  BM.ads.enabled = false;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await serve();
  const exe = chromiumPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});

  const errors = [];
  const check = (label, cond, detail) => {
    console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail ? '  ' + detail : ''));
    if (!cond) errors.push('ASSERT FAILED: ' + label);
  };

  /* ===== 1. 端末ごとのレイアウト ===== */
  console.log('=== 1. 端末ごとのレイアウト ===');
  for (const prof of PROFILES) {
    const ctx = await browser.newContext(prof.device);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`PAGEERROR(${prof.name}): ` + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(`CONSOLE(${prof.name}): ` + m.text()); });
    await page.goto(`http://localhost:${PORT}/index.html?noads=1`);
    await page.waitForTimeout(400);
    await page.evaluate(() => { BM.game.newRun(); BM.ui.hide(); });
    await page.waitForTimeout(300);

    const r = await page.evaluate(min => {
      const se = document.scrollingElement;
      const btns = [...document.querySelectorAll('#touch .tbtn')].map(b => {
        const q = b.getBoundingClientRect();
        return { key: b.getAttribute('data-key'), w: Math.round(q.width), h: Math.round(q.height),
                 x: Math.round(q.x), y: Math.round(q.y), bottom: Math.round(q.bottom) };
      });
      // ボタン同士が重なっていないか（重なると誤爆する）
      let overlap = 0;
      for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
        const a = btns[i], b = btns[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap++;
      }
      const labs = [...document.querySelectorAll('.hud-label')].map(l => l.getBoundingClientRect());
      const cv = document.getElementById('game').getBoundingClientRect();
      const touch = document.getElementById('touch');
      return {
        vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
        touchShown: getComputedStyle(touch).display !== 'none',
        legendHidden: getComputedStyle(document.getElementById('legend')).display === 'none',
        hScroll: se.scrollWidth - se.clientWidth,
        vScroll: se.scrollHeight - se.clientHeight,
        btns, overlap,
        tooSmall: btns.filter(b => b.w < min || b.h < min).map(b => b.key + `(${b.w}x${b.h})`),
        offscreen: btns.filter(b => b.bottom > se.scrollHeight + 1 || b.x < 0 || b.x + b.w > innerWidth + 1)
                       .map(b => b.key),
        labelsVisible: labs.every(q => q.top >= 0 && q.left >= 0),
        canvasW: Math.round(cv.width), canvasH: Math.round(cv.height),
        canvasVisible: cv.top >= -1 && cv.width > 200,
        rotatePrompt: getComputedStyle(document.getElementById('rotate')).display !== 'none',
        landscape: innerWidth > innerHeight
      };
    }, MIN_TAP);

    console.log(`  --- ${prof.name} (${r.vw}x${r.vh} dpr${r.dpr}) ---`);
    console.log(`  ボタン: ${r.btns.map(b => b.key.trim() || 'BOMB').join(' ')} ` +
                `/ 最小 ${Math.min(...r.btns.map(b => Math.min(b.w, b.h)))}px ` +
                `/ 画面 ${r.canvasW}x${r.canvasH} / 横スクロール ${r.hScroll}px / 縦はみ出し ${r.vScroll}px`);
    check(`${prof.name}: タッチ操作が出る（キー凡例は隠れる）`, r.touchShown && r.legendHidden);
    check(`${prof.name}: 横スクロールが出ない`, r.hScroll <= 0, `(${r.hScroll}px)`);
    check(`${prof.name}: 押す的が ${MIN_TAP}px 以上`, r.tooSmall.length === 0, r.tooSmall.join(' '));
    check(`${prof.name}: ボタンが重なっていない`, r.overlap === 0);
    check(`${prof.name}: ボタンが画面の外に出ていない`, r.offscreen.length === 0, r.offscreen.join(' '));
    check(`${prof.name}: HUD のラベルが全部見える`, r.labelsVisible);
    check(`${prof.name}: ゲーム画面が見えている`, r.canvasVisible);
    if (r.landscape) {
      // 低い横持ちには縦坑が入らない。縮めるのではなく縦に持ち替えてもらう
      check(`${prof.name}: 横持ちなら「縦にして」と案内が出る`, r.rotatePrompt);
    } else {
      check(`${prof.name}: 案内は出さない（縦持ちなら遊べる）`, !r.rotatePrompt);
      check(`${prof.name}: スクロールなしで全部入る`, r.vScroll <= 0, `(はみ出し ${r.vScroll}px)`);
    }

    await page.screenshot({ path: path.join(SHOTS, 'mobile-' + prof.name.replace(/[^\w]/g, '_') + '.png') });
    await ctx.close();
  }

  /* ===== 2. タッチだけで潜れるか ===== */
  console.log('\n=== 2. タッチだけで潜れるか ===');
  {
    const ctx = await browser.newContext(devices['iPhone 13']);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    await page.goto(`http://localhost:${PORT}/index.html?noads=1`);
    await page.waitForTimeout(400);

    // タイトルの「落ちる」を実際にタップして始める
    await page.tap('button[data-act="play"]');
    await page.waitForTimeout(300);
    check('タイトルのボタンをタップして始められる',
      await page.evaluate(() => BM.game.state === 'play'));

    await page.evaluate(installTouchPilot);
    await page.evaluate(() => { BM.game.newRun(); BM.ui.hide(); });
    await page.waitForTimeout(16000);

    const st = await page.evaluate(() => ({
      depth: BM.game.player.deepest, alive: BM.game.player.alive,
      touch: window.__touch, score: BM.game.score
    }));
    console.log(`  到達 ${st.depth}m / ${st.alive ? '落下中' : '墜落'} / 点 ${st.score}` +
                ` / ボタン押下 ${st.touch.down} 回・離し ${st.touch.up} 回・爆弾 ${st.touch.taps} 回`);
    check('横移動ボタンが実際に押されている（配線が生きている）', st.touch.down > 10);
    check('タッチ操作だけで潜れる（60m 以上）', st.depth >= 60, `(${st.depth}m)`);
    check('タッチ操作で墜落せずに続いている', st.alive);
    await page.screenshot({ path: path.join(SHOTS, 'mobile-play.png') });

    /* 個別のボタンが本当にそれぞれの役目を果たしているか。
       横移動だけ通っていて急降下と爆弾が死んでいても、上の検査は通ってしまう。 */
    const each = await page.evaluate(async () => {
      const g = BM.game, I = BM.input;
      BM.autopilot.enabled = false;
      I.keys = {}; I.just = {};
      // ここで見たいのは入力の配線。落下中に岩に当たって死ぬと
      // 更新が止まって「ボタンが効かない」に見えるので、死なないようにする
      g.noDeath = true;
      const btn = k => document.querySelector('#touch .tbtn[data-key="' + k + '"]');
      const ev = (el, t) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerType: 'touch' }));

      // 急降下ボタン：押している間に落下が速くなるか
      g.newRun(); BM.ui.hide();
      for (let i = 0; i < 240; i++) g.update(1 / 120);
      const vy0 = g.player.vy;
      ev(btn('ArrowDown'), 'pointerdown');
      for (let i = 0; i < 60; i++) g.update(1 / 120);
      const vy1 = g.player.vy;
      ev(btn('ArrowDown'), 'pointerup');

      // 爆弾ボタン：残数が減って爆弾が出るか
      g.newRun(); BM.ui.hide();
      const b0 = g.player.bombs;
      ev(btn(' '), 'pointerdown'); ev(btn(' '), 'pointerup');
      g.update(1 / 120);
      const b1 = g.player.bombs, bombs = g.bombs.length;

      // 横移動ボタン：押した向きへ動くか
      g.newRun(); BM.ui.hide();
      const x0 = g.player.x;
      ev(btn('ArrowRight'), 'pointerdown');
      for (let i = 0; i < 60; i++) g.update(1 / 120);
      const xR = g.player.x;
      ev(btn('ArrowRight'), 'pointerup');
      for (let i = 0; i < 30; i++) g.update(1 / 120);
      const x1 = g.player.x;
      ev(btn('ArrowLeft'), 'pointerdown');
      for (let i = 0; i < 90; i++) g.update(1 / 120);
      const xL = g.player.x;
      ev(btn('ArrowLeft'), 'pointerup');

      // 指を離さずにボタンの外へ出た時：押したままにならないか（張り付き）
      g.newRun(); BM.ui.hide();
      const el = btn('ArrowRight');
      ev(el, 'pointerdown');
      el.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, cancelable: true, pointerType: 'touch' }));
      for (let i = 0; i < 60; i++) g.update(1 / 120);
      const stuck = I.keys['ArrowRight'] === true;

      g.noDeath = false;
      return { vy0: Math.round(vy0), vy1: Math.round(vy1),
               b0, b1, bombs,
               dxR: Math.round(xR - x0), dxL: Math.round(xL - x1), stuck,
               touchAmmo: (document.getElementById('touch-ammo') || {}).textContent };
    });
    console.log(`  急降下 ${each.vy0}→${each.vy1}px/s / 爆弾 ${each.b0}→${each.b1}（${each.bombs}個 落下中）` +
                ` / 右 ${each.dxR}px・左 ${each.dxL}px / 残数表示 ${each.touchAmmo}`);
    check('急降下ボタンで落下が速くなる', each.vy1 > each.vy0 + 40);
    check('爆弾ボタンで爆弾が出て残数が減る', each.b1 === each.b0 - 1 && each.bombs >= 1);
    check('右ボタンで右へ動く', each.dxR > 20);
    check('左ボタンで左へ動く', each.dxL < -20);
    check('ボタンの外へ指が出たら押したままにならない', each.stuck === false);
    check('爆弾ボタンに残数が出ている', /^\d$/.test(String(each.touchAmmo || '')));

    /* 結晶を拾えるか。落ちながら横へ寄せる操作が要るので、
       タッチで本当に狙えるのかは実機前に確かめておきたい。 */
    const coin = await page.evaluate(async () => {
      const g = BM.game, I = BM.input;
      g.newRun(); BM.ui.hide(); g.noDeath = true;
      I.keys = {}; I.just = {};
      const btn = k => document.querySelector('#touch .tbtn[data-key="' + k + '"]');
      const ev = (el, t) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerType: 'touch' }));
      // 3マス右の少し下に結晶を置く
      const row = BM.rowOf(g.player.y) + 8;
      const col = BM.colOf(g.player.x) + 3;
      const layer = g.world.layers[0];
      layer.items.push({ col, row, type: 'COIN', t: 0, alive: true });
      const before = g.score;
      const target = BM.centerX(col);
      // 右ボタンを押して、着いたら離す（実機で人がやる操作と同じ）
      ev(btn('ArrowRight'), 'pointerdown');
      let held = true;
      for (let i = 0; i < 400; i++) {
        if (held && g.player.x >= target - 4) { ev(btn('ArrowRight'), 'pointerup'); held = false; }
        g.update(1 / 120);
      }
      if (held) ev(btn('ArrowRight'), 'pointerup');
      g.noDeath = false;
      return { got: !layer.items[layer.items.length - 1].alive, gained: g.score - before };
    });
    console.log(`  結晶: ${coin.got ? '拾えた' : '拾えなかった'} (+${coin.gained})`);
    check('タッチ操作で結晶を拾える', coin.got);

    /* 実機で一番効くのは体感速度。端末の画面サイズで測る */
    const fps = await page.evaluate(() => new Promise(res => {
      BM.game.newRun(); BM.ui.hide();
      let n = 0;
      const t0 = performance.now();
      (function tick() {
        n++;
        if (performance.now() - t0 >= 3000) return res(n / ((performance.now() - t0) / 1000));
        requestAnimationFrame(tick);
      })();
    }));
    console.log(`  fps ≈ ${fps.toFixed(1)}（端末サイズで描画）`);
    check('端末サイズでも 50fps 以上出る', fps > 50, `(${fps.toFixed(1)}fps)`);

    await ctx.close();
  }

  await browser.close();
  srv.close();

  console.log('');
  if (errors.length) {
    console.log('=== 失敗 ===');
    errors.forEach(e => console.log(e));
    process.exit(1);
  }
  console.log('スマホでの動作確認：すべて OK');
})();
