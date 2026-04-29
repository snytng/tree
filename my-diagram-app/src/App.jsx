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
import { WebsocketProvider } from 'y-websocket'; // y-websocketはApp.jsxで直接使用するため、ルートのpackage.jsonにも必要
import { IndexeddbPersistence } from 'y-indexeddb';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { useNodeEditor } from './hooks/useNodeEditor';
import CustomNode from './hooks/CustomNode';
import { getLayoutedElements } from './utils/layoutEngine';
import mappingData from '../mapping.json';
import JSZip from 'jszip';

import specRaw from '../spec.md?raw';
import designRaw from '../design.md?raw';

const ROOM_NAME = 'react-flow-demo-room';
// Yjsドキュメントの初期化
const ydoc = new Y.Doc();
// 部屋名 'react-flow-demo-room' でWebRTCプロバイダーを設定
const provider = new WebrtcProvider(ROOM_NAME, ydoc);
// [D-023] MCP連携用のWebSocketプロバイダーを追加 (ローカルの同期サーバー経由)
const wsProvider = new WebsocketProvider('ws://localhost:1234', ROOM_NAME, ydoc);
// ローカルストレージ（IndexedDB）への永続化
const indexeddb = new IndexeddbPersistence(ROOM_NAME, ydoc);

const initialNodes = [];
const initialEdges = [];

// [D-027] 循環参照防止のための子孫チェックヘルパー
const isDescendant = (nodes, edges, parentId, potentialChildId) => {
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

function Flow() {
  const [nodes, setNodes, onNodesChangeState] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChangeState] = useEdgesState(initialEdges);
  const [isAutoLayout, setIsAutoLayout] = useState(true);
  const [projectName, setProjectName] = useState('New Project');
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [lastAddedNodeId, setLastAddedNodeId] = useState(null);
  const [isEdgeMode, setIsEdgeMode] = useState(false); // [B-005] エッジ追加モード
  const [edgeSourceId, setEdgeSourceId] = useState(null); // [B-005] エッジの接続元ノードID
  const [draggingNodeId, setDraggingNodeId] = useState(null); // [D-027] ドラッグ中のノードID
  const [focusMode, setFocusMode] = useState('none'); // [B-016] フォーカスモード
  const [isStructureMode, setIsStructureMode] = useState(false); // [修正] 「構成」モードの状態管理
  const [lastCalculatedPos, setLastCalculatedPos] = useState(null); // [D-029] 最後に計算された論理位置

  // [D-027] ハイライト状態を安定させ、チャタリングを防ぐためのRef
  const lastTargetIdRef = React.useRef(null);
  const lastSourceIdRef = React.useRef(null);

  const clearHighlights = useCallback(() => {
    document.querySelectorAll('.drag-target-highlight')
      .forEach(el => el.classList.remove('drag-target-highlight'));
    lastTargetIdRef.current = null;
    lastSourceIdRef.current = null;
    setLastCalculatedPos(null);
  }, []);

  // [修正] モードの切り替え（配置 ↔ 構成）をグローバルに監視
  useEffect(() => {
    const onKeyDown = (e) => { 
      if (e.key === 'Shift' && !e.repeat) {
        setIsStructureMode(true); 
      }
    };
    const onKeyUp = (e) => { 
      if (e.key === 'Shift') {
        setIsStructureMode(false); 
      } 
    };
    const onBlur = () => setIsStructureMode(false); // ウィンドウ切り替え時のスタック防止

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // [修正] モードが「構成」から外れたら即座に色をリセット
  useEffect(() => {
    if (!isStructureMode) clearHighlights();
  }, [isStructureMode, clearHighlights]);

  // [D-014] キーボードナビゲーションを有効化
  useKeyboardNavigation(ydoc, nodes, edges, setNodes);

  // [B-001] インライン編集と Markdown 同期を有効化
  useNodeEditor(ydoc);

  // nodeTypesをコンポーネント内でmemo化して参照を安定させる
  const nodeTypes = useMemo(() => ({
    custom: CustomNode,
    default: CustomNode,
  }), []);

  // 最新の状態を常に参照するためのRef (クロージャ問題と連打対策)
  const nodesRef = React.useRef(nodes);
  const edgesRef = React.useRef(edges);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  const selectedNodeId = useMemo(() => nodes.find(n => n.selected)?.id, [nodes]);

  const { setCenter, getViewport, fitView, getIntersectingNodes, getIntersectingEdges } = useReactFlow();

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
  const yProjectFiles = ydoc.getMap('projectFiles'); // 動的なファイル保存用
  const yProjectMeta = ydoc.getMap('projectMeta'); // プロジェクト名などのメタデータ用

  // UndoManagerの設定
  const undoManager = useMemo(() => new Y.UndoManager([yNodes, yEdges], {
    trackedOrigins: new Set(['local', 'structural']) // structuralオリジンの変更もUndo対象に含める
  }), [yNodes, yEdges]);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Undo/Redoの履歴状態を監視
  useEffect(() => {
    const updateUndoRedoState = () => {
      setCanUndo(undoManager.canUndo());
      setCanRedo(undoManager.canRedo());
    };

    undoManager.on('stack-item-added', updateUndoRedoState);
    undoManager.on('stack-item-popped', updateUndoRedoState);

    updateUndoRedoState();

    return () => {
      undoManager.off('stack-item-added', updateUndoRedoState);
      undoManager.off('stack-item-popped', updateUndoRedoState);
    };
  }, [undoManager]);

  // React Flowの変更をYjsに反映させるハンドラー
  const onNodesChange = useCallback(
    (changes) => {
      // React Flow内部の状態を更新
      onNodesChangeState(changes);

      const hasStructuralChange = changes.some(c => c.type === 'remove');
      ydoc.transact(() => {
        changes.forEach((change) => {
          if (change.type === 'remove') {
            yNodes.delete(change.id);
          } else if (change.type === 'select') {
            // セレクションはローカルで完結させるため Yjs には書き込まない
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
      }, hasStructuralChange ? 'structural' : 'local');
    },
    [onNodesChangeState, yNodes, isAutoLayout] // setNodesを除去
  );

  const onEdgesChange = useCallback(
    (changes) => {
      onEdgesChangeState(changes);
      const hasStructuralChange = changes.some(c => c.type === 'remove');
      ydoc.transact(() => {
        changes.forEach((change) => {
          if (change.type === 'remove') {
            yEdges.delete(change.id);
          } else if (change.type === 'select') {
          }
        });
      }, hasStructuralChange ? 'structural' : 'local');
    },
    [onEdgesChangeState, yEdges]
  );

  const onConnect = useCallback(
    (params) => {
      // エッジのIDを生成してYjsに追加
      const edgeId = `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newEdge = { ...params, id: edgeId };
      
      // 即座にステートに反映
      const nextEdges = addEdge(newEdge, edgesRef.current.map(e => ({ ...e, selected: false })));
      const nextNodes = nodesRef.current.map(n => ({ ...n, selected: false }));
      const finalNodes = isAutoLayout ? getLayoutedElements(nextNodes, nextEdges) : nextNodes;

      setNodes(finalNodes);
      setEdges(nextEdges);
      nodesRef.current = finalNodes;
      edgesRef.current = nextEdges;

      ydoc.transact(() => {
        yEdges.set(edgeId, newEdge);
      }, 'structural');
    },
    [yNodes, yEdges, isAutoLayout, setNodes, setEdges]
  );

  // [B-005] ノードクリック時のハンドラ
  const onNodeClick = useCallback((event, node) => {
    if (isEdgeMode) {
      event.preventDefault(); // React Flowのデフォルト選択動作を抑制
      event.stopPropagation(); // onPaneClickが発火するのを防ぐ

      ydoc.transact(() => {
        yNodes.forEach((n, id) => {
          if (n.isEdgeSourceCandidate) {
            yNodes.set(id, { ...n, isEdgeSourceCandidate: false });
          }
        });

        if (!edgeSourceId) {
          // 1回目のクリック: 接続元ノードとしてマーク
          yNodes.set(node.id, { ...yNodes.get(node.id), isEdgeSourceCandidate: true });
          setEdgeSourceId(node.id);
        } else {
          // 2回目のクリック: エッジを作成
          onConnect({ source: edgeSourceId, target: node.id });

          // [修正] 接続先（ターゲット）ノードを選択状態にする
          const targetNode = yNodes.get(node.id);
          if (targetNode) {
            yNodes.set(node.id, { ...targetNode, isEdgeSourceCandidate: false });
          }

          // [修正] 接続元（ソース）の候補フラグを確実に折る
          const sourceNode = yNodes.get(edgeSourceId);
          if (sourceNode) {
            yNodes.set(edgeSourceId, { ...sourceNode, isEdgeSourceCandidate: false });
          }

          setEdgeSourceId(null);
          setIsEdgeMode(false);
        }
      }, 'structural');
    } else {
      // 通常のノード選択はonNodesChangeで処理されるため、ここでは何もしない
      // 必要であれば、ここで通常の選択ロジックを実装することも可能
    }
  }, [isEdgeMode, edgeSourceId, yNodes, onConnect]);

  // [B-005] キャンバス（背景）クリック時のハンドラ
  const onPaneClick = useCallback(() => {
    if (isEdgeMode && (edgeSourceId || isEdgeMode)) { // edgeSourceIdがあるか、モードがONなら
      ydoc.transact(() => {
        // 接続元候補のみをクリア（セレクションは各ユーザーのローカルで管理）
        yNodes.forEach((n, id) => {
          if (n.isEdgeSourceCandidate) {
            yNodes.set(id, { ...n, isEdgeSourceCandidate: false });
          }
        });
      }, 'structural');
      setEdgeSourceId(null);
      setIsEdgeMode(false); // モードも解除
    }
  }, [isEdgeMode, edgeSourceId, yNodes]);

  // ノードが追加された際に中央へ移動するエフェクト
  useEffect(() => {
    if (lastAddedNodeId) {
      const node = nodesRef.current.find((n) => n.id === lastAddedNodeId);
      if (node) {
        // 固定サイズ(180x60)の中心座標を計算
        const centerX = node.position.x + 90;
        const centerY = node.position.y + 30;

        // DOM要素に直接フォーカスを当てる（React Flowの内部選択を安定させる）
        const element = document.querySelector(`[data-id="${lastAddedNodeId}"]`);
        if (element instanceof HTMLElement) {
          element.focus();
        }

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
    const selectedNodeIds = new Set(nodesRef.current.filter(n => n.selected).map(n => n.id));

    // Yjs（共有データ）からの削除も一括で行う
    ydoc.transact(() => {
      selectedNodeIds.forEach(id => yNodes.delete(id));
      edgesRef.current.forEach((edge) => {
        if (edge.selected || selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target)) {
          yEdges.delete(edge.id);
        }
      });
    }, 'structural');
  }, [yNodes, yEdges]);

  // [D-027] ノード直接移動（Drag-and-Drop Re-parenting）のハンドラ
  const onNodeDragStart = useCallback((event, node) => {
    setDraggingNodeId(node.id);
  }, [setDraggingNodeId]);

  const onNodeDrag = useCallback((event, node) => {
    const currentMode = isStructureMode || event.shiftKey;
    if (!currentMode) {
      // 配置モード (Layout Mode)
      if (lastSourceIdRef.current || lastTargetIdRef.current) clearHighlights();

      // [D-029] ライブ・ローカルレイアウト
      if (isAutoLayout) {
        const tempNodes = nodesRef.current.map(n => 
          n.id === node.id ? { ...n, position: node.position } : n
        );
        
        // 論理的な配置を計算
        const layouted = getLayoutedElements(tempNodes, edgesRef.current);
        const myCalculated = layouted.find(n => n.id === node.id);
        
        if (myCalculated) {
          setLastCalculatedPos(myCalculated.position);
          
          // ドラッグ中の本人以外を計算後の位置に動かす（本人はマウスに追従）
          setNodes(layouted.map(n => 
            n.id === node.id ? { ...n, position: node.position } : n
          ));
        }
      }
      return;
    }
    
    const nodeWithDimensions = {
      ...node,
      width: node.width || 180,
      height: node.height || 60,
    };

    // 2. ターゲット（重ね先）の判定
    const intersections = getIntersectingNodes(nodeWithDimensions, true);
    const targetNode = intersections.find(n => n.id !== node.id && !isDescendant(nodesRef.current, edgesRef.current, node.id, n.id));
    const targetId = targetNode?.id || null;
    
    // ターゲットが前回と異なる場合のみ DOM を更新（チャタリング防止）
    if (targetId !== lastTargetIdRef.current) {
      // 旧ハイライト消去
      if (lastTargetIdRef.current) {
        const oldEl = document.querySelector(`[data-id="${lastTargetIdRef.current}"]`) || 
                      document.querySelector(`[data-testid="rf__edge-${lastTargetIdRef.current}"]`);
        oldEl?.classList.remove('drag-target-highlight');
      }
      
      // 新ハイライト適用
      if (targetId) {
        const newEl = document.querySelector(`[data-id="${targetId}"]`);
        newEl?.classList.add('drag-target-highlight');
        lastTargetIdRef.current = targetId;
      } else if (typeof getIntersectingEdges === 'function') {
        const edgeIntersections = getIntersectingEdges(nodeWithDimensions, true);
        const targetEdge = edgeIntersections?.[0];
        if (targetEdge) {
          const edgeEl = document.querySelector(`[data-testid="rf__edge-${targetEdge.id}"]`);
          edgeEl?.classList.add('drag-target-highlight');
          lastTargetIdRef.current = targetEdge.id;
        } else {
          lastTargetIdRef.current = null;
        }
      } else {
        lastTargetIdRef.current = null;
      }
    }
  }, [getIntersectingNodes, getIntersectingEdges, nodesRef, edgesRef, clearHighlights, isStructureMode]);

  const onNodeDragStop = useCallback((event, node) => {
    setDraggingNodeId(null);
    clearHighlights(); // ドロップ時に必ずハイライトをリセット

    // [重要] 構造変更の確定判断も管理下のステートに寄せる
    const isStructuralChange = isStructureMode;

    // [D-027] 自動レイアウトONの場合は、通常のドラッグ後もスナップバックさせるために structural を使用
    const origin = (isStructuralChange || isAutoLayout) ? 'structural' : 'local';

    // [修正] nodeオブジェクトに確実に寸法を持たせてから交差判定を行う
    const nodeWithDimensions = {
      ...node,
      width: node.width || 180,
      height: node.height || 60,
    };

    // [修正] 第二引数に true を渡し、一部でも重なれば検知するようにする
    const intersections = isStructuralChange ? getIntersectingNodes(nodeWithDimensions, true) : [];

    // 自分自身や自分の子孫でないノードをターゲットにする
    const targetNode = intersections.find(n => n.id !== node.id && !isDescendant(nodesRef.current, edgesRef.current, node.id, n.id));

    // [D-029] 最終的な論理配置を再計算して、全ノードの座標を確定させる準備
    const tempNodes = nodesRef.current.map(n => 
      n.id === node.id ? { ...n, position: node.position } : n
    );
    const finalLayout = isAutoLayout ? getLayoutedElements(tempNodes, edgesRef.current) : tempNodes;

    ydoc.transact(() => {
      // [D-029] 座標の確定: 計算された全ノードの座標を Yjs にコミットする
      // これにより、押し出された周りのノードの順序（Y座標）も確実に保存される
      finalLayout.forEach(layoutedNode => {
        const yNode = yNodes.get(layoutedNode.id);
        if (yNode) {
          // 座標を上書き（自動レイアウト時は計算値を、手動時はドロップ位置を保存）
          yNodes.set(layoutedNode.id, { ...yNode, position: layoutedNode.position });
        }
      });

      // [S-028] Shiftキーが押されている場合のみ構造変更を実行
      if (isStructuralChange) {
        if (targetNode) {
        // [D-027] ノードへのドロップ: 新しい親にする
        const currentEdges = Array.from(yEdges.values()).filter(Boolean);
        const existingParentEdges = currentEdges.filter(e => e.target === node.id);
        
        // ドロップ先が現在の親でない場合のみエッジを張り替える
        if (!existingParentEdges.some(e => e.source === targetNode.id)) {
          // 全ての既存の親との接続を削除
          existingParentEdges.forEach(e => yEdges.delete(e.id));
          
          const newEdgeId = `edge-dnd-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
          const newEdge = { 
            id: newEdgeId, 
            source: targetNode.id, 
            target: node.id,
            sourceHandle: null,
            targetHandle: null 
          };
          yEdges.set(newEdgeId, newEdge);

          // 自動レイアウト時の順序ヒント: 兄弟リストの末尾に配置
          if (isAutoLayout && yNode) {
            const siblings = currentEdges
              .filter(e => e.source === targetNode.id && e.target !== node.id)
              .map(e => yNodes.get(e.target))
              .filter(Boolean);
            const maxY = siblings.reduce((max, n) => Math.max(max, n.position?.y || 0), 0);
            yNodes.set(node.id, { ...yNode, position: { x: node.position.x, y: maxY + 1 } });
          }
        }
      } else {
        // ノードへのドロップがない場合、エッジへのドロップを確認
        const edgeIntersections = typeof getIntersectingEdges === 'function' ? getIntersectingEdges(nodeWithDimensions, true) : [];
        if (edgeIntersections.length > 0) {
          const targetEdge = edgeIntersections[0];

          // 自分の子孫を含むエッジへの割り込みは禁止（サイクル防止）
          if (isDescendant(nodesRef.current, edgesRef.current, node.id, targetEdge.source)) return;
          // 自分の直属のエッジには割り込めない
          if (targetEdge.source === node.id || targetEdge.target === node.id) return;

          const currentEdges = Array.from(yEdges.values()).filter(Boolean);
          const existingParentEdges = currentEdges.filter(e => e.target === node.id);

          // 全ての既存の親との接続を削除
          existingParentEdges.forEach(e => yEdges.delete(e.id));

          // 既存エッジを削除して間に挟む
          const { source: sourceId, target: targetId } = targetEdge;
          yEdges.delete(targetEdge.id);
          
          const e1Id = `edge-dnd-pre-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
          const e2Id = `edge-dnd-post-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
          
          yEdges.set(e1Id, { id: e1Id, source: sourceId, target: node.id, sourceHandle: null, targetHandle: null });
          yEdges.set(e2Id, { id: e2Id, source: node.id, target: targetId, sourceHandle: null, targetHandle: null });

          // 自動レイアウトのヒントとしてターゲットノードの座標を参考に設定
          const targetNodeObj = nodesRef.current.find(n => n.id === targetId);
          if (isAutoLayout && yNode && targetNodeObj) {
            yNodes.set(node.id, { ...yNode, position: { x: node.position.x, y: targetNodeObj.position.y - 0.5 } });
          }
        } else {
          // 空きスペースへのドロップ時は、座標の保存のみ行われ、自動レイアウトにより順序が更新される
        }
      }
    }
  }, origin);
  }, [getIntersectingNodes, getIntersectingEdges, isAutoLayout, yNodes, yEdges, yProjectMeta, nodesRef, edgesRef, isStructureMode, clearHighlights]);


  // MarkdownからIDとタイトルを抽出するヘルパー
  const extractMetadata = (text) => {
    // ## {セクション番号}. [ID] タイトル という形式に対応 (行頭マッチングを強化)
    const regex = /^\s*##.*\[([A-Z]-\d{3})\]\s*(.*)$/gm;
    const metadata = {};
    let match;
    while ((match = regex.exec(text)) !== null) {
      metadata[match[1]] = match[2].trim();
    }
    return metadata;
  };

  // プロジェクトのエクスポート (ZIP出力)
  const onExportProject = useCallback(async () => {
    const zip = new JSZip();
    
    // Markdownファイルの再構築と保存
    // yProjectFilesにデータがあればそれを使用、なければ現在のノードから再構築
    const exportedSpecContent = [];
    const exportedDesignContent = [];

    nodesRef.current.forEach(node => {
      if (node.id.startsWith('S-')) {
        exportedSpecContent.push(`## [${node.id}] ${node.data.label.replace(`${node.id}: `, '')}`);
      } else if (node.id.startsWith('D-')) {
        exportedDesignContent.push(`## [${node.id}] ${node.data.label.replace(`${node.id}: `, '')}`);
      }
    });

    // 既存のyProjectFilesの内容を優先しつつ、ノードから再構築した内容を追加
    const finalSpecContent = yProjectFiles.get('spec.md') || exportedSpecContent.join('\n\n');
    const finalDesignContent = yProjectFiles.get('design.md') || exportedDesignContent.join('\n\n');

    if (finalSpecContent) {
      zip.file('spec.md', finalSpecContent);
    }
    if (finalDesignContent) {
      zip.file('design.md', finalDesignContent);
    }

    // その他のyProjectFilesに保存されているファイルも追加
    yProjectFiles.forEach((content, filename) => {
      if (!['spec.md', 'design.md'].includes(filename)) { // spec.mdとdesign.mdは上記で処理済み
        zip.file(filename, content);
      }
    });

    // mapping.json の動的生成
    const currentMapping = edgesRef.current.map(edge => ({
      from: edge.source,
      to: edge.target,
      type: edge.label || 'realizes'
    }));
    zip.file('mapping.json', JSON.stringify(currentMapping, null, 2));
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${projectName || 'project'}-${Date.now()}.zip`;
    link.click();
  }, [yProjectFiles, projectName]); // Ref参照のためnodes, edgesを除去

  // プロジェクトのインポート (ZIP読み込み)
  const onImportProject = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    console.group('📂 Project Import Debug');
    console.log('1. Selected File:', file.name, `(${file.size} bytes)`);

    try {
      const zip = await JSZip.loadAsync(file);
      const filesData = {};
      let importedMapping = [];

      console.log('2. Unzipping files...');
      for (const [filename, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) continue;
        const content = await zipEntry.async('string');
        const baseName = filename.split('/').pop(); // フォルダ階層を無視してファイル名のみ取得
        
        if (baseName === 'mapping.json') {
          console.log('   - Found mapping.json');
          importedMapping = JSON.parse(content);
        } else if (baseName.endsWith('.md')) {
          console.log(`   - Found Markdown: ${baseName}`);
          filesData[baseName] = content;
        }
      }

      const allMetadata = {};
      Object.values(filesData).forEach(content => {
        Object.assign(allMetadata, extractMetadata(content));
      });

      console.log('3. Extracted IDs:', Object.keys(allMetadata));
      console.log('4. Mapping entries:', importedMapping.length);

      const newNodes = Object.entries(allMetadata).map(([id, title], idx) => ({
        id,
        type: 'custom',
        data: { label: `[${id}] ${title}` },
        position: { x: 0, y: idx * 10 }, // [D-004] 初期順序を座標で付与
        width: 180,
        height: 60,
      }));

      const newEdges = importedMapping.map((link, idx) => ({
        id: `e-${idx}`,
        source: link.from,
        target: link.to,
        label: link.type,
      }));

      console.log('5. Final data structure:', { nodes: newNodes.length, edges: newEdges.length });

      const newProjectName = file.name.replace('.zip', '');
      setProjectName(newProjectName); // 手元のステートを即座に更新

      // 描画後に全体が収まるように調整
      setTimeout(() => fitView({ duration: 800, padding: 0.2 }), 100);

      ydoc.transact(() => {
        yProjectMeta.set('name', newProjectName);
        yProjectFiles.clear();
        Object.entries(filesData).forEach(([name, content]) => {
          yProjectFiles.set(name, content);
        });

        yNodes.clear();
        newNodes.forEach(node => yNodes.set(node.id, node));

        yEdges.clear();
        newEdges.forEach(edge => yEdges.set(edge.id, edge));
      }, 'local');
      
      console.log('✅ Project imported successfully');
    } catch (error) {
      console.error('❌ Error importing project:', error);
    } finally {
      console.groupEnd();
    }
  }, [yNodes, yEdges, yProjectFiles, yProjectMeta, isAutoLayout, setProjectName, fitView]);

  // ドキュメントツリーをインポートする関数
  const onImportDocTree = useCallback(() => {
    console.log('onImportDocTree: Started');
    try {
      // yProjectFilesが空ならデフォルト（内蔵MD）を使用
      const hasDynamicFiles = yProjectFiles.size > 0;
      const specContent = hasDynamicFiles ? (yProjectFiles.get('spec.md') || specRaw) : specRaw;
      const designContent = hasDynamicFiles ? (yProjectFiles.get('design.md') || designRaw) : designRaw;

      const docMetadata = {
        ...extractMetadata(specContent),
        ...extractMetadata(designContent)
      };

      const newNodes = Object.entries(docMetadata).map(([id, title], idx) => ({
        id,
        type: 'custom',
        data: { label: `[${id}] ${title}` },
        position: { x: 0, y: idx * 10 }, // [D-004] 初期順序を座標で付与
        width: 180,
        height: 60,
      }));

      const newEdges = mappingData.map((link, index) => ({
        id: `e-doc-${index}`,
        source: link.from,
        target: link.to,
        label: link.type,
      }));

      console.log('onImportDocTree: Data generated', { nodesCount: newNodes.length, edgesCount: newEdges.length });

      // 全体が収まるように調整
      setTimeout(() => fitView({ duration: 800, padding: 0.2 }), 100);

      // 2. Yjsに共有
      ydoc.transact(() => {
        newNodes.forEach(node => yNodes.set(node.id, node));
        newEdges.forEach(edge => yEdges.set(edge.id, edge));
      }, 'local');

      setIsAutoLayout(true);
      console.log('onImportDocTree: Success');
    } catch (error) {
      console.error('onImportDocTree: Error occurred', error);
    }
  }, [yNodes, yEdges, yProjectFiles, setIsAutoLayout, fitView]);

  // ノードを追加する関数
  const onAddNode = useCallback(() => {
    // フォーカス競合を防ぐため、現在の入力要素やノードからフォーカスを外す
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    const id = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`[Action] Adding normal node: ${id}`);

    // [D-004] 現在のノードの中で最大の Y 座標を取得して、そのさらに下に配置する
    const maxY = nodesRef.current.reduce((max, n) => Math.max(max, n.position.y), 0);
    
    const label = `Node ${yNodes.size + 1}`;
    const newNode = {
      id,
      type: 'custom',
      data: { label },
      position: { x: 0, y: maxY + 10 }, 
      selected: true,
      width: 180,
      height: 60,
    };

    // 即座にローカルステートに反映（syncStateがlocal originを無視するため必要）
    const nextNodes = nodesRef.current.map(n => ({ ...n, selected: false })).concat(newNode);
    const nextEdges = edgesRef.current.map(e => ({ ...e, selected: false }));
    const finalNodes = isAutoLayout ? getLayoutedElements(nextNodes, nextEdges) : nextNodes;

    setNodes(finalNodes);
    setEdges(nextEdges);
    nodesRef.current = finalNodes;
    edgesRef.current = nextEdges;

    ydoc.transact(() => {
      // 共有データ上は selected: false として保存し、ローカルでのみ選択状態(true)を維持する
      yNodes.set(id, { ...newNode, selected: false });
    }, 'structural');

    setLastAddedNodeId(id);
  }, [yNodes, yEdges, setLastAddedNodeId, isAutoLayout, setNodes, setEdges]);

  // レイアウトデバッグ情報をクリップボードにコピーする関数
  const onCopyDebugInfo = useCallback(() => {
    const debugInfo = {
      isAutoLayout,
      projectName,
      nodes: nodesRef.current.map(n => ({ id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) })),
      edges: edgesRef.current.map(e => ({ source: e.source, target: e.target }))
    };
    const text = JSON.stringify(debugInfo, null, 2);
    navigator.clipboard.writeText(text);
    alert('レイアウト情報をクリップボードにコピーしました。Geminiに共有してください。');
  }, [isAutoLayout, projectName]);

  const onAddStructuredNode = useCallback((mode) => {
    // フォーカス競合を防ぐ
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    // Refから最新の状態を取得し、連打時も正確なベースノードを特定する
    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;

    const selectedNode = currentNodes.find(n => n.selected) || (currentNodes.length > 0 ? currentNodes[currentNodes.length - 1] : null);
    if (!selectedNode) return;

    console.log(`[Action] Adding ${mode} node. Base node:`, selectedNode.id);

    const nodeId = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const edgeId = `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const yNodes = ydoc.getMap('nodes');
    const yEdges = ydoc.getMap('edges');
    const sharedNodes = Array.from(yNodes.values());
    const sharedEdges = Array.from(yEdges.values());

    if (mode === 'parent') {
      const incomingEdges = sharedEdges.filter(e => e.target === selectedNode.id);
      const newNode = {
        id: nodeId,
        type: 'custom',
        data: { label: 'Parent Node' },
        position: { x: selectedNode.position.x - 360, y: selectedNode.position.y },
        selected: true,
        width: 180,
        height: 60,
      };

      const edgesToAdd = [];
      if (incomingEdges.length > 0) {
        incomingEdges.forEach((edge, idx) => {
          edgesToAdd.push({ id: `${edgeId}-p-${idx}`, source: edge.source, target: nodeId });
          edgesToAdd.push({ id: `${edgeId}-c-${idx}`, source: nodeId, target: selectedNode.id });
        });
      } else {
        edgesToAdd.push({ id: edgeId, source: nodeId, target: selectedNode.id });
      }

      const nextNodes = currentNodes.map(n => ({ ...n, selected: false })).concat(newNode);
      const nextEdges = currentEdges
        .filter(e => !incomingEdges.some(ie => ie.id === e.id))
        .map(e => ({ ...e, selected: false }))
        .concat(edgesToAdd);

      const finalNodes = isAutoLayout ? getLayoutedElements(nextNodes, nextEdges) : nextNodes;
      setNodes(finalNodes);
      setEdges(nextEdges);
      nodesRef.current = finalNodes;
      edgesRef.current = nextEdges;

      ydoc.transact(() => {
        yNodes.set(nodeId, { ...newNode, selected: false }); // 共有データ上は selected を持たない
        edgesToAdd.forEach(e => yEdges.set(e.id, e));
        incomingEdges.forEach(e => yEdges.delete(e.id));
      }, 'structural');

      setLastAddedNodeId(nodeId);
      return;
    }

    let parentId = null;
    if (mode === 'sibling' || mode === 'sibling-above') {
      const incomingEdge = sharedEdges.find(e => e.target === selectedNode.id);
      parentId = incomingEdge ? incomingEdge.source : null;
    } else {
      parentId = selectedNode.id;
    }

    // [D-004] 挿入位置の計算: 兄弟リストを取得して論理的な中間座標を決定する
    let siblings = [];
    if (parentId) {
      const siblingIds = sharedEdges.filter(e => e.source === parentId).map(e => e.target);
      siblings = sharedNodes.filter(n => siblingIds.includes(n.id));
    } else {
      const targetIds = new Set(sharedEdges.map(e => e.target));
      siblings = sharedNodes.filter(n => !targetIds.has(n.id));
    }

    siblings.sort((a, b) => (a.position?.y || 0) - (b.position?.y || 0));
    const currentIndex = siblings.findIndex(n => n.id === selectedNode.id);
    const currentSharedY = yNodes.get(selectedNode.id)?.position?.y || 0;
    
    let targetY;
    if (mode === 'child') {
      // 子ノード追加時は末尾に追加
      const childIds = sharedEdges.filter(e => e.source === selectedNode.id).map(e => e.target);
      const children = sharedNodes.filter(n => childIds.includes(n.id));
      const maxChildY = children.reduce((max, n) => Math.max(max, n.position?.y || 0), 0);
      targetY = maxChildY + 10;
    } else if (mode === 'sibling-above') {
      // 兄弟ノード（上）追加時
      if (currentIndex > 0) {
        const prevY = siblings[currentIndex - 1].position?.y || 0;
        targetY = (prevY + currentSharedY) / 2;
      } else {
        targetY = currentSharedY - 10;
      }
    } else {
      // 兄弟ノード追加時: 選択ノードの「次」があればその中間、なければ +10
      if (currentIndex !== -1 && currentIndex < siblings.length - 1) {
        const nextY = siblings[currentIndex + 1].position?.y || 0;
        targetY = (currentSharedY + nextY) / 2;
      } else {
        targetY = currentSharedY + 10;
      }
    }

    const newNode = {
      id: nodeId,
      type: 'custom',
      data: { label: `${mode === 'child' ? 'Child' : 'Sibling'} Node` },
      position: { x: selectedNode.position.x + 360, y: targetY },
      selected: true,
      width: 180,
      height: 60,
    };
    const newEdge = parentId ? { id: edgeId, source: parentId, target: nodeId } : null;

    // 即座にローカルステートに反映
    const nextNodes = currentNodes.map(n => ({ ...n, selected: false })).concat(newNode);
    const nextEdges = newEdge 
      ? addEdge(newEdge, currentEdges.map(e => ({ ...e, selected: false })))
      : currentEdges.map(e => ({ ...e, selected: false }));

    const finalNodes = isAutoLayout ? getLayoutedElements(nextNodes, nextEdges) : nextNodes;
    setNodes(finalNodes);
    setEdges(nextEdges);
    nodesRef.current = finalNodes;
    edgesRef.current = nextEdges;

    ydoc.transact(() => {
      yNodes.set(nodeId, { ...newNode, selected: false });
      if (newEdge) yEdges.set(edgeId, newEdge);
    }, 'structural');

    setLastAddedNodeId(nodeId);
  }, [yNodes, yEdges, setLastAddedNodeId, isAutoLayout, setNodes, setEdges]);

  // キーボードショートカットの制御
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 入力フォーム等にフォーカスがある場合は無視
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (['Enter', 'Insert', 'Delete', 'z', 'y'].includes(e.key)) console.log(`[Keyboard] Key pressed: ${e.key}`);
      
      // Undo: Ctrl+Z
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        undoManager.undo();
      }
      // Redo: Ctrl+Y
      if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        undoManager.redo();
      }
      // 子ノード追加: Insert
      if (e.key === 'Insert') {
        e.preventDefault();
        if (e.shiftKey) {
          onAddStructuredNode('parent');
        } else {
          onAddStructuredNode('child');
        }
      }
      // 兄弟ノード追加: Enter (下) / Shift + Enter (上)
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          onAddStructuredNode('sibling-above');
        } else {
          onAddStructuredNode('sibling');
        }
      }
      // 削除: Delete (既存の削除ボタン機能を呼び出し)
      if (e.key === 'Delete') {
        onDeleteSelected();
      }

      // [B-016] フォーカスモード切り替え: F
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        setFocusMode(prev => {
          if (prev === 'none') return 'both';
          if (prev === 'both') return 'upstream';
          if (prev === 'upstream') return 'downstream';
          return 'none';
        });
      }

      // [B-005] Escapeキーでエッジ追加モードを解除
      if (e.key === 'Escape') {
        if (isEdgeMode) {
          e.preventDefault();
          ydoc.transact(() => {
            yNodes.forEach((n, id) => { if (n.isEdgeSourceCandidate) yNodes.set(id, { ...n, isEdgeSourceCandidate: false }); });
          }, 'structural');
          setEdgeSourceId(null);
          setIsEdgeMode(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown); // Cleanup
  }, [undoManager, onAddStructuredNode, onDeleteSelected, isEdgeMode, edgeSourceId, yNodes, setIsEdgeMode, setEdgeSourceId, setFocusMode]);

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
      // [D-016] structuralオリジンの場合は、自分自身の変更であっても再レイアウトを走らせる
      if (event && event.transaction.origin === 'local') return;
      
      const nodesArray = Array.from(yNodes.values());
      const edgesArray = Array.from(yEdges.values());
      if (yProjectMeta.get('name')) setProjectName(yProjectMeta.get('name'));

      // [B-016] フォーカス対象（到達可能セット）の算出
      const focusSet = (focusMode === 'none') ? null : (() => {
        const selected = nodesArray.find(n => n.selected) || nodesRef.current.find(n => n.selected);
        if (!selected) return null;
        const nodeIds = new Set([selected.id]);
        const edgeIds = new Set();
        const adjF = {}; const adjB = {};
        edgesArray.forEach(e => {
          if (!adjF[e.source]) adjF[e.source] = []; adjF[e.source].push({t: e.target, id: e.id});
          if (!adjB[e.target]) adjB[e.target] = []; adjB[e.target].push({s: e.source, id: e.id});
        });
        const trav = (id, adj, dir) => {
          const q = [id]; const v = new Set([id]);
          while(q.length) {
            const c = q.pop();
            (adj[c] || []).forEach(edge => {
              const n = dir === 'f' ? edge.t : edge.s;
              if(!v.has(n)){ v.add(n); nodeIds.add(n); q.push(n); }
              edgeIds.add(edge.id);
            });
          }
        };
        if(focusMode === 'downstream' || focusMode === 'both') trav(selected.id, adjF, 'f');
        if(focusMode === 'upstream' || focusMode === 'both') trav(selected.id, adjB, 'b');
        return {nodeIds, edgeIds};
      })();

      const nextNodes = nodesArray.map((yNode) => {
        const localNode = nodesRef.current.find(n => n.id === yNode.id);
        return {
          ...yNode,
          width: 180,
          height: 60,
          selected: localNode ? localNode.selected : false, // ローカルの選択状態を優先
          hidden: focusSet ? !focusSet.nodeIds.has(yNode.id) : false,
          data: { ...yNode.data, isEdgeSourceCandidate: !!yNode.isEdgeSourceCandidate }
        };
      });

      const nextEdges = edgesArray.map(e => {
        const localEdge = edgesRef.current.find(ee => ee.id === e.id);
        return {
        ...e,
        selected: localEdge ? localEdge.selected : false,
        hidden: focusSet ? !focusSet.edgeIds.has(e.id) : false
        };
      });

      const finalNodes = isAutoLayout && nextNodes.length > 0
        ? getLayoutedElements(nextNodes, nextEdges)
        : nextNodes;

      setNodes(finalNodes);
      setEdges(nextEdges);
    };

    // 初期ロード
    syncState();

    yNodes.observe(syncState);
    yEdges.observe(syncState);
    yProjectMeta.observe(syncState);

    return () => {
      yNodes.unobserve(syncState);
      yEdges.unobserve(syncState);
      yProjectMeta.unobserve(syncState);
    };
  }, [yNodes, yEdges, yProjectMeta, setNodes, setEdges, isAutoLayout, edgeSourceId, focusMode, selectedNodeId]); // Dependencies updated

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
        .btn-icon {
          width: 40px;
          height: 40px;
          padding: 0;
          margin: 0;
          box-sizing: border-box;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .btn-icon::after {
          content: attr(data-tooltip);
          position: absolute;
          right: 50px;
          background: #333;
          background: rgba(26, 25, 43, 0.9);
          backdrop-filter: blur(4px);
          color: #fff;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          white-space: nowrap;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s;
        }
        .btn-icon:hover::after {
          opacity: 1;
        }
        .btn-icon:hover {
          background-color: #f8fafc !important;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .btn-icon svg {
          width: 20px;
          height: 20px;
        }
        /* 通常時のノードスタイル */
        .custom-node {
          box-sizing: border-box;
          border: 1px solid #777;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        /* 選択時の強調（赤枠） */
        .custom-node.selected {
          border: 2px solid #ff4d4d !important;
          box-shadow: 0 0 10px rgba(255, 77, 77, 0.5) !important;
        }
        /* エッジ接続元の候補（青枠） */
        .custom-node.edge-source-candidate {
          border: 3px solid #3b82f6 !important;
          box-shadow: 0 0 15px rgba(59, 130, 246, 0.6) !important;
        }
        /* [D-027] ドラッグターゲットのハイライト */
        .drag-target-highlight {
          box-shadow: 0 0 0 4px #3b82f6 !important;
          border-color: #3b82f6 !important;
          stroke: #3b82f6 !important;
        }
        /* 構成モード時にドラッグしている本人のスタイルを上書き（薄い赤） */
        .structure-mode-active .react-flow__node.dragging .custom-node {
          background: #fffafa !important;
          border: 2px solid #feb2b2 !important;
          box-shadow: 0 0 10px rgba(254, 178, 178, 0.4) !important;
        }
      `}</style>
      <ReactFlow
        className={isStructureMode ? 'structure-mode-active' : ''} // クラスを動的に付与
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick} // [B-005] ノードクリックハンドラを追加
        onPaneClick={onPaneClick} // [B-005] キャンバスクリックハンドラを追加
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        style={{ cursor: isEdgeMode ? 'crosshair' : 'inherit' }}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        // [S-028] 常にドラッグ自体は可能にする（自動レイアウト時はShift+ドラッグで構造編集するため）
        nodesDraggable={true} 
        zoomOnDoubleClick={false}
        fitView
      >
        <Background />
        <Controls />
        <Panel position="top-left">
          <div 
            style={{ 
              background: '#fff', 
              padding: '8px 12px', 
              borderRadius: '4px', 
              border: '2px solid #1a192b',
              boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
              cursor: isEditingProjectName ? 'default' : 'pointer'
            }}
            onClick={() => !isEditingProjectName && setIsEditingProjectName(true)}
          >
            <span style={{ fontSize: '10px', color: '#666', display: 'block', lineHeight: 1 }}>PROJECT</span>
            {isEditingProjectName ? (
              <input
                type="text"
                value={projectName}
                autoFocus
                onChange={(e) => {
                  const newName = e.target.value;
                  setProjectName(newName);
                  yProjectMeta.set('name', newName);
                }}
                onBlur={() => setIsEditingProjectName(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setIsEditingProjectName(false);
                  if (e.key === 'Escape') setIsEditingProjectName(false);
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  fontSize: '14px',
                  fontWeight: 'bold',
                  border: 'none',
                  outline: 'none',
                  width: '100%',
                  padding: 0,
                  margin: 0,
                  background: 'transparent',
                  fontFamily: 'inherit'
                }}
              />
            ) : (
              <strong style={{ fontSize: '14px' }}>{projectName}</strong>
            )}
          </div>
        </Panel>

        <Panel position="top-right" style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
          <button className="btn-icon" data-tooltip="デバッグ情報コピー" onClick={onCopyDebugInfo} style={{ backgroundColor: '#fff', border: '2px solid #6366f1', color: '#6366f1', borderRadius: '4px', cursor: 'pointer' }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v2H7v-2zm0 4h2v2H7v-2zm0-8h2v2H7V6zm4 4h6v2h-6v-2zm0 4h6v2h-6v-2zm0-8h6v2h-6V6z"/></svg>
          </button>
          <label className="btn-icon" data-tooltip="プロジェクト・インポート" style={{ backgroundColor: '#fff', border: '2px solid #4caf50', borderRadius: '4px', cursor: 'pointer', color: '#4caf50' }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            <input type="file" accept=".zip" onChange={onImportProject} style={{ display: 'none' }} />
          </label>
          <button className="btn-icon" data-tooltip="プロジェクト・エクスポート" onClick={onExportProject} style={{ backgroundColor: '#fff', border: '2px solid #4caf50', color: '#4caf50', borderRadius: '4px', cursor: 'pointer' }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 20h14v-2H5v2zM19 11l-7-7-7 7h4v6h6v-6h4z"/></svg>
          </button>
          <button className="btn-icon" data-tooltip="元に戻す (Ctrl+Z)" onClick={() => undoManager.undo()} disabled={!canUndo} style={{ backgroundColor: '#fff', border: `2px solid ${canUndo ? '#64748b' : '#e2e8f0'}`, color: canUndo ? '#64748b' : '#e2e8f0', borderRadius: '4px', cursor: canUndo ? 'pointer' : 'not-allowed', opacity: canUndo ? 1 : 0.5 }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
          </button>
          <button className="btn-icon" data-tooltip="やり直し (Ctrl+Y)" onClick={() => undoManager.redo()} disabled={!canRedo} style={{ backgroundColor: '#fff', border: `2px solid ${canRedo ? '#64748b' : '#e2e8f0'}`, color: canRedo ? '#64748b' : '#e2e8f0', borderRadius: '4px', cursor: canRedo ? 'pointer' : 'not-allowed', opacity: canRedo ? 1 : 0.5 }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>
          </button>
          <button
            className="btn-icon"
            data-tooltip={isAutoLayout ? "自動レイアウト解除" : "自動レイアウト適用"}
            onClick={() => {
              if (isAutoLayout) {
                ydoc.transact(() => {
                  nodes.forEach((node) => {
                    const yNode = yNodes.get(node.id);
                    if (yNode) {
                      yNodes.set(node.id, { ...yNode, position: node.position });
                    }
                  });
                }, 'local');
              }
              setIsAutoLayout(!isAutoLayout);
            }}
            style={{ 
              backgroundColor: isAutoLayout ? '#1a192b' : '#fff',
              color: isAutoLayout ? '#fff' : '#1a192b',
              border: '2px solid #1a192b',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.5 5.6L10 7L8.6 4.5L10 2L7.5 3.4L5 2L6.4 4.5L5 7L7.5 5.6ZM19.5 15.4L17 14L18.4 16.5L17 19L19.5 17.6L22 19L20.6 16.5L22 14L19.5 15.4ZM22 2L19.5 3.4L17 2L18.4 4.5L17 7L19.5 5.6L22 7L20.6 4.5L22 2ZM14.1 5.9L3 17L7 21L18.1 9.9L14.1 5.9ZM16.6 7.4L14.6 5.4L15.9 4.1L17.9 6.1L16.6 7.4Z"/></svg>
          </button>
          <button className="btn-icon" data-tooltip="ノードを追加" onClick={onAddNode} style={{ backgroundColor: '#fff', border: '2px solid #1a192b', borderRadius: '4px', cursor: 'pointer' }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          </button>
          <button className="btn-icon" data-tooltip="選択要素を削除" onClick={onDeleteSelected} style={{ backgroundColor: '#fff', border: '2px solid #ff9800', color: '#ff9800', borderRadius: '4px', cursor: 'pointer' }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
          <button className="btn-icon" data-tooltip="全リセット" onClick={onReset} style={{ backgroundColor: '#fff', border: '2px solid #f44336', color: '#f44336', borderRadius: '4px', cursor: 'pointer' }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          </button>
          {/* [B-016] フォーカスモードボタン */}
          <button
            className="btn-icon"
            data-tooltip={`フォーカスモード: ${focusMode}`}
            onClick={() => setFocusMode(prev => {
              if (prev === 'none') return 'both';
              if (prev === 'both') return 'upstream';
              if (prev === 'upstream') return 'downstream';
              return 'none';
            })}
            style={{ backgroundColor: focusMode !== 'none' ? '#8b5cf6' : '#fff', color: focusMode !== 'none' ? '#fff' : '#8b5cf6', border: '2px solid #8b5cf6', borderRadius: '4px', cursor: 'pointer' }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm-7 7H3v4c0 1.1.9 2 2 2h4v-2H5v-4zM5 5h4V3H5c-1.1 0-2 .9-2 2v4h2V5zm14-2h-4v2h4v4h2V5c0-1.1-.9-2-2-2zm0 16h-4v2h4c1.1 0 2-.9 2-2v-4h-2v4z"/></svg>
          </button>
          {/* [B-005] エッジ追加モードボタン */}
          <button
            className="btn-icon"
            data-tooltip={!isEdgeMode ? "エッジ追加モード開始" : (edgeSourceId ? "接続先を選択してください" : "接続元を選択してください")}
            onClick={() => {
              setIsEdgeMode(!isEdgeMode);
              setEdgeSourceId(null); // モード切り替え時に接続元をリセット
              ydoc.transact(() => { // 既存の候補状態をクリア
                yNodes.forEach((n, id) => { if (n.isEdgeSourceCandidate) yNodes.set(id, { ...n, isEdgeSourceCandidate: false }); });
              }, 'structural');
            }}
            style={{ backgroundColor: isEdgeMode ? '#3b82f6' : '#fff', color: isEdgeMode ? '#fff' : '#3b82f6', border: `2px solid ${isEdgeMode ? '#3b82f6' : '#e2e8f0'}`, borderRadius: '4px', cursor: 'pointer' }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 11V3H8v8H2v10h20V11h-6zm-6-6h4v6h-4V5zm-4 8h4v6H4v-6zm14 6h-4v-6h4v6z"/></svg>
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