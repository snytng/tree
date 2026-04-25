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

## 5. [D-005] カメラ制御 (Auto-Panning)
- `useReactFlow` フックの `setCenter` を使用。
- 新規追加されたノードのIDを追跡し、`useEffect` 内でアニメーション移動を実行。

## 6. [D-006] スタイリングの実装
- インラインCSS（`<style>`タグ）による `.react-flow__edge.selected` の強制上書き。
- ノードの `selected` プロパティを `CustomNode` で受け取り、条件付きインラインスタイルを適用。