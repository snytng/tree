# My Diagram App 設計書

## 1. [D-001] 技術スタック詳細
- **Frontend**: React (Vite)
- **Diagramming**: React Flow
- **CRDT**: Yjs (Y.Doc, Y.Map)
- **Network**: y-webrtc (Signaling over public server)
- **Storage**: y-indexeddb
- **Layout**: Dagre

## 2. [D-002] データ構造と同期アルゴリズム
- `ydoc.getMap('nodes')` および `ydoc.getMap('edges')` を使用して要素を管理。
- トランザクションオリジンに `'local'` を指定し、エコーバックによる無限ループを防止。
- 同期時にローカルの `selected` フラグを維持するためのステートマージロジックを実装。

## 3. [D-003] カスタムノード実装
- `Handle` コンポーネントを `Position.Left` (Target) と `Position.Right` (Source) に配置。
- `nodeTypes` に登録し、`default` タイプを上書きすることで既存データとの互換性を確保。

## 4. [D-004] 自動レイアウト計算
- Dagreエンジンを利用。設定: `{ rankdir: 'LR', nodesep: 50, ranksep: 100 }`。
- `getLayoutedElements` 関数により、ノードサイズ `150x50` を基準に座標を再計算。
- 自動モード時は `nodesDraggable: false` を適用。
- **モード移行時の永続化**: 自動レイアウトをOFFにする際、その時点の計算済み座標を `yNodes` に一括書き込みし、レイアウトを維持する。

## 5. [D-005] カメラ制御 (Auto-Panning)
- `useReactFlow` フックの `setCenter` を使用。
- 新規追加されたノードのIDを追跡し、`useEffect` 内でアニメーション移動を実行。

## 6. [D-006] スタイリングの実装
- インラインCSS（`<style>`タグ）による `.react-flow__edge.selected` の強制上書き。
- ノードの `selected` プロパティを `CustomNode` で受け取り、条件付きインラインスタイルを適用。

## 7. [D-007] Markdownパーサーの実装
- Viteの `?raw` インポート機能を使用してMarkdownファイルをテキストとして読み込む。
- 正規表現 `/##.*\[([A-Z]-\d{3})\]\s*(.*)/g` を使用して、セクション番号を含むヘッダーからIDとタイトルを抽出する。

## 8. [D-008] プロジェクト・インポートの実装
- `JSZip` を使用してアップロードされたZIPを解凍。
- `yDoc.getMap('projectFiles')` にファイルパスをキー、内容を値として永続化。

## 9. [D-009] プロジェクト・エクスポートの実装
- `JSZip` で `projectFiles` 内のコンテンツをファイル化。
- `mapping.json` を現在の `yEdges` 状態から動的に再生成して同梱。

## 10. [D-010] プロジェクトメタデータの管理
- `yDoc.getMap('projectMeta')` を使用し、プロジェクト名（`name`）や最終更新日などを保持。
- React Flowの `Panel (top-left)` を使用し、情報を表示。右側の操作パネルは `flex-direction: column` で垂直に配置し、干渉を防止。
- インポート時にファイル名からプロジェクト名を自動設定する。

## 11. [D-011] アイコンUIとツールチップの実装
- SVGアイコンを採用し、ボタンサイズを `40x40px` に統一。
- 疑似要素（`::after`）またはCSSクラスを用いたツールチップ機能を実装。
- ボタンの `data-tooltip` 属性を利用して表示テキストを管理する。