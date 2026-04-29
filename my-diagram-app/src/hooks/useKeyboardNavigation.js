import { useEffect } from 'react';
import { useReactFlow } from 'reactflow';

/**
 * [D-014] キーボードナビゲーションを実現するためのフック
 * 矢印キーで視覚的に最も近いノードへフォーカスを移動する
 */
export const useKeyboardNavigation = (ydoc, nodes, edges, setNodes) => {
  const { setCenter } = useReactFlow();

  useEffect(() => {
    const handleKeyDown = (event) => {
      const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (!arrows.includes(event.key)) return;

      // 現在選択されているノードを1つ取得
      const currentNode = nodes.find((n) => n.selected);
      if (!currentNode) return;

      // [D-016] Ctrl + 上下による兄弟の順序入れ替え
      if (event.ctrlKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        const parentEdge = edges.find(e => e.target === currentNode.id);
        
        let siblings;
        if (parentEdge) {
          // 親がいる場合: 親を共有する兄弟を特定
          const siblingIds = edges
            .filter(e => e.source === parentEdge.source)
            .map(e => e.target);
          siblings = nodes.filter(n => siblingIds.includes(n.id));
        } else {
          // [D-016] 親がいない場合: 入力エッジを持たないノードをルート兄弟とみなす
          const targetIds = new Set(edges.map(e => e.target));
          siblings = nodes.filter(n => !targetIds.has(n.id));
        }

        siblings.sort((a, b) => a.position.y - b.position.y);

        const currentIndex = siblings.findIndex(s => s.id === currentNode.id);
        let targetSibling = null;

        if (event.key === 'ArrowUp' && currentIndex > 0) {
          targetSibling = siblings[currentIndex - 1];
        } else if (event.key === 'ArrowDown' && currentIndex < siblings.length - 1) {
          targetSibling = siblings[currentIndex + 1];
        }

        if (targetSibling) {
          const yNodes = ydoc.getMap('nodes');
          ydoc.transact(() => {
            const currentData = yNodes.get(currentNode.id);
            const targetData = yNodes.get(targetSibling.id);
            if (currentData && targetData) {
              // Y座標を入れ替えることで自動レイアウトの順序を変える
              const tempY = currentData.position.y;
              yNodes.set(currentNode.id, { ...currentData, position: { ...currentData.position, y: targetData.position.y } });
              yNodes.set(targetSibling.id, { ...targetData, position: { ...targetData.position, y: tempY } });
            }
          }, 'structural'); // [D-016] 構造変更を示すオリジンを付与
        }
        return;
      }

      // [D-025] Ctrl + Right による階層下げ (Indent)
      if (event.ctrlKey && event.key === 'ArrowRight') {
        event.preventDefault();
        const yEdges = ydoc.getMap('edges');
        const yNodes = ydoc.getMap('nodes');

        // 1. 親を特定
        const parentEdge = edges.find(e => e.target === currentNode.id);
        const parentId = parentEdge ? parentEdge.source : null;

        // 2. 兄弟を特定
        let siblings;
        if (parentId) {
          const siblingIds = edges.filter(e => e.source === parentId).map(e => e.target);
          siblings = nodes.filter(n => siblingIds.includes(n.id));
        } else {
          // 親がいない場合はルートノード同士を兄弟とみなす
          const targetIds = new Set(edges.map(e => e.target));
          siblings = nodes.filter(n => !targetIds.has(n.id));
        }

        siblings.sort((a, b) => a.position.y - b.position.y);
        const currentIndex = siblings.findIndex(s => s.id === currentNode.id);

        // 3. 直上の兄弟がいればその子にする
        if (currentIndex > 0) {
          const targetParent = siblings[currentIndex - 1];
          ydoc.transact(() => {
            if (parentEdge) yEdges.delete(parentEdge.id);
            const newEdgeId = `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            yEdges.set(newEdgeId, { id: newEdgeId, source: targetParent.id, target: currentNode.id });
            
            // 順序維持のための微調整 (自動レイアウトのヒント)
            const nodeData = yNodes.get(currentNode.id);
            if (nodeData) {
              yNodes.set(currentNode.id, { ...nodeData, position: { ...nodeData.position, y: nodeData.position.y + 0.01 } });
            }
          }, 'structural');
        }
        return;
      }

      // [D-026] Ctrl + Left による階層上げ (Outdent)
      if (event.ctrlKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        const yEdges = ydoc.getMap('edges');
        const yNodes = ydoc.getMap('nodes');

        // 1. 親を特定
        const parentEdge = edges.find(e => e.target === currentNode.id);
        if (!parentEdge) return; // 親がいない（既にルート）場合は何もしない

        const parentNode = nodes.find(n => n.id === parentEdge.source);
        if (!parentNode) return;

        // 2. 祖父を特定
        const grandParentEdge = edges.find(e => e.target === parentNode.id);
        const grandParentId = grandParentEdge ? grandParentEdge.source : null;

        ydoc.transact(() => {
          // 既存の親エッジを削除
          yEdges.delete(parentEdge.id);

          // 祖父がいれば接続、いなければルート化
          if (grandParentId) {
            const newEdgeId = `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            yEdges.set(newEdgeId, { id: newEdgeId, source: grandParentId, target: currentNode.id });
          }

          // 順序維持のための微調整 (自動レイアウトのヒント: 元の親のすぐ下に配置)
          const nodeData = yNodes.get(currentNode.id);
          if (nodeData) {
            yNodes.set(currentNode.id, { ...nodeData, position: { ...nodeData.position, y: parentNode.position.y + 0.01 } });
          }
        }, 'structural');
        return;
      }

      if (event.ctrlKey) return; // その他のCtrl操作は通常ナビゲーションをスキップ

      const yNodes = ydoc.getMap('nodes');
      let bestNode = null;
      let minScore = Infinity;
      const WEIGHT = 2.5; // 軸のずれに対する重み（大きいほど直線を優先）

      nodes.forEach((target) => {
        if (target.id === currentNode.id) return;

        const dx = target.position.x - currentNode.position.x;
        const dy = target.position.y - currentNode.position.y;

        let score = Infinity;

        switch (event.key) {
          case 'ArrowRight':
            // 右方向: dx > 0 の中から、dx + |dy|*W が最小のもの
            if (dx > 0) score = dx + Math.abs(dy) * WEIGHT;
            break;
          case 'ArrowLeft':
            // 左方向: dx < 0
            if (dx < 0) score = Math.abs(dx) + Math.abs(dy) * WEIGHT;
            break;
          case 'ArrowDown':
            // 下方向: dy > 0
            if (dy > 0) score = dy + Math.abs(dx) * WEIGHT;
            break;
          case 'ArrowUp':
            // 上方向: dy < 0
            if (dy < 0) score = Math.abs(dy) + Math.abs(dx) * WEIGHT;
            break;
        }

        if (score < minScore) {
          minScore = score;
          bestNode = target;
        }
      });

      if (bestNode) {
        event.preventDefault(); // ブラウザのスクロールを防止

        // [D-014] ローカルの選択状態を即座に更新し、視覚的なラグをなくす
        setNodes((nds) =>
          nds.map((n) => ({
            ...n,
            selected: n.id === bestNode.id,
          }))
        );

        // [D-014] 固定サイズ (180x60) の中心に合わせてカメラを移動
        // セレクションはローカルステートのみで管理するため Yjs への書き込みは不要
        setCenter(bestNode.position.x + 90, bestNode.position.y + 30, { zoom: 1, duration: 150 });

        // DOM要素にフォーカスを当て、連続したキー操作を確実に受け取れるようにする
        const element = document.querySelector(`[data-id="${bestNode.id}"]`);
        if (element instanceof HTMLElement) {
          element.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nodes, edges, ydoc, setNodes, setCenter]);
};