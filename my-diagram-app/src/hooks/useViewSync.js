import { useState, useEffect, useCallback, useRef } from 'react';
import { useReactFlow } from 'reactflow';

export const useViewSync = (yProjectMeta, clientID, localSelectedNodeId) => {
  const { setViewport, getViewport, screenToFlowPosition } = useReactFlow();
  const [isPresenter, setIsPresenter] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [currentPresenterId, setCurrentPresenterId] = useState(null);
  const [remoteCursor, setRemoteCursor] = useState(null);
  const [remoteSelectedNodeId, setRemoteSelectedNodeId] = useState(null);
  const lastUpdateRef = useRef(0);
  const lastCursorUpdateRef = useRef(0);
  const isInternalChange = useRef(false);

  // リモートからの視点変更を監視
  useEffect(() => {
    const observer = () => {
      // [修正] 自分が配信者の場合は、他人の座標を追従する必要がないため終了
      if (isPresenter) {
        setRemoteCursor(null);
        setCurrentPresenterId(null);
        setRemoteSelectedNodeId(null);
        return;
      }

      const viewState = yProjectMeta.get('viewState');
      setRemoteSelectedNodeId(viewState?.selectedNodeId || null);
      
      setCurrentPresenterId(prevId => {
        const nextId = viewState?.presenterId || null;
        if (nextId) console.log(`[ViewSync] Current presenter: ${nextId}`);
        
        // プレゼンが開始された（null -> ID）場合、自動でフォローを有効にする
        if (!prevId && nextId && String(nextId) !== String(clientID)) {
          setIsFollowing(true);
        } else if (prevId && !nextId) {
          setIsFollowing(false);
        }
        
        return nextId;
      });

      // フォロー中かつ自分以外の更新であれば視点を移動
      if (isFollowing && viewState && String(viewState.presenterId) !== String(clientID)) {
        isInternalChange.current = true;
        setViewport(
          { x: viewState.x, y: viewState.y, zoom: viewState.zoom },
          { duration: 100 } // よりリアルタイムに近づけるためアニメーションを短縮
        );
        // アニメーション完了後にフラグを戻す
        setTimeout(() => { isInternalChange.current = false; }, 150);
      }

      // [B-025] リモートカーソルの更新
      const cursorState = yProjectMeta.get('cursorState');
      if (cursorState && String(cursorState.presenterId) !== String(clientID)) {
        setRemoteCursor(cursorState);
      } else {
        setRemoteCursor(null);
      }
    };

    yProjectMeta.observe(observer);
    return () => yProjectMeta.unobserve(observer);
  }, [yProjectMeta, isPresenter, isFollowing, clientID, setViewport]);

  // [B-025拡張] プレゼンターの選択ノード変更を同期
  useEffect(() => {
    if (isPresenter) {
      const viewport = getViewport();
      const now = Date.now();
      yProjectMeta.set('viewState', {
        ...viewport,
        presenterId: clientID,
        selectedNodeId: localSelectedNodeId,
        timestamp: now
      });
    }
  }, [isPresenter, localSelectedNodeId, clientID, yProjectMeta, getViewport]);

  // React Flow の onMove ハンドラ
  const handleMove = useCallback((event, viewport) => {
    if (isPresenter) {
      const now = Date.now();
      if (now - lastUpdateRef.current > 100) { // 100ms スロットリング
        yProjectMeta.set('viewState', {
          ...viewport,
          presenterId: clientID,
          selectedNodeId: localSelectedNodeId,
          timestamp: now
        });
        lastUpdateRef.current = now;
      }
    } else if (isFollowing && !isInternalChange.current && event) {
      // フォロー中にユーザーが自らキャンバスを動かした場合（eventが存在する場合）はフォロー解除
      setIsFollowing(false);
    }
  }, [isPresenter, isFollowing, yProjectMeta, clientID]);

  // [B-025] マウス移動ハンドラ
  const handleMouseMove = useCallback((event) => {
    if (!isPresenter) return;
    if (!screenToFlowPosition) return;
    const now = Date.now();
    if (now - lastCursorUpdateRef.current > 50) { // 50ms スロットリング
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      yProjectMeta.set('cursorState', {
        x: position.x,
        y: position.y,
        presenterId: clientID,
        timestamp: now
      });
      lastCursorUpdateRef.current = now;
    }
  }, [isPresenter, screenToFlowPosition, clientID, yProjectMeta]);

  const startPresenting = useCallback(() => {
    setIsPresenter(true);
    setIsFollowing(false);
    const viewport = getViewport();
    yProjectMeta.set('viewState', {
      ...viewport,
      presenterId: clientID,
      timestamp: Date.now()
    });
  }, [getViewport, yProjectMeta, clientID]);

  const stopPresenting = useCallback(() => {
    setIsPresenter(false);
    yProjectMeta.delete('viewState');
    yProjectMeta.delete('cursorState');
  }, [yProjectMeta]);

  const toggleFollow = useCallback(() => {
    setIsFollowing(prev => !prev);
  }, []);

  return {
    isPresenter,
    isFollowing,
    currentPresenterId,
    remoteCursor,
    remoteSelectedNodeId,
    startPresenting,
    stopPresenting,
    toggleFollow,
    handleMove,
    handleMouseMove
  };
};