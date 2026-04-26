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
        if (!parentEdge) return; // 親がいない（ルート）場合は現状スキップ

        const siblingIds = edges
          .filter(e => e.source === parentEdge.source)
          .map(e => e.target);

        const siblings = nodes
          .filter(n => siblingIds.includes(n.id))
          .sort((a, b) => a.position.y - b.position.y);

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

        ydoc.transact(() => {
          // 全ユーザーに対して選択状態を同期
          nodes.forEach(n => {
            if (n.selected) {
              const val = yNodes.get(n.id);
              if (val) yNodes.set(n.id, { ...val, selected: false });
            }
          });
          const nextVal = yNodes.get(bestNode.id);
          if (nextVal) yNodes.set(bestNode.id, { ...nextVal, selected: true });

          // 固定サイズ (180x60) の中心に合わせてカメラを移動
          setCenter(bestNode.position.x + 90, bestNode.position.y + 30, { zoom: 1, duration: 150 });
        }, 'local');

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