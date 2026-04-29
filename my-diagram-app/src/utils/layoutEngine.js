/**
 * [D-004/D-015] 自動レイアウト計算エンジン
 * React Flow のノードとエッジを受け取り、再帰的領域スタッキングに基づいて座標を再計算する。
 */
export const getLayoutedElements = (nodes, edges, options = {}) => {
  const {
    verticalGap = 40,
    horizontalStep = 360,
    nodeWidth = 180,
    nodeHeight = 60
  } = options;

  const visibleNodes = nodes.filter(n => !n.hidden);
  if (visibleNodes.length === 0) return nodes;

  const nodeIds = new Set(visibleNodes.map(n => n.id));
  const validEdges = edges.filter(e => !e.hidden && nodeIds.has(e.source) && nodeIds.has(e.target));

  const adj = {};
  const inDegree = {};
  visibleNodes.forEach(n => {
    adj[n.id] = [];
    inDegree[n.id] = 0;
  });
  validEdges.forEach(edge => {
    adj[edge.source].push(edge.target);
    inDegree[edge.target]++;
  });

  const finalNodePositions = {};
  const processedNodes = new Set();
  let currentYOffset = 0;

  const layoutSubtree = (nodeId, x, y) => {
    if (processedNodes.has(nodeId)) return { height: 0 };
    processedNodes.add(nodeId);

    const childrenIds = (adj[nodeId] || []).filter(id => !processedNodes.has(id));
    childrenIds.sort((a, b) => {
      const nodeA = nodes.find(n => n.id === a);
      const nodeB = nodes.find(n => n.id === b);
      const yA = nodeA?.position?.y || 0;
      const yB = nodeB?.position?.y || 0;
      return yA !== yB ? yA - yB : a.localeCompare(b);
    });

    let childrenBoxHeight = 0;
    childrenIds.forEach(childId => {
      const { height } = layoutSubtree(childId, x + horizontalStep, y + childrenBoxHeight);
      if (height > 0) childrenBoxHeight += height + verticalGap;
    });

    if (childrenIds.length > 0 && childrenBoxHeight > 0) childrenBoxHeight -= verticalGap;

    const myHeight = Math.max(nodeHeight, childrenBoxHeight);
    const myY = y + (myHeight / 2) - (nodeHeight / 2);

    finalNodePositions[nodeId] = { x, y: myY };
    return { height: myHeight };
  };

  const roots = visibleNodes
    .filter(n => inDegree[n.id] === 0)
    .sort((a, b) => (a.position.y !== b.position.y ? a.position.y - b.position.y : a.id.localeCompare(b.id)));

  roots.forEach(root => {
    const { height } = layoutSubtree(root.id, 0, currentYOffset);
    currentYOffset += height + verticalGap * 2;
  });

  visibleNodes.forEach(node => {
    if (!finalNodePositions[node.id]) {
      const { height } = layoutSubtree(node.id, 0, currentYOffset);
      currentYOffset += height + verticalGap * 2;
    }
  });

  return nodes.map((node) => ({
    ...node,
    position: finalNodePositions[node.id] || node.position,
    width: nodeWidth,
    height: nodeHeight
  }));
};