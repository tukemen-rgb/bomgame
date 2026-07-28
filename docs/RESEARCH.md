# 爆弾ゲーム 設計リサーチ

BLAST RUSH を作るにあたって調べた内容のまとめ。

> **調査範囲について**
> ご依頼は「爆弾系のゲーム 10000 件」でしたが、1 万タイトルを個別に踏破することは
> このセッションでは現実的ではありません（itch.io の `bomberman` / `bomb` タグだけでも
> 数千件あり、その大半はプロトタイプで、設計上の新情報はほとんど重複します）。
> そこで **母集団を網羅する代わりに、設計の型（デザインパターン）を網羅する** 方針を取りました。
> シリーズ正史・ジャンル横断の派生・クローン実装・ゲームフィール研究・AI 研究の
> 5 方向から調べ、抽出したパターンをすべて実装に落としています。
> 個別タイトルの全数調査が必要であれば、別途スクレイピングのタスクとして切り出せます。

---

## 1. 系譜：どこから来たジャンルか

ボンバーマンは 1985 年のファミコン版が起点で、Hudson Soft 発、現在は Konami が保有する
マルチプレイヤーアクションシリーズ。40 年近く続いている。

主要な転換点：

| 年 | タイトル | ジャンルに与えた影響 |
|---|---|---|
| 1985 | ボンバーマン（FC） | 「爆弾で道を切り開く」基本ルールの確立 |
| 1990 | Atomic Punk / Bomber Boy（GB） | 携帯機での対戦 |
| 1993 | スーパーボンバーマン（SFC） | マルチタップによる 4 人同時対戦が本格化 |
| 1996 | サターンボンバーマン | 10 人対戦 + シリーズ初のネット対応 |
| 1997 | 爆ボンバーマン（N64） | 3D 化と 4 人対戦 |
| 2017 | Super Bomberman R | 現行世代への復帰 |

派生の広がりも大きく、`ぱにっくボンバー` のような**落ちもの連鎖パズル**への転用や、
BombSquad / Splody / Dstroy 2 のような**パーティゲーム方向の再解釈**が繰り返されている。
itch.io の `bomberman` タグには現在も新作が継続的に投稿されており、
ジャンルとしては「作りやすく、対戦が成立しやすい」ため個人開発の定番になっている。

**設計への示唆**：ルールがシンプルすぎるほど強い。追加要素はルールではなく
「爆弾の挙動を変えるアイテム」として足すのが、このジャンルの伝統的な拡張方向。

---

## 2. メカニクスの分類

シリーズ横断で使われているパワーアップを整理すると、きれいに 3 系統に分かれる。

### A. 爆弾そのものを変える
- **Bomb-Up** — 同時に置ける数を増やす
- **Fire** — 爆風の長さを伸ばす
- **Pierce（貫通）** — 火力の続く限りソフトブロックを貫通する
- **Remote（リモコン）** — 導火線ではなく任意のタイミングで起爆
- **Rubber / Bounce** — 蹴られると跳ね回る

### B. 爆弾との関わり方を変える
- **Kick** — 爆弾を蹴って滑らせる
- **Boxing Glove（パンチ）** — 殴って飛ばす
- **Power Glove** — 持ち上げて投げる

### C. プレイヤー自身を変える
- **Skate** — 移動速度上昇
- **Heart / Shield** — 被弾を 1 回無効化
- **（マイナス補正）** Speed Down、Bomb Down など

パワーアップはほとんどの場合ソフトブロックの破壊で出現し、
作品によっては敵のドロップからも出る。

**本作での採用**：A から Fire / Bomb-Up / Pierce / Remote、B から Kick、
C から Speed / Shield / Heart、加えて上限解放の Full Fire。
パンチと投げは操作系が増える割に爽快感への寄与が薄いと判断して外した。
マイナスアイテムも「テンポが落ちる」ため不採用。

---

## 3. 「爽快感」はどこから来るのか

ファミコン版の評価軸を追うと、爽快感は**爆発の見た目**ではなく
**連鎖の読み合い**から生まれていることがわかる。敵の動きを読んで爆風を連鎖させるプレイは
上級者ほど戦略性を味わえる設計になっており、ルール自体は初心者にも直感的。
つまり「単純なルール × 連鎖という深さ」の二層構造が本体。

その上に、現代的なゲームフィール（juice）の技法を重ねる。調査した範囲での定石：

| 技法 | 内容 | 本作の実装 |
|---|---|---|
| Screen shake | 衝撃の向きに沿ってカメラを押す | `FX.addShake()`。火力と連鎖数で強度が変わる |
| Hit stop | 命中時に一瞬時間を止める | 完全停止ではなく `dt *= 0.18` のスローに（止まると操作感が死ぬため） |
| Particles | 着弾点から進行方向へ破片を撒く | 発光する火花 + 発光しない瓦礫/煙の 2 層 |
| Chromatic aberration | 強い衝撃で画面端に RGB のズレ | R と C を別オフセットで加算合成。**上限 5px・42px/s で減衰**（強すぎると盤面が読めない） |
| Shockwave | 爆心から広がるリング | `FX.shock()`。イージングで一気に広がって細くなる |
| Flash / Vignette | 画面全体の明滅 | 被弾時のみ赤いヴィネットを重ねる |

実装して分かった一番大事な調整は **「効果は強くするより、速く戻す」** こと。
初期実装では色ズレを 14px まで上げていたが、連鎖のたびに盤面が二重に見えて
危険マスの判断ができなくなった。上限を 5px に下げ、減衰を 1.6 倍速くしただけで
「派手だが読める」状態になった。

さらに本作独自の足し算として：
- 爆風は中心から距離 × 16ms 遅れて出る（十字に「伸びる」ように見える）
- 誘爆は即時ではなく 55ms のタメを入れる（連鎖が「タタタッ」と鳴る）
- 連鎖数に応じて効果音のピッチが上がり、3 連鎖以上で画面中央にバナーが出る

---

## 4. 実装の型（HTML5 Canvas クローンの定石）

既存の JS クローン実装（DJakarta/bomberman、MattSkala/html5-bombergirl ほか）を
確認したところ、共通していたのは：

- **タイルマップ + ピクセル座標の二層管理**。論理はセル、描画と当たり判定はピクセル。
- 壁は `x % 2 === 0 && y % 2 === 0` の固定配置。外周は必ず壁。
- 爆弾はセルに固定、プレイヤーはピクセルで自由移動。

一方、**多くのクローンが取りこぼしているのが「通路への吸い付き」**。
本作では `moveAxis()` で、横移動中は現在行の中心線へ、縦移動中は現在列の中心線へ
常に引き寄せている（`js/entities.js`）。これが無いと曲がり角でひっかかり、
操作のストレスが爽快感を全部殺す。

ボードは 15×13 セル / 40px（600×520px）。原作系のレイアウトに合わせた。

---

## 5. 敵 AI

調査した実装（A* / BFS ベースのもの、強化学習ベースのもの）で共通していた要点：

1. **危険マップを先に作る**。設置済み爆弾の爆風予測を盤面に焼き込み、
   「今の炎」と「これから来る炎」を区別する。
2. **爆弾を置く前に逃げ道を確認する**。逃げ道が無いなら置かない。
   これをやらない AI は自爆し続ける。
3. **経路探索は BFS で十分**。15×13 程度の盤面で A* の優位性はほぼ無い。
4. 危険にいるときは「危険を通ってでも安全マスへ」、
   安全なときは「危険マスを避けてプレイヤーへ」と、通行可能条件を切り替える。

本作の実装（`js/map.js` の `bfsStep`、`js/entities.js` の `Enemy.decide`）：

- `danger[]` は 0=安全 / 1=これから爆風 / 2=今まさに炎、の 3 値
- 危険にいる → `passable` に危険を含めて最寄りの安全マスへ BFS
- 安全 → 危険を除外した `passable` でプレイヤーへ BFS（探索深さ上限つき）
- `bomber` タイプのみ設置判断を行い、`enemyHasEscape()` が真のときだけ置く

敵は 4 種類で役割分担している：

| 種類 | 速度 | 挙動 | 点 |
|---|---|---|---|
| balloon | 遅 | ランダム徘徊（直進しやすい重み付き） | 100 |
| chaser | 速 | BFS でプレイヤーを追う | 200 |
| ghost | 中 | ソフトブロックをすり抜けて追う | 300 |
| bomber | 速 | 爆弾を設置してくる。HP 2 | 500 |

**プレイヤーへの情報提示**：AI と同じ `danger` 配列を床の赤い明滅として描いている。
「これから爆風が来るマス」が常に見えるので、理不尽死が起きない。
これは調査対象にはなかったが、避けゲーとしての気持ちよさに一番効いた追加要素。

---

## 6. 参考にした資料

- [Power-Ups | Bomberman Wiki](https://bomberman.fandom.com/wiki/Power-Ups) — パワーアップの全体像
- [Super Bomberman/Power-ups — StrategyWiki](https://strategywiki.org/wiki/Super_Bomberman/Power-ups)
- [List of Bomberman video games — Wikipedia](https://en.wikipedia.org/wiki/List_of_Bomberman_video_games) — シリーズ全タイトル
- [MASTER GAME LIST — Ragey's Totally Bombastic Bomberman Shrine Place](https://randomhoohaas.flyingomelette.com/bomb/game.html)
- [The complete history of Bomberman — Tired Old Hack](https://tiredoldhack.com/2017/02/26/the-complete-history-of-bomberman/)
- [ファミコン版「ボンバーマン」が発売40周年！ — GAME Watch](https://game.watch.impress.co.jp/docs/kikaku/2071357.html)
- [レトロゲーム黎明録｜第22回ボンバーマン（FC／1985）](https://uniquerui.com/tblog/retrogame-22-bomberman/) — 完成されたゲームバランスという評価軸
- [ボンバーマンシリーズ — Wikipedia](https://ja.wikipedia.org/wiki/%E3%83%9C%E3%83%B3%E3%83%90%E3%83%BC%E3%83%9E%E3%83%B3%E3%82%B7%E3%83%AA%E3%83%BC%E3%82%BA)
- [Case Study: Bomberman Mechanics in an ECS — GameDev.net](https://www.gamedev.net/articles/programming/general-and-gameplay-programming/case-study-bomberman-mechanics-in-an-entity-component-system-r3159/)
- [Implementing HTML5 Bomberman — Yusuf Aytas](https://yusufaytas.com/implementing-html5-bomberman)
- [DJakarta/bomberman](https://github.com/DJakarta/bomberman) / [MattSkala/html5-bombergirl](https://github.com/MattSkala/html5-bombergirl) — Canvas 実装の比較
- [Maximizing Game Feel in Action Game Development](https://salivity.github.io/game-development/article/maximizing-game-feel-in-action-game-development) — hit stop / 色ズレ
- [Juice It Good: Adding Camera Shake To Your Game](https://gt3000.medium.com/juice-it-adding-camera-shake-to-your-game-e63e1a16f0a6) — 方向つき画面揺れ
- [Making a Game Feel "Juicy" with Simple Effects](https://resprawn.medium.com/when-you-play-a-great-game-it-feels-good-d23761b6eccf)
- [Bomberman - How to keep path safe? — GameDev.net](https://gamedev.net/forums/topic/673562-bomberman-how-to-keep-path-safe/5264240/) — 時間レイヤ付き BFS
- [Beating Bomberman with Artificial Intelligence (PDF)](https://www.researchgate.net/publication/329453697_Beating_Bomberman_with_Artificial_Intelligence)
- [jrzmnt/BombermanAI](https://github.com/jrzmnt/BombermanAI) / [bomberman-ai — GitHub Topics](https://github.com/topics/bomberman-ai)
- [Top games tagged bomberman — itch.io](https://itch.io/games/tag-bomberman) / [tag: bomb](https://itch.io/games/tag-bomb) — 現行の同ジャンル動向
- [Atomic Bomberman Alternatives — AlternativeTo](https://alternativeto.net/software/atomic-bomberman) — Bombermaaan / Granatier / BombSquad ほか
