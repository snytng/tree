import React, { useCallback, useEffect, useMemo } from 'react';
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  useNodesState,
  useEdgesState,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';

const ROOM_NAME = 'react-flow-demo-room';
// Yjsドキュメントの初期化
const ydoc = new Y.Doc();
// 部屋名 'react-flow-demo-room' でWebRTCプロバイダーを設定
const provider = new WebrtcProvider('react-flow-demo-room', ydoc);
// ローカルストレージ（IndexedDB）への永続化
const indexeddb = new IndexeddbPersistence(ROOM_NAME, ydoc);

const initialNodes = [];
const initialEdges = [];

export default function App() {
  const [nodes, setNodes, onNodesChangeState] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChangeState] = useEdgesState(initialEdges);

  // Yjsの共有型（Map）を取得。IDをキーにすることで、個別の要素を効率的に同期できる
  const yNodes = ydoc.getMap('nodes');
  const yEdges = ydoc.getMap('edges');

  // React Flowの変更をYjsに反映させるハンドラー
  const onNodesChange = useCallback(
    (changes) => {
      // まず手元のUIを更新
      onNodesChangeState(changes);

      // Yjsを更新（変更があったノードだけを個別にセット）
      ydoc.transact(() => {
        changes.forEach((change) => {
          if (change.type === 'position' || change.type === 'dimensions') {
            const node = yNodes.get(change.id);
            if (node) {
              // 既存ノードのプロパティを更新
              const updatedNode = { ...node };
              if (change.position) updatedNode.position = change.position;
              if (change.dimensions) {
                updatedNode.width = change.dimensions.width;
                updatedNode.height = change.dimensions.height;
              }
              yNodes.set(change.id, updatedNode);
            }
          } else if (change.type === 'remove') {
            yNodes.delete(change.id);
          }
        });
      }, 'local');
    },
    [onNodesChangeState, yNodes]
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
      setEdges((eds) => addEdge(newEdge, eds));

      ydoc.transact(() => {
        yEdges.set(edgeId, newEdge);
      }, 'local');
    },
    [setEdges, yEdges]
  );

  // ノードを追加する関数
  const onAddNode = useCallback(() => {
    const id = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newNode = {
      id,
      data: { label: `Node ${yNodes.size + 1}` },
      position: { x: Math.random() * 400, y: Math.random() * 400 },
    };
    
    // 手元の状態を即座に更新
    setNodes((nds) => nds.concat(newNode));

    ydoc.transact(() => {
      yNodes.set(id, newNode);
    }, 'local');
  }, [yNodes, setNodes]);

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
    const observeNodes = (event) => {
      // 自分が発行したイベント（'local'）はスキップして競合を防ぐ
      if (event && event.transaction.origin === 'local') return;
      const nodesArray = Array.from(yNodes.values());
      setNodes(nodesArray);
    };

    const observeEdges = (event) => {
      if (event && event.transaction.origin === 'local') return;
      const edgesArray = Array.from(yEdges.values());
      setEdges(edgesArray);
    };

    // 初期化時に既存のデータをロード（IndexedDBなどから）
    observeNodes();
    observeEdges();

    yNodes.observe(observeNodes);
    yEdges.observe(observeEdges);

    return () => {
      yNodes.unobserve(observeNodes);
      yEdges.unobserve(observeEdges);
    };
  }, [yNodes, yEdges, setNodes, setEdges]);

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <Background />
        <Controls />
        <Panel position="top-right" style={{ display: 'flex', gap: '10px' }}>
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