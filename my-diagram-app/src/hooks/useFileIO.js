import { useCallback } from 'react';
import { generateMarkdown, parseMarkdown } from '../utils/fileHandlers';

/**
 * [D-034] ファイル入出力用カスタムフック
 * Yjsの共有データとファイル操作を橋渡しする
 */
export const useFileIO = (yNodes, yEdges, yProjectMeta, projectName) => {
  
  // エクスポート処理（Markdownファイルとして保存）
  const exportProject = useCallback(() => {
    const nodes = Array.from(yNodes.values());
    const edges = Array.from(yEdges.values());
    const markdown = generateMarkdown(projectName, nodes, edges);
    
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName || 'project'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yNodes, yEdges, projectName]);

  // インポート処理（Markdownファイルを読み込んで反映）
  const importProject = useCallback((file) => {
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const { projectName: importedName, nodes, edges } = parseMarkdown(text);
      
      const doc = yNodes.doc;
      if (!doc) return;

      // structural トランザクションにより、一括更新と再レイアウトをトリガーする
      doc.transact(() => {
        // 1. 既存データをクリア
        yNodes.clear();
        yEdges.clear();
        
        // 2. 新しいデータを挿入
        nodes.forEach(n => yNodes.set(n.id, n));
        edges.forEach(e => yEdges.set(e.id, e));
        
        // 3. プロジェクト名を更新
        if (yProjectMeta) {
          yProjectMeta.set('name', importedName);
        }
      }, 'structural');
    };
    reader.readAsText(file);
  }, [yNodes, yEdges, yProjectMeta]);

  return { exportProject, importProject };
};