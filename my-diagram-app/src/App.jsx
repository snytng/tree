import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  useNodesState,
  useEdgesState,
  Panel,
  MarkerType, // MarkerTypeをインポート
  ReactFlowProvider,
  useReactFlow,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';
import dagre from 'dagre';

const ROOM_NAME = 'react-flow-demo-room';
// Yjsドキュメントの初期化
const ydoc = new Y.Doc();
// 部屋名 'react-flow-demo-room' でWebRTCプロバイダーを設定
const provider = new WebrtcProvider('react-flow-demo-room', ydoc);
// ローカルストレージ（IndexedDB）への永続化
const indexeddb = new IndexeddbPersistence(ROOM_NAME, ydoc);

// 左右にハンドルを持つカスタムノードの定義
const CustomNode = ({ data, selected }) => {
  return (
    <div style={{ 
      padding: '10px', 
      borderRadius: '5px', 
      background: '#fff', 
      border: selected ? '2px solid #ff0000' : '1px solid #1a192b', // 選択時に赤枠
      minWidth: '100px', 
      textAlign: 'center',
      boxShadow: selected ? '0 0 10px rgba(255, 0, 0, 0.3)' : 'none' // 選択時に光らせる
    }}>
      <Handle type="target" position={Position.Left} style={{ borderRadius: 0 }} />
      <div>{data.label}</div>
      <Handle type="source" position={Position.Right} style={{ borderRadius: 0 }} />
    </div>
  );
};

// nodeTypesはコンポーネントの外で定義するか、memo化する必要があります
const nodeTypes = {
  custom: CustomNode,
  default: CustomNode, // デフォルトのノードタイプも左右ハンドルに設定
};

// 自動レイアウト計算関数
const getLayoutedElements = (nodes, edges) => {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 100 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    // ノードのサイズを計算の基準にする（カスタムノードのサイズに合わせる）
    g.setNode(node.id, { width: 150, height: 50 });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - 75,
        y: nodeWithPosition.y - 25,
      },
    };
  });
};

const initialNodes = [];
const initialEdges = [];

function Flow() {
  const [nodes, setNodes, onNodesChangeState] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChangeState] = useEdgesState(initialEdges);
  const [isAutoLayout, setIsAutoLayout] = useState(true);
  const [lastAddedNodeId, setLastAddedNodeId] = useState(null);

  const { setCenter, getViewport } = useReactFlow();

  // デフォルトのエッジオプションを定義
  const defaultEdgeOptions = useMemo(() => ({
    animated: false, // 必要であればアニメーションを有効に
    style: { strokeWidth: 2, stroke: '#333' }, // エッジのスタイル
    markerEnd: {
      type: MarkerType.ArrowClosed, // 終端を閉じた矢印にする
      color: '#333', // 矢印の色
    },
  }), []);

  // Yjsの共有型（Map）を取得。IDをキーにすることで、個別の要素を効率的に同期できる
  const yNodes = ydoc.getMap('nodes');
  const yEdges = ydoc.getMap('edges');

  // React Flowの変更をYjsに反映させるハンドラー
  const onNodesChange = useCallback(
    (changes) => {
      // まず手元のUIを更新
      onNodesChangeState(changes);

      // 自動レイアウト時は位置の変更をYjsに同期しない（計算結果が優先されるため）
      ydoc.transact(() => {
        changes.forEach((change) => {
          if (change.type === 'remove') {
            yNodes.delete(change.id);
          } else if (!isAutoLayout && (change.type === 'position' || change.type === 'dimensions')) {
            const node = yNodes.get(change.id);
            if (node) {
              const updatedNode = { ...node };
              if (change.position) updatedNode.position = change.position;
              if (change.dimensions) {
                updatedNode.width = change.dimensions.width;
                updatedNode.height = change.dimensions.height;
              }
              yNodes.set(change.id, updatedNode);
            }
          }
        });
      }, 'local');
    },
    [onNodesChangeState, yNodes, isAutoLayout]
  );

  const onEdgesChange = useCallback(
    (changes) => {
      onEdgesChangeState(changes);
      ydoc.transact(() => {
        changes.forEach((change) => {
          if (change.type === 'remove') {
            yEdges.delete(change.id);
          }
        });
      }, 'local');
    },
    [onEdgesChangeState, yEdges]
  );

  const onConnect = useCallback(
    (params) => {
      // エッジのIDを生成してYjsに追加
      const edgeId = `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newEdge = { ...params, id: edgeId };
      
      // 手元の状態を即座に更新
      setEdges((eds) => {
        const nextEdges = addEdge(newEdge, eds);
        if (isAutoLayout) {
          // 接続時も即座に再配置
          setNodes((nds) => getLayoutedElements(nds, nextEdges));
        }
        return nextEdges;
      });

      ydoc.transact(() => {
        yEdges.set(edgeId, newEdge);
      }, 'local');
    },
    [setEdges, setNodes, yEdges, isAutoLayout]
  );

  // ノードが追加された際に中央へ移動するエフェクト
  useEffect(() => {
    if (lastAddedNodeId) {
      const node = nodes.find((n) => n.id === lastAddedNodeId);
      if (node) {
        // ノードのサイズ(150x50)の半分を足して中心座標を計算
        const centerX = node.position.x + 75;
        const centerY = node.position.y + 25;

        setCenter(centerX, centerY, {
          zoom: getViewport().zoom,
          duration: 500, // 500msで素早く移動
        });
        setLastAddedNodeId(null);
      }
    }
  }, [nodes, lastAddedNodeId, setCenter, getViewport]);

  // 選択された要素を削除する関数
  const onDeleteSelected = useCallback(() => {
    ydoc.transact(() => {
      nodes.forEach((node) => {
        if (node.selected) yNodes.delete(node.id);
      });
      edges.forEach((edge) => {
        if (edge.selected) yEdges.delete(edge.id);
      });
    }, 'local');

    // syncStateで 'local' をスキップしているため、手元の状態も即座に更新する
    setNodes((nds) => nds.filter((node) => !node.selected));
    setEdges((eds) => eds.filter((edge) => !edge.selected));
  }, [nodes, edges, yNodes, yEdges, setNodes, setEdges]);

  // ノードを追加する関数
  const onAddNode = useCallback(() => {
    const id = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newNode = {
      id,
      type: 'custom', // 作成したカスタムノードを使用
      data: { label: `Node ${yNodes.size + 1}` },
      position: { x: Math.random() * 400, y: Math.random() * 400 },
    };
    
    // 手元の状態を即座に更新
    setNodes((nds) => {
      const nextNodes = nds.concat(newNode);
      if (isAutoLayout) {
        // 自動レイアウト時は追加と同時に配置を計算（一瞬で整列）
        const edgesArray = Array.from(yEdges.values());
        return getLayoutedElements(nextNodes, edgesArray);
      }
      return nextNodes;
    });
    setLastAddedNodeId(id); // 移動対象としてIDを記録

    ydoc.transact(() => {
      yNodes.set(id, newNode);
    }, 'local');
  }, [yNodes, yEdges, setNodes, setLastAddedNodeId, isAutoLayout]);

  // 全てのデータをリセットする関数
  const onReset = useCallback(() => {
    if (!window.confirm('キャンバスを空にしますか？（この操作は取り消せません）')) return;
    ydoc.transact(() => {
      yNodes.clear();
      yEdges.clear();
    }, 'local');
    setNodes([]);
    setEdges([]);
  }, [yNodes, yEdges, setNodes, setEdges]);

  // Yjs側からの変更を監視してReactの状態に反映
  useEffect(() => {
    const syncState = (event) => {
      if (event && event.transaction.origin === 'local') return;
      
      const nodesArray = Array.from(yNodes.values());
      const edgesArray = Array.from(yEdges.values());

      // 現在の選択状態を維持しながら同期する
      setNodes((currentNodes) => {
        const mergedNodes = nodesArray.map((yNode) => {
          const localNode = currentNodes.find((n) => n.id === yNode.id);
          // Yjsからのデータに、ローカルでのみ保持しているselected状態を合体させる
          return localNode ? { ...yNode, selected: localNode.selected } : yNode;
        });

        return isAutoLayout && mergedNodes.length > 0
          ? getLayoutedElements(mergedNodes, edgesArray)
          : mergedNodes;
      });

      setEdges((currentEdges) => {
        return edgesArray.map((yEdge) => {
          const localEdge = currentEdges.find((e) => e.id === yEdge.id);
          return localEdge ? { ...yEdge, selected: localEdge.selected } : yEdge;
        });
      });
    };

    // 初期ロード
    syncState();

    yNodes.observe(syncState);
    yEdges.observe(syncState);

    return () => {
      yNodes.unobserve(syncState);
      yEdges.unobserve(syncState);
    };
  }, [yNodes, yEdges, setNodes, setEdges, isAutoLayout]);

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <style>{`
        .react-flow__edge.selected .react-flow__edge-path {
          stroke: #ff0000 !important;
          stroke-width: 3;
        }
        .react-flow__edge.selected marker path {
          fill: #ff0000 !important;
        }
      `}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes} // カスタムノードを登録
        defaultEdgeOptions={defaultEdgeOptions} // ここでデフォルトのエッジオプションを適用
        nodesDraggable={!isAutoLayout} // 自動レイアウト時はドラッグを無効化
        fitView
      >
        <Background />
        <Controls />
        <Panel position="top-right" style={{ display: 'flex', gap: '10px' }}>
          <button 
            onClick={() => setIsAutoLayout(!isAutoLayout)}
            style={{ 
              padding: '10px 20px', 
              cursor: 'pointer',
              backgroundColor: isAutoLayout ? '#1a192b' : '#fff',
              color: isAutoLayout ? '#fff' : '#1a192b',
              border: '2px solid #1a192b',
              borderRadius: '4px',
              fontWeight: 'bold',
              boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
            }}
          >
            {isAutoLayout ? '自動レイアウト: ON' : '自動レイアウト: OFF'}
          </button>
          <button 
            onClick={onAddNode} 
            style={{ 
              padding: '10px 20px', 
              cursor: 'pointer',
              backgroundColor: '#fff',
              border: '2px solid #1a192b',
              borderRadius: '4px',
              fontWeight: 'bold',
              boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
            }}
          >
            ＋ ノードを追加
          </button>
          <button 
            onClick={onDeleteSelected} 
            style={{ 
              padding: '10px 20px', 
              cursor: 'pointer',
              backgroundColor: '#fff',
              border: '2px solid #ff9800',
              color: '#ff9800',
              borderRadius: '4px',
              fontWeight: 'bold',
              boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
            }}
          >
            選択削除
          </button>
          <button 
            onClick={onReset} 
            style={{ 
              padding: '10px 20px', 
              cursor: 'pointer',
              backgroundColor: '#fff',
              border: '2px solid #f44336',
              color: '#f44336',
              borderRadius: '4px',
              fontWeight: 'bold',
              boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
            }}
          >
            リセット
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}