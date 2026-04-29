/**
 * [D-027] 循環参照防止のための子孫チェックヘルパー
 */
export const isDescendant = (nodes, edges, parentId, potentialChildId) => {
  const adj = {};
  edges.forEach(e => {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  });
  const queue = [parentId];
  const visited = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === potentialChildId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    (adj[current] || []).forEach(child => queue.push(child));
  }
  return false;
};

/**
 * [D-031] 階層テキスト（インデント形式）を解析してノードとエッジの集合を返す
 */
export const parseHierarchyText = (text) => {
  // 改行コード (\r\n, \n, \r) を考慮して分割
  const lines = text.split(/\r\n|\r|\n/);
  const result = { nodes: [], edges: [] };
  const stack = []; // { id, depth }
  const timestamp = Date.now();

  lines.forEach((line, index) => {
    const label = line.trimStart();
    if (!label) return; // 空行はスキップ

    // インデント部分の取得と深さの計算 (タブまたは4つのスペースを1レベル)
    const indent = line.substring(0, line.indexOf(label));
    const depth = indent.replace(/\t/g, '    ').length / 4;

    const id = `node-paste-${timestamp}-${index}`;
    const newNode = {
      id,
      type: 'custom',
      data: { label },
      position: { x: 0, y: index * 0.1 }, // 初期順序用の微小オフセット
    };

    // スタックを遡って親を探す
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    result.nodes.push(newNode);
    if (parent) {
      result.edges.push({
        id: `edge-paste-${timestamp}-${index}`,
        source: parent.id,
        target: id,
      });
    }

    stack.push({ id, depth });
  });

  return result;
};

/**
 * [D-032] 特定のノード配下を階層テキスト形式に変換する
 */
export const generateHierarchyText = (nodes, edges, rootNodeId) => {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const adj = {};
  edges.forEach(e => {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  });

  const lines = [];
  const traverse = (id, depth) => {
    const node = nodeMap.get(id);
    if (!node) return;

    lines.push('\t'.repeat(depth) + (node.data.label || ''));
    const children = (adj[id] || []).sort((a, b) => {
      return (nodeMap.get(a)?.position?.y || 0) - (nodeMap.get(b)?.position?.y || 0);
    });
    children.forEach(childId => traverse(childId, depth + 1));
  };

  traverse(rootNodeId, 0);
  return lines.join('\n');
};