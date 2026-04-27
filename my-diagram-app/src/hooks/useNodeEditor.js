import { useEffect, useCallback } from 'react';

/**
 * ノードのラベル編集と Markdown ファイルの同期を管理するフック
 */
export const useNodeEditor = (yDoc) => {
  const updateNodeLabel = useCallback((id, newLabel) => {
    const yNodes = yDoc.getMap('nodes');
    const node = yNodes.get(id);
    if (!node) return;

    yDoc.transact(() => {
      // 1. ノード情報の更新
      yNodes.set(id, {
        ...node,
        data: { ...node.data, label: newLabel }
      });

      // 2. [ID] 形式が含まれる場合、Markdown (projectFiles) を検索して同期
      const idMatch = newLabel.match(/\[([A-Z]-\d{3})\]/);
      if (idMatch) {
        const docId = idMatch[1];
        const projectFiles = yDoc.getMap('projectFiles');
        
        for (const [path, content] of projectFiles.entries()) {
          // "## 17. [ID] タイトル" のように、## と [ID] の間に文字がある場合も考慮
          const headerRegex = new RegExp(`##.*?\\[${docId}\\].*`, 'g');
          
          if (headerRegex.test(content)) {
            const updatedContent = content.replace(headerRegex, `## ${newLabel}`);
            projectFiles.set(path, updatedContent);
            console.log(`[Sync] Updated Markdown section [${docId}] in ${path}`);
          }
        }
      }
    }, 'structural'); // 構造変更としてマークし自動レイアウトをトリガー
  }, [yDoc]);

  // CustomNode からのイベントを購読
  useEffect(() => {
    const handleUpdate = (e) => {
      const { id, label } = e.detail;
      updateNodeLabel(id, label);
    };

    window.addEventListener('nodeLabelUpdate', handleUpdate);
    return () => window.removeEventListener('nodeLabelUpdate', handleUpdate);
  }, [updateNodeLabel]);

  return { updateNodeLabel };
};