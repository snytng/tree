/**
 * [D-034] 単一テキストファイル入出力の実装
 */

/**
 * 図面データをMarkdown形式のテキストに変換する
 * @param {string} projectName プロジェクト名
 * @param {Array} nodes React Flow ノード配列
 * @param {Array} edges React Flow エッジ配列
 * @returns {string} Markdown文字列
 */
export const generateMarkdown = (projectName, nodes, edges) => {
  let content = `# ${projectName}\n\n`;

  content += `## Nodes\n`;
  
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const adj = new Map();
  const hasParent = new Set();
  
  // [改善] 階層エッジ(IDが h- で始まる)を優先的にツリーとして扱う
  const treeEdges = edges.filter(e => e.id.startsWith('h-'));
  const otherEdges = edges.filter(e => !e.id.startsWith('h-'));

  treeEdges.forEach(e => {
    if (!hasParent.has(e.target)) {
      if (!adj.has(e.source)) adj.set(e.source, []);
      adj.get(e.source).push(e.target);
      hasParent.add(e.target);
    }
  });

  // ルートノードをY座標でソート
  const roots = nodes.filter(n => !hasParent.has(n.id)).sort((a, b) => (a.position?.y || 0) - (b.position?.y || 0));
  const visitedEdges = new Set();

  const traverse = (nodeId, depth) => {
    const node = nodeMap.get(nodeId);
    if (!node) return "";
    
    const label = node.data?.label || node.label || "";
    // IDを常に明示的に [ID] 形式で保存する。これにより Edges セクションとの整合性を保つ
    const displayId = `[${node.id}] `;
    let str = `${"\t".repeat(depth)}- ${displayId}${label}\n`;
    
    // 兄弟ノードをY座標でソート
    const children = (adj.get(nodeId) || []).sort((a, b) => 
      (nodeMap.get(a)?.position?.y || 0) - (nodeMap.get(b)?.position?.y || 0));

    children.forEach(childId => {
      const edge = edges.find(e => e.source === nodeId && e.target === childId);
      if (edge) visitedEdges.add(edge.id);
      str += traverse(childId, depth + 1);
    });
    return str;
  };

  roots.forEach(root => {
    content += traverse(root.id, 0);
  });

  // 階層構造に含まれなかった追加エッジを抽出
  content += `\n## Edges\n`;
  
  // 1. ツリー解析で使われなかった h- エッジ（多重親など）
  // 2. 最初から Edges セクションにあった e- エッジ
  edges.forEach(e => {
    if (!visitedEdges.has(e.id)) {
      const labelPart = e.label ? ` [type=${e.label}]` : "";
      content += `- ${e.source} -> ${e.target}${labelPart}\n`;
    }
  });

  return content;
};

/**
 * Markdown文字列を解析してプロジェクトデータに変換する
 * @param {string} text Markdown文字列
 * @returns {object} { projectName, nodes, edges }
 */
export const parseMarkdown = (text) => {
  const lines = text.split(/\r?\n/);
  let projectName = "New Project";
  let currentSection = "";
  const nodeLines = [];
  const edgeLines = [];

  lines.forEach(line => {
    if (line.startsWith('# ')) {
      projectName = line.replace('# ', '').trim();
    } else if (line.startsWith('## Nodes')) {
      currentSection = "nodes";
    } else if (line.startsWith('## Edges')) {
      currentSection = "edges";
    } else if (line.trim() !== "" && !line.startsWith('##')) {
      if (currentSection === "nodes") nodeLines.push(line);
      if (currentSection === "edges") edgeLines.push(line);
    }
  });

  const nodes = [];
  const edges = [];
  const stack = [];

  nodeLines.forEach((line, idx) => {
    // インデントの深さを計算 (タブ、または半角スペース2〜4つを1レベルとみなす)
    const indentMatch = line.match(/^(\s*)/)[0];
    const depth = indentMatch.replace(/ {2,4}/g, '\t').length;
    
    const cleanLine = line.trim().replace(/^- /, '');

    // [ID] ラベル 形式から ID とラベルを抽出
    const idMatch = cleanLine.match(/^\[(.*?)\]/);
    const label = idMatch ? cleanLine.replace(idMatch[0], '').trim() : cleanLine;
    // IDが明示されていない場合のみ新規発行する
    const nodeId = idMatch ? idMatch[1] : `node-${Date.now()}-${idx}`;

    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    nodes.push({ id: nodeId, type: 'custom', data: { label }, position: { x: 0, y: 0 } });

    const parent = stack[stack.length - 1];
    if (parent) {
      // [重要] 階層由来のエッジには h- プレフィックスを付ける
      edges.push({ id: `h-${parent.id}-${nodeId}`, source: parent.id, target: nodeId });
    }
    stack.push({ id: nodeId, depth });
  });

  edgeLines.forEach(line => {
    const match = line.trim().match(/^- (.*?) -> (.*?)(?: \[type=(.*?)\])?$/);
    if (match) {
      const [_, source, target, label] = match;
      edges.push({ id: `e-${source}-${target}`, source, target, label: label || "" });
    }
  });

  return { projectName, nodes, edges };
};