# くすりログ Web版

Dev 共通ルール: `/Users/kakeru/Dev/_rules/agent_management.md`・`collaboration.md`（Claude はリード、Codex は実装）
Claude は `_rules/claude.md`、Codex は `_rules/codex.md` も読む。
作業開始時に `README.md`・`_TODO.md`・`_handoff.md` を読む。状態: 公開済み・保守モード。

## このプロジェクトのルール

- アプリは入力内容の記録と表示だけを行う。薬・症状・診療内容について判断・推奨・助言をしない。
- 入力された医療情報を GitHub や独自サーバーへ送信しない。データはブラウザの `localStorage` に端末ごとに保存する。
- 保存キー `kusuri-log-web-v1` を変更しない。スキーマ追加時は `normalizeStore()` で旧データに既定値を補い、既存データを初期化・上書きしない。
- Service Worker を変更したら `sw.js` のキャッシュ名を更新する。
- 公開リポジトリに実データ・個人情報・認証情報を含めない。
- push（= GitHub Pages への公開）はユーザーの確認を取ってから行う。

## 検証方法

1. `node --check app.js`
2. `git diff --check`
3. 旧形式データを使ったブラウザ移行テスト
4. `python3 -m http.server 8080`（Dev 直下で起動）→ `http://localhost:8080/KusuriLogWeb/` で主要画面を操作
5. 公開後は GitHub Pages build が `built` になり、公開 URL で描画されることを確認
