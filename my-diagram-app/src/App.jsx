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
  SelectionMode, // 追加
} from 'reactflow';
import 'reactflow/dist/style.css';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { WebsocketProvider } from 'y-websocket'; // y-websocketはApp.jsxで直接使用するため、ルートのpackage.jsonにも必要
import { IndexeddbPersistence } from 'y-indexeddb';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { useViewSync } from './hooks/useViewSync';
import ViewSyncToolbar from './components/ViewSyncToolbar';
import { useNodeEditor } from './hooks/useNodeEditor';
import CustomNode from './hooks/CustomNode';
import { useFileIO } from './hooks/useFileIO';
import { getLayoutedElements } from './utils/layoutEngine';
import { isDescendant, parseHierarchyText, generateHierarchyText } from './utils/graphUtils';
import ModernToolbar from './components/ModernToolbar';

const ROOM_NAME = 'react-flow-demo-room';
// Yjsドキュメントの初期化
const ydoc = new Y.Doc();
// 部屋名 'react-flow-demo-room' でWebRTCプロバイダーを設定
const provider = new WebrtcProvider(ROOM_NAME, ydoc);
// [D-023] MCP連携用のWebSocketプロバイダーを追加 (ローカルの同期サーバー経由)
const wsProvider = new WebsocketProvider(`ws://${window.location.hostname}:1234`, ROOM_NAME, ydoc);
// ローカルストレージ（IndexedDB）への永続化
const indexeddb = new IndexeddbPersistence(ROOM_NAME, ydoc);

const initialNodes = [];
const initialEdges = [];

function Flow() {
  const [nodes, setNodes, onNodesChangeState] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChangeState] = useEdgesState(initialEdges);
  const [isAutoLayout, setIsAutoLayout] = useState(true);
  const [projectName, setProjectName] = useState('New Project');
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [lastAddedNodeId, setLastAddedNodeId] = useState(null);
  const [isAddNodeMode, setIsAddNodeMode] = useState(false); // [B-028] ノード追加モード
  const [isEdgeMode, setIsEdgeMode] = useState(false); // [B-005] エッジ追加モード
  const [edgeSourceId, setEdgeSourceId] = useState(null); // [B-005] エッジの接続元ノードID
  const [draggingNodeId, setDraggingNodeId] = useState(null); // [D-027] ドラッグ中のノードID
  const [focusMode, setFocusMode] = useState('none'); // [B-016] フォーカスモード
  const [isStructureMode, setIsStructureMode] = useState(false); // [修正] 「構成」モードの状態管理
  const [activeToolbarMenu, setActiveToolbarMenu] = useState(null); // ツールバーのサブメニュー管理

  // [D-027] ハイライト状態を安定させ、チャタリングを防ぐためのRef
  const lastTargetIdRef = React.useRef(null);
  const lastSourceIdRef = React.useRef(null);

  const clearHighlights = useCallback(() => {
    document.querySelectorAll('.drag-target-highlight')
      .forEach(el => el.classList.remove('drag-target-highlight'));
    lastTargetIdRef.current = null;
    lastSourceIdRef.current = null;
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

  // Yjsの共有型（Map）を取得。IDをキーにすることで、個別の要素を効率的に同期できる
  const yNodes = ydoc.getMap('nodes');
  const yEdges = ydoc.getMap('edges');
  const yProjectMeta = ydoc.getMap('projectMeta'); // プロジェクト名などのメタデータ用

  const selectedNodeId = useMemo(() => nodes.find(n => n.selected)?.id, [nodes]);

  // [B-024] 視点同期（プレゼンテーションモード）を有効化
  const viewSync = useViewSync(yProjectMeta, ydoc.clientID, selectedNodeId);

  // [B-019] 単一テキストファイル入出力
  const { exportProject, importProject } = useFileIO(yNodes, yEdges, yProjectMeta, projectName);

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

  const { setCenter, getViewport, fitView, getIntersectingNodes, getIntersectingEdges, flowToScreenPosition } = useReactFlow();

  // デフォルトのエッジオプションを定義
  const defaultEdgeOptions = useMemo(() => ({
    animated: false, // 必要であればアニメーションを有効に
    style: { strokeWidth: 2, stroke: '#333' }, // エッジのスタイル
    markerEnd: {
      type: MarkerType.ArrowClosed, // 終端を閉じた矢印にする
      color: '#333', // 矢印の色
    },
  }), []);

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

  // ノードを追加する関数（一番下に追加）
  const onAddNode = useCallback(() => {
    // フォーカス競合を防ぐため、現在の入力要素やノードからフォーカスを外す
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    const id = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`[Action] Adding normal node at bottom: ${id}`);

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

    const nextNodes = nodesRef.current.map(n => ({ ...n, selected: false })).concat(newNode);
    const nextEdges = edgesRef.current.map(e => ({ ...e, selected: false }));
    const finalNodes = isAutoLayout ? getLayoutedElements(nextNodes, nextEdges) : nextNodes;

    setNodes(finalNodes);
    setEdges(nextEdges);
    nodesRef.current = finalNodes;
    edgesRef.current = nextEdges;

    ydoc.transact(() => {
      yNodes.set(id, { ...newNode, selected: false });
    }, 'structural');

    setLastAddedNodeId(id);
  }, [yNodes, yEdges, setLastAddedNodeId, isAutoLayout, setNodes, setEdges]);

  // [B-029] ノードのクラスを一括更新する関数
  const onUpdateNodesClass = useCallback((className) => {
    const selectedNodes = nodesRef.current.filter(n => n.selected);
    if (selectedNodes.length === 0) return;

    // IDを保持しつつクラス名を除去するためのパターン
    const idPrefixRegex = /^(\[[A-Z0-9]+-\d+\]\s*)/i;
    const classPatternRegex = /^(?:\[[^\]]+\]|[^:：\s]+[:：])\s*/i;

    ydoc.transact(() => {
      selectedNodes.forEach(node => {
        const yNode = yNodes.get(node.id);
        if (!yNode) return;

        // ラベルから既存のクラス記法をクリーンアップ（IDは残す）
        const originalLabel = yNode.data.label || '';
        const idMatch = originalLabel.match(idPrefixRegex);
        const idPart = idMatch ? idMatch[1] : '';
        const labelWithoutId = originalLabel.substring(idPart.length);
        const cleanLabel = idPart + labelWithoutId.replace(classPatternRegex, '').trim();

        yNodes.set(node.id, {
          ...yNode,
          data: {
            ...yNode.data,
            nodeClass: className ? `node-class-${className.toLowerCase()}` : '',
            label: cleanLabel
          }
        });
      });
    }, 'structural');
    
    setActiveToolbarMenu(null); // メニューを閉じる
  }, [yNodes]);

  // [B-028] 構造的なノード追加（targetId指定に対応）
  const onAddStructuredNode = useCallback(
    (mode, targetId = null) => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;

      // 指定されたターゲットがあればそれを使用、なければ現在の選択または末尾のノード
      const baseNode = targetId
        ? currentNodes.find((n) => n.id === targetId)
        : currentNodes.find((n) => n.selected) || (currentNodes.length > 0 ? currentNodes[currentNodes.length - 1] : null);

      if (!baseNode) return;

      const nodeId = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const edgeId = `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const yNodes = ydoc.getMap('nodes');
      const yEdges = ydoc.getMap('edges');

      // 子ノード追加時の配置計算
      if (mode === 'child') {
        const childEdges = currentEdges.filter((e) => e.source === baseNode.id);
        const childNodes = currentNodes.filter((n) => childEdges.some((e) => e.target === n.id));
        const maxY = childNodes.reduce((max, n) => Math.max(max, n.position?.y || 0), baseNode.position.y - 10);

        const newNode = {
          id: nodeId,
          type: 'custom',
          data: { label: `Child of ${baseNode.data?.label || baseNode.id}` },
          position: { x: baseNode.position.x + 360, y: maxY + 10 },
          selected: true,
          width: 180,
          height: 60,
        };

        const newEdge = { id: edgeId, source: baseNode.id, target: nodeId };

        // [B-028] 即座にローカルステートに反映し、選択状態（フォーカス）を当てる
        const nextNodes = currentNodes.map(n => ({ ...n, selected: false })).concat(newNode);
        const nextEdges = addEdge(newEdge, currentEdges.map(e => ({ ...e, selected: false })));
        const finalNodes = isAutoLayout ? getLayoutedElements(nextNodes, nextEdges) : nextNodes;

        setNodes(finalNodes);
        setEdges(nextEdges);
        nodesRef.current = finalNodes;
        edgesRef.current = nextEdges;

        ydoc.transact(() => {
          yNodes.set(nodeId, { ...newNode, selected: false });
          yEdges.set(edgeId, newEdge);
        }, 'structural');

        setLastAddedNodeId(nodeId);
      } 
    },
    [yNodes, yEdges, isAutoLayout, setLastAddedNodeId, setNodes, setEdges]
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
    if (isAddNodeMode) {
      // [B-028] ノード追加モード時：クリックしたノードの子として追加
      onAddStructuredNode('child', node.id);
      setIsAddNodeMode(false);
    } else if (isEdgeMode) {
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
    }
  }, [isAddNodeMode, onAddStructuredNode, setIsAddNodeMode, isEdgeMode, edgeSourceId, yNodes, onConnect]);

  // [B-005] キャンバス（背景）クリック時のハンドラ
  const onPaneClick = useCallback(() => {
    if (isAddNodeMode) {
      // [B-028] ノード追加モード時：背景クリックで一番下に追加
      onAddNode();
      setIsAddNodeMode(false);
    } else if (isEdgeMode) {
      if (edgeSourceId || isEdgeMode) {
        ydoc.transact(() => {
          yNodes.forEach((n, id) => {
            if (n.isEdgeSourceCandidate) yNodes.set(id, { ...n, isEdgeSourceCandidate: false });
          });
        }, 'structural');
        setEdgeSourceId(null);
        setIsEdgeMode(false);
      }
    }
  }, [isAddNodeMode, onAddNode, setIsAddNodeMode, isEdgeMode, edgeSourceId, yNodes]);

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

  // [S-034] 階層構造のコピー (Ctrl+C)
  const onCopyHierarchy = useCallback(() => {
    const selectedNode = nodesRef.current.find(n => n.selected);
    if (!selectedNode) return;

    const text = generateHierarchyText(nodesRef.current, edgesRef.current, selectedNode.id);
    navigator.clipboard.writeText(text);
    console.log('[Clipboard] Hierarchy copied to clipboard');
  }, []);

  // [S-032] 階層構造のペースト (Ctrl+V)
  const onPasteHierarchy = useCallback((text) => {
    try {
      if (!text || !text.trim()) return;

      const { nodes: pastedNodes, edges: pastedEdges } = parseHierarchyText(text);
      if (pastedNodes.length === 0) return;

      const selectedNode = nodesRef.current.find(n => n.selected);
      const timestamp = Date.now();

      ydoc.transact(() => {
        // 1. 各ノードを登録
        pastedNodes.forEach(node => {
          yNodes.set(node.id, {
            ...node,
            width: 180,
            height: 60,
            selected: false,
            position: { x: (selectedNode?.position.x || 0) + 360, y: node.position.y }
          });
        });

        // 2. 内部の親子関係を登録
        pastedEdges.forEach(edge => yEdges.set(edge.id, edge));

        // 3. ペーストされたツリーのルートを現在の選択ノードに接続
        const pastedNodeIds = new Set(pastedNodes.map(n => n.id));
        const pastedRoots = pastedNodes.filter(n => !pastedEdges.some(e => e.target === n.id));
        
        if (selectedNode) {
          pastedRoots.forEach((root, idx) => {
            const edgeId = `edge-paste-link-${timestamp}-${idx}`;
            yEdges.set(edgeId, { id: edgeId, source: selectedNode.id, target: root.id });
          });
        }

        // 4. ペーストされた最初のノードを選択状態にする（ローカル）
        setNodes(nds => nds.map(n => ({
          ...n,
          selected: n.id === pastedNodes[0].id
        })));
        setLastAddedNodeId(pastedNodes[0].id);

      }, 'structural');
      console.log(`[Clipboard] Pasted ${pastedNodes.length} nodes from clipboard`);
    } catch (err) {
      console.error('[Clipboard] Failed to paste:', err);
    }
  }, [yNodes, yEdges, isAutoLayout, setNodes, setLastAddedNodeId]);

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

        if (layouted) {
          // ドラッグ中の本人以外を計算後の位置に動かす（本人はマウスに追従）
          setNodes(layouted.map(n => 
            n.id === node.id ? { ...n, position: node.position } : n
          ));

          // [B-024] プレゼンターの場合は、避けるノードの動きも他ユーザーへ同期
          if (viewSync.isPresenter) {
            ydoc.transact(() => {
              layouted.forEach(n => {
                const yNode = yNodes.get(n.id);
                // 位置が実際に変わっているノードのみ更新
                if (yNode && (Math.abs(yNode.position.x - n.position.x) > 0.5 || Math.abs(yNode.position.y - n.position.y) > 0.5)) {
                  yNodes.set(n.id, { ...yNode, position: n.position });
                }
              });
            }, 'local'); // local origin で送信（自分側での再レイアウトを抑制）
          }
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

    // [修正] ドラッグ停止時は、現在の全ノードの座標を「確定値」として保存するために structural を使用
    // これにより、手動モードでの座標が選択変更時にリセットされるのを防ぐ
    const origin = 'structural';

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

    // [D-029] レイアウト結果を取得（ONなら計算値、OFFなら現在の移動後ステート）
    const finalLayout = isAutoLayout 
      ? getLayoutedElements(tempNodes, edgesRef.current) 
      : tempNodes;

    ydoc.transact(() => {
      // [B-003] ドラッグ終了時は、全ノードの「現在の画面上の座標」を Yjs に保存する
      // これにより、手動モードへ移行した際や、選択変更時に位置が戻るのを防ぐ
      finalLayout.forEach(layoutedNode => {
        const yNode = yNodes.get(layoutedNode.id);
        if (yNode) {
          // 座標を上書きして固定
          yNodes.set(layoutedNode.id, { 
            ...yNode, 
            position: { x: layoutedNode.position.x, y: layoutedNode.position.y } 
          });
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
          if (isAutoLayout) {
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
          if (isAutoLayout && targetNodeObj) {
            yNodes.set(node.id, { ...yNode, position: { x: node.position.x, y: targetNodeObj.position.y - 0.5 } });
          }
        } else {
          // 空きスペースへのドロップ時は、座標の保存のみ行われ、自動レイアウトにより順序が更新される
        }
      }
      }
    }, 'structural');
  }, [getIntersectingNodes, getIntersectingEdges, isAutoLayout, yNodes, yEdges, yProjectMeta, nodesRef, edgesRef, isStructureMode, clearHighlights]);


  // レイアウトデバッグ情報をクリップボードにコピーする関数
  const onCopyDebugInfo = useCallback(() => {
    const selectedNodes = nodesRef.current.filter(n => n.selected);
    const isFiltering = selectedNodes.length > 0;
    const nodesToExport = isFiltering ? selectedNodes : nodesRef.current;
    const exportedNodeIds = new Set(nodesToExport.map(n => n.id));

    const debugInfo = {
      isAutoLayout,
      projectName,
      nodes: nodesToExport.map(n => ({ 
        id: n.id, 
        label: n.data?.label,
        nodeClass: n.data?.nodeClass,
        x: Math.round(n.position.x), 
        y: Math.round(n.position.y) 
      })),
      edges: edgesRef.current
        .filter(e => exportedNodeIds.has(e.source) && exportedNodeIds.has(e.target))
        .map(e => ({ source: e.source, target: e.target }))
    };
    const text = JSON.stringify(debugInfo, null, 2);
    navigator.clipboard.writeText(text);
    alert(isFiltering ? '選択中の要素のデバッグ情報をコピーしました。' : '全要素のデバッグ情報をコピーしました。');
  }, [isAutoLayout, projectName]);

  // キーボードショートカットの制御
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 入力フォーム等にフォーカスがある場合は無視
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (['Enter', 'Insert', 'Delete', 'z', 'y'].includes(e.key)) console.log(`[Keyboard] Key pressed: ${e.key}`);
      
      // [B-022] Copy/Paste Hierarchy
      if (e.ctrlKey && e.key === 'c') {
        // 入力要素にフォーカスがある場合は標準のコピーを許可
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
        e.preventDefault();
        onCopyHierarchy();
      }

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
        // クラス設定メニュー等のサブメニューを閉じる
        setActiveToolbarMenu(null);

        if (isAddNodeMode || isEdgeMode) {
          e.preventDefault();
          setIsAddNodeMode(false);
          ydoc.transact(() => {
            yNodes.forEach((n, id) => { if (n.isEdgeSourceCandidate) yNodes.set(id, { ...n, isEdgeSourceCandidate: false }); });
          }, 'structural');
          setEdgeSourceId(null);
          setIsEdgeMode(false);
        }
      }
    };

    const handlePaste = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      e.preventDefault();
      const text = e.clipboardData.getData('text');
      onPasteHierarchy(text);
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('paste', handlePaste);
    };
  }, [undoManager, onAddStructuredNode, onDeleteSelected, onCopyHierarchy, onPasteHierarchy, isAddNodeMode, setIsAddNodeMode, isEdgeMode, edgeSourceId, yNodes, setIsEdgeMode, setEdgeSourceId, setFocusMode, setActiveToolbarMenu]);

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
      // [修正] 以前は local origin を無視していましたが、ラベル編集による nodeClass の
      // 再計算を自分自身の画面でも即座に反映させるため、常に同期を実行します。
      // React Flow の setNodes はデータに変更がない限り再レンダリングを抑制するため、
      // ここでの early return は不要です。
      
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
        // [B-007/017] ラベルからクラス名を動的に解析 (再読み込み時の再現性を向上)
        const label = (yNode.data?.label || '').trim();
        const classRegex = /^(?:\[[A-Z0-9]+-\d+\]\s*)?(?:\[([^\]]+)\]|([^:：\s]+)[:：\s])/i;
        const match = label.match(classRegex);
        
        // [修正] NodeやChildなどの汎用ワードはクラスとして扱わない
        const parsedClassName = match ? (match[1] || match[2]).toLowerCase().trim() : '';
        const isGeneric = ['node', 'child', 'default'].includes(parsedClassName);

        // [D-044] 属性優先ロジック: 
        // UIから設定された nodeClass (属性) があればそれを最優先し、なければラベルから解析する
        const attrClass = yNode.data?.nodeClass;
        const nodeClass = (attrClass && attrClass !== '') 
          ? attrClass 
          : (match && !isGeneric ? `node-class-${parsedClassName}` : '');

        const localNode = nodesRef.current.find(n => n.id === yNode.id);
        return {
          ...yNode,
          width: 180,
          height: 60,
          selected: localNode ? localNode.selected : false, // ローカルの選択状態を優先
          hidden: focusSet ? !focusSet.nodeIds.has(yNode.id) : false,
          data: { 
            ...yNode.data, 
            nodeClass, // 解析済みクラス名を付与
            isEdgeSourceCandidate: !!yNode.isEdgeSourceCandidate,
            isPresenterSelected: yNode.id === viewSync.remoteSelectedNodeId
          }
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

      // [デバッグ] 同期状態のログ出力
      const isSyncingView = viewSync.isFollowing;
      // 視点追従中 (isFollowing) は、自身の自動レイアウト設定に関わらず、配信元の座標を優先する
      const shouldComputeLayout = isAutoLayout && !isSyncingView;

      const finalNodes = (shouldComputeLayout && nextNodes.length > 0)
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
  }, [yNodes, yEdges, yProjectMeta, setNodes, setEdges, isAutoLayout, edgeSourceId, focusMode, selectedNodeId, viewSync.isFollowing, viewSync.remoteSelectedNodeId]); // remoteSelectedNodeId を追加

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
        .btn-icon:hover {
          background-color: #f8fafc !important;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        /* [B-028] アクティブなボタンの反転表示 */
        .btn-icon.active {
          background-color: var(--active-bg) !important;
          color: #ffffff !important;
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
        }
        .btn-icon svg {
          width: 20px;
          height: 20px;
        }
        /* 通常時のノードスタイル */
        .custom-node {
          position: relative !important;
          overflow: visible !important;
          box-sizing: border-box;
          border: 1px solid #777;
          background-color: #ffffff;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        /* 選択時の強調（赤枠） */
        .custom-node.selected {
          border: 2px solid #ff4d4d !important;
          box-shadow: 0 0 10px rgba(255, 77, 77, 0.5) !important;
        }
        /* ノードクラス・バッジのスタイル */
        .node-class-badge {
          position: absolute !important;
          top: -12px !important;
          right: 10px !important;
          background-color: #3b82f6 !important;
          color: white !important;
          font-size: 10px !important;
          font-weight: bold !important;
          padding: 2px 6px !important;
          border-radius: 4px !important;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
          z-index: 100 !important;
          white-space: nowrap !important;
        }
        /* エッジ接続元の候補（青枠） */
        .custom-node.edge-source-candidate {
          border: 3px solid #3b82f6 !important;
          box-shadow: 0 0 15px rgba(59, 130, 246, 0.6) !important;
        }
        /* プレゼンターの選択（緑枠） */
        .custom-node.presenter-selected {
          border: 3px solid #22c55e !important;
          background-color: #f0fdf4 !important;
          box-shadow: 0 0 10px rgba(34, 197, 94, 0.5) !important;
        }
        /* [B-028] モード中のホバー強調（選択候補） */
        .selectable-mode-active .custom-node:hover:not(.edge-source-candidate) {
          background-color: #f0f9ff !important;
          border: 2px solid #0ea5e9 !important;
          box-shadow: 0 0 12px rgba(14, 165, 233, 0.4) !important;
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

        /* [D-043] ノードクラス別カラーマッピング (背景色を少し濃くして視認性を向上) */
        /* 強力な詳細度を確保するため、属性セレクタとクラスを組み合わせる */
        div.custom-node[class*="node-class-requirement"] { background-color: #fef3c7 !important; border-color: #f59e0b !important; }
        div.custom-node[class*="node-class-spec"] { background-color: #e0f2fe !important; border-color: #0ea5e9 !important; }
        div.custom-node[class*="node-class-design"] { background-color: #dcfce7 !important; border-color: #22c55e !important; }
        div.custom-node[class*="node-class-issue"] { background-color: #ffe4e6 !important; border-color: #e11d48 !important; }

        /* [D-043] クラス別バッジカラーのマッピング */
        div.custom-node[class*="node-class-requirement"] .node-class-badge { background-color: #f59e0b !important; }
        div.custom-node[class*="node-class-spec"] .node-class-badge { background-color: #0ea5e9 !important; }
        div.custom-node[class*="node-class-design"] .node-class-badge { background-color: #22c55e !important; }
        div.custom-node[class*="node-class-issue"] .node-class-badge { background-color: #e11d48 !important; }
        div.custom-node[class*="node-class-db"] .node-class-badge { background-color: #475569 !important; }
        div.custom-node[class*="node-class-process"] .node-class-badge { background-color: #6366f1 !important; }

        /* 形状マッピング */
        .custom-node.node-class-db { 
          border-style: double !important; 
          border-width: 4px !important; 
        }
        .custom-node.node-class-process { 
          border-radius: 20px !important; 
        }
        
        /* ホバー時の挙動（クラス付きノードでも優先順位を維持） */
        .selectable-mode-active .custom-node[class*="node-class-"]:hover {
          background-color: #f0f9ff !important;
          border: 2px solid #0ea5e9 !important;
          border-style: solid !important; /* DBなどの特殊形状もホバー時は一時的に戻す */
        }

        /* クラスセレクター・メニューのスタイル */
        .toolbar-menu-popout {
          position: absolute;
          right: 50px;
          top: 0;
          background: #ffffff;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          display: flex;
          flex-direction: row;
          padding: 4px;
          gap: 4px;
          box-shadow: -4px 0 15px rgba(0,0,0,0.1);
          z-index: 1002;
          animation: slideIn 0.2s ease-out;
        }
        @keyframes slideIn {
          from { transform: translateX(10px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
      <div onMouseMove={viewSync.handleMouseMove} style={{ width: '100%', height: '100%' }}>
        <ReactFlow
        className={`${isStructureMode ? 'structure-mode-active' : ''} ${isAddNodeMode || isEdgeMode ? 'selectable-mode-active' : ''}`}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick} // [B-005] ノードクリックハンドラを追加
        onPaneClick={onPaneClick} // [B-005] キャンバスクリックハンドラを追加
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onMove={viewSync.handleMove}
        onPaneMouseMove={viewSync.handleMouseMove}
        onConnect={onConnect}
        style={{ cursor: (isAddNodeMode || isEdgeMode) ? 'crosshair' : 'inherit' }}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        // [S-028] 常にドラッグ自体は可能にする（自動レイアウト時はShift+ドラッグで構造編集するため）
        nodesDraggable={true} 
        zoomOnDoubleClick={false}
        // [S-042/D-047] 操作体系の最適化 (Lucidchart 方式)
        panOnDrag={[1, 2]} 
        selectionOnDrag={true} 
        selectionMode={SelectionMode.Partial} 
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
        </ReactFlow>

        {/* [D-039] データ駆動型ツールバー構成 - フローティングUIのためReactFlowの外に配置 */}
        {(() => {
          const toolbarConfig = [
            {
              id: 'undo',
              tooltip: '元に戻す (Ctrl+Z)',
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>,
              onClick: () => undoManager.undo(),
              disabled: !canUndo
            },
            {
              id: 'redo',
              tooltip: 'やり直し (Ctrl+Y)',
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>,
              onClick: () => undoManager.redo(),
              disabled: !canRedo
            },
            { id: 'sep1', type: 'divider' },
            {
              id: 'addnode',
              tooltip: isAddNodeMode ? '追加先を選択（背景なら一番下、ノードなら子）' : 'ノード追加モード開始',
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19,3H5C3.9,3 3,3.9 3,5V19C3,20.1 3.9,21 5,21H19C20.1,21 21,20.1 21,19V5C21,3.9 20.1,3 19,3M19,19H5V5H19V19Z"/></svg>,
              onClick: () => {
                const nextMode = !isAddNodeMode;
                setIsAddNodeMode(nextMode);
                if (nextMode) {
                  setIsEdgeMode(false);
                  setEdgeSourceId(null);
                  ydoc.transact(() => {
                    yNodes.forEach((n, id) => { if (n.isEdgeSourceCandidate) yNodes.set(id, { ...n, isEdgeSourceCandidate: false }); });
                  }, 'structural');
                }
              },
              active: isAddNodeMode,
              activeColor: '#10b981'
            },
            {
              id: 'edgemode',
              tooltip: !isEdgeMode ? "エッジ追加モード開始" : (edgeSourceId ? "接続先を選択してください" : "接続元を選択してください"),
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13,7V10H5V14H13V17L18,12L13,7Z"/></svg>,
              onClick: () => {
                const nextMode = !isEdgeMode;
                setIsEdgeMode(nextMode);
                if (nextMode) setIsAddNodeMode(false);
                setEdgeSourceId(null);
                ydoc.transact(() => {
                  yNodes.forEach((n, id) => { if (n.isEdgeSourceCandidate) yNodes.set(id, { ...n, isEdgeSourceCandidate: false }); });
                }, 'structural');
              },
              active: isEdgeMode,
              activeColor: '#3b82f6'
            },
            {
              id: 'delete',
              tooltip: '選択要素を削除',
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>,
              onClick: onDeleteSelected,
              style: { color: '#ef4444' }
            },
            { id: 'sep2', type: 'divider' },
            {
              id: 'class-selector',
              tooltip: '属性（クラス）を一括設定',
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.86L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z"/></svg>,
              onClick: () => setActiveToolbarMenu(activeToolbarMenu === 'class' ? null : 'class'),
              active: activeToolbarMenu === 'class',
              component: (props) => (
                <div className={props.className} style={{ position: 'relative' }}>
                  <button className="btn-icon" onClick={props.onClick} data-tooltip={props.tooltip} style={{ ...props.style, border: 'none', background: 'transparent', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'inherit' }}>{props.icon}</button>
                  {activeToolbarMenu === 'class' && (
                    <div className="toolbar-menu-popout">
                      {['Requirement', 'Spec', 'Design', 'Issue', 'DB', 'Process', ''].map(cls => {
                        const classColors = {
                          Requirement: '#f59e0b',
                          Spec: '#0ea5e9',
                          Design: '#22c55e',
                          Issue: '#e11d48',
                          DB: '#475569',
                          Process: '#6366f1',
                          '': '#ffffff'
                        };
                        const color = classColors[cls];
                        return (
                          <button 
                            key={cls} 
                            className={`btn-icon-small ${cls ? `node-class-${cls.toLowerCase()}` : ''}`} 
                            onClick={(e) => { e.stopPropagation(); onUpdateNodesClass(cls); }} 
                            data-tooltip={cls ? `${cls}クラスを適用` : 'クラスを解除'} 
                            style={{ 
                              width: '32px', 
                              height: '32px', 
                              fontSize: '11px', 
                              fontWeight: 'bold', 
                              border: '1px solid #ddd', 
                              borderRadius: '4px',
                              cursor: 'pointer', 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'center', 
                              background: color,
                              color: cls ? '#fff' : '#666',
                              transition: 'transform 0.1s'
                            }}
                          >
                            {cls ? cls[0] : '✕'}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )
            },
            {
              id: 'reset',
              tooltip: '全リセット',
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>,
              onClick: onReset,
              style: { color: '#ef4444' }
            },
            { id: 'sep3', type: 'divider' },
            {
              id: 'autolayout',
              tooltip: isAutoLayout ? "自動レイアウト解除" : "自動レイアウト適用",
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.5 5.6L10 7L8.6 4.5L10 2L7.5 3.4L5 2L6.4 4.5L5 7L7.5 5.6ZM19.5 15.4L17 14L18.4 16.5L17 19L19.5 17.6L22 19L20.6 16.5L22 14L19.5 15.4ZM22 2L19.5 3.4L17 2L18.4 4.5L17 7L19.5 5.6L22 7L20.6 4.5L22 2ZM14.1 5.9L3 17L7 21L18.1 9.9L14.1 5.9ZM16.6 7.4L14.6 5.4L15.9 4.1L17.9 6.1L16.6 7.4Z"/></svg>,
              onClick: () => setIsAutoLayout(!isAutoLayout),
              active: isAutoLayout,
              activeColor: '#6366f1'
            },
            {
              id: 'focus',
              tooltip: `フォーカスモード: ${focusMode}`,
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm-7 7H3v4c0 1.1.9 2 2 2h4v-2H5v-4zM5 5h4V3H5c-1.1 0-2 .9-2 2v4h2V5zm14-2h-4v2h4v4h2V5c0-1.1-.9-2-2-2zm0 16h-4v2h4c1.1 0 2-.9 2-2v-4h-2v4z"/></svg>,
              onClick: () => setFocusMode(prev => (prev === 'none' ? 'both' : prev === 'both' ? 'upstream' : prev === 'upstream' ? 'downstream' : 'none')),
              active: focusMode !== 'none',
              activeColor: '#8b5cf6'
            },
            { id: 'sep4', type: 'divider' },
            {
              id: 'import',
              tooltip: 'プロジェクト・インポート',
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>,
              component: (props) => (
                <label className="btn-icon" {...props} style={{ cursor: 'pointer' }}>
                  {props.icon}
                  <input type="file" accept=".md" onChange={(e) => importProject(e.target.files[0])} style={{ display: 'none' }} />
                </label>
              )
            },
            {
              id: 'export',
              tooltip: 'プロジェクト・エクスポート',
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 20h14v-2H5v2zM19 11l-7-7-7 7h4v6h6v-6h4z"/></svg>,
              onClick: exportProject
            },
            { id: 'sep5', type: 'divider' },
            {
              id: 'debug',
              tooltip: 'デバッグ情報コピー',
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v2H7v-2zm0 4h2v2H7v-2zm0-8h2v2H7V6zm4 4h6v2h-6v-2zm0 4h6v2h-6v-2zm0-8h6v2h-6V6z"/></svg>,
              onClick: onCopyDebugInfo
            }
          ];

          return (
            <ModernToolbar>
              {toolbarConfig.map((item) => {
                if (item.type === 'divider') {
                  return <hr key={item.id} className="toolbar-divider" />;
                }
                const Component = item.component || 'button';
                return (
                  <Component
                    key={item.id}
                    className={`btn-icon ${item.active ? 'active' : ''}`}
                    active={item.active}
                    tooltip={item.tooltip}
                    data-tooltip={item.tooltip}
                    onClick={item.onClick}
                    disabled={item.disabled}
                    style={{ 
                      '--active-bg': item.activeColor || '#3b82f6',
                      ...item.style 
                    }}
                    icon={item.icon}
                  >
                    {item.icon}
                  </Component>
                );
              })}
            </ModernToolbar>
          );
        })()}

        {/* [B-024] 視点同期ツールバー */}
        <ViewSyncToolbar sync={viewSync} />

        {/* [B-025] プレゼンターのマウスポインタ (Remote Cursor) - 独立したフローティングUIとして配置 */}
        {!viewSync.isPresenter && viewSync.isFollowing && viewSync.remoteCursor && (() => {
          const screenPos = flowToScreenPosition({ x: viewSync.remoteCursor.x, y: viewSync.remoteCursor.y });
          if (!screenPos) return null;
          return (
          <div 
            style={{
              position: 'fixed',
              transform: `translate(${screenPos.x}px, ${screenPos.y}px)`,
              left: 0,
              top: 0,
              width: '12px',
              height: '12px',
              backgroundColor: '#22c55e',
              borderRadius: '50%',
              pointerEvents: 'none',
              zIndex: 10000,
              marginTop: '-6px',
              marginLeft: '-6px',
              boxShadow: '0 0 10px rgba(34, 197, 94, 0.8)',
              border: '2px solid white'
            }}
          >
            <div style={{ position: 'absolute', top: '15px', left: '15px', backgroundColor: '#22c55e', color: 'white', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap', fontWeight: 'bold' }}>
              Presenter
            </div>
          </div>
          );
        })()}
      </div>
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