import React from 'react';
import { Panel } from 'reactflow';

const ViewSyncToolbar = ({ sync }) => {
  const {
    isPresenter,
    isFollowing,
    currentPresenterId,
    startPresenting,
    stopPresenting,
    toggleFollow,
    resetViewSync
  } = sync;

  // 誰もプレゼンしておらず、自分もプレゼンターでない場合
  if (!currentPresenterId && !isPresenter) {
    return (
      <Panel position="bottom-center" className="view-sync-panel">
        <button onClick={startPresenting} className="btn-icon" data-tooltip="プレゼンを開始（視点を共有）">
          📢
        </button>
      </Panel>
    );
  }

  return (
    <Panel position="bottom-center" className="view-sync-panel">
      <div style={{ 
        display: 'flex', 
        gap: '12px', 
        alignItems: 'center', 
        backgroundColor: 'rgba(255, 255, 255, 0.9)', 
        padding: '6px 12px', 
        borderRadius: '20px', 
        boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
        border: isPresenter ? '2px solid #ff4d4f' : '1px solid #ddd'
      }}>
        {isPresenter ? (
          <>
            <span style={{ fontSize: '12px', color: '#ff4d4f', fontWeight: 'bold' }}>● プレゼン配信中</span>
            <button onClick={stopPresenting} className="btn-icon" data-tooltip="プレゼンを停止">
              ⏹️
            </button>
          </>
        ) : (
          <>
            <span style={{ fontSize: '12px', color: isFollowing ? '#3b82f6' : '#666', fontWeight: isFollowing ? 'bold' : 'normal' }}>
              {isFollowing ? '👁️ 視点を同期中' : '🔭 追従停止中'}
            </span>
            <button onClick={toggleFollow} className={`btn-icon ${isFollowing ? 'active' : ''}`} data-tooltip={isFollowing ? "手動操作するため追従を一時停止" : "プレゼンターの視点に戻る"}>
              {isFollowing ? '⏸️' : '▶️'}
            </button>
          </>
        )}
        <button onClick={resetViewSync} className="btn-icon" data-tooltip="視点共有をリセット（スタック時に使用）" style={{ marginLeft: '4px', opacity: 0.5 }}>
          🔄
        </button>
      </div>
    </Panel>
  );
};

export default ViewSyncToolbar;