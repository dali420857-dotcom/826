import { useCallback, useEffect, useRef, useState } from 'react';
import type { DataUiClient } from '../ui';
import type { WorkItem } from '../schemas';

const syntheticCsv = [
  'customerRef,email,displayName,company',
  'customer-ada,ada@alpha.example.test,Ada Lovelace,Analytical Engines',
  'customer-grace,grace@beta.example.test,Grace Hopper,Compilers',
].join('\n');

const statusLabels: Record<WorkItem['status'], string> = {
  pending: '待處理',
  in_progress: '處理中',
  completed: '已完成',
  blocked: '阻塞',
};

const channelLabels: Record<WorkItem['emailStatus'], string> = {
  pending: '待處理',
  done: '完成',
  blocked: '阻塞',
};

export function DataWorkItemsPanel({ client }: { readonly client: DataUiClient }) {
  const [items, setItems] = useState<readonly WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [selectedItem, setSelectedItem] = useState<WorkItem>();
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const detailCloseRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await client.listWorkItems({ page: 1, pageSize: 20 });
      setItems(result.items);
    } catch {
      setError('資料讀取失敗，請先確認局域服務狀態。');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const closeDetails = useCallback(() => {
    setSelectedItem(undefined);
    window.setTimeout(() => detailTriggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!selectedItem) return;
    detailCloseRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeDetails();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeDetails, selectedItem]);

  const importSynthetic = async () => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const preview = await client.previewImport({
        source: { kind: 'inline', name: 'synthetic-data.csv', content: syntheticCsv },
      });
      await client.importBatch(preview.previewId);
      setNotice(`已導入 ${preview.rowCount} 筆合成資料。`);
      await load();
    } catch {
      setError('合成資料導入失敗。');
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (item: WorkItem, status: WorkItem['status']) => {
    setBusy(true);
    setError(undefined);
    try {
      await client.updateWorkItem({
        workItemId: item.workItemId,
        expectedVersion: item.version,
        status,
      });
      await load();
    } catch {
      setError('狀態更新失敗，可能是資料已被其他操作更新。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="data-work-items-title" className="data-workbench">
      <div className="data-workbench__heading">
        <div>
          <p className="eyebrow">DATA · SYNTHETIC READ MODEL</p>
          <h2 id="data-work-items-title">數據工單</h2>
          <p>導入後先建立客戶與工單，Email／TG 只讀取渠道狀態，不會發送真實訊息。</p>
        </div>
        <button disabled={busy} onClick={() => void importSynthetic()} type="button">
          導入合成資料
        </button>
      </div>
      {notice ? <p className="data-workbench__notice">{notice}</p> : null}
      {error ? <p role="alert" className="data-workbench__error">{error}</p> : null}
      {loading ? (
        <p>正在讀取工單…</p>
      ) : items.length === 0 ? (
        <p className="data-workbench__empty">尚無資料，請先導入合成資料。</p>
      ) : (
        <div className="data-workbench__table-wrap">
          <table className="data-workbench__table">
            <caption className="sr-only">數據工單列表</caption>
            <thead>
              <tr>
                <th scope="col">客戶</th>
                <th scope="col">公司</th>
                <th scope="col">總狀態</th>
                <th scope="col">Email</th>
                <th scope="col">TG</th>
                <th scope="col">負責人</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.workItemId}>
                  <td>
                    <strong>{item.customer.displayName}</strong>
                    <span className="data-workbench__muted">{item.customer.maskedEmail}</span>
                  </td>
                  <td>{item.customer.company}</td>
                  <td><span className={`data-status data-status--${item.status}`}>{statusLabels[item.status]}</span></td>
                  <td>{channelLabels[item.emailStatus]}</td>
                  <td>{channelLabels[item.telegramStatus]}</td>
                  <td>{item.owner ?? '未分配'}</td>
                  <td>
                    <button
                      onClick={(event) => {
                        detailTriggerRef.current = event.currentTarget;
                        setSelectedItem(item);
                      }}
                      type="button"
                    >
                      查看詳情
                    </button>
                    {item.status === 'pending' ? (
                      <button disabled={busy} onClick={() => void updateStatus(item, 'in_progress')} type="button">
                        標記處理中
                      </button>
                    ) : item.status === 'in_progress' ? (
                      <button disabled={busy} onClick={() => void updateStatus(item, 'completed')} type="button">
                        標記完成
                      </button>
                    ) : (
                      <span className="data-workbench__muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selectedItem ? (
        <div className="data-workbench__drawer-backdrop">
          <aside
            aria-labelledby="data-work-item-detail-title"
            aria-modal="true"
            className="data-workbench__drawer"
            role="dialog"
          >
            <div className="data-workbench__drawer-heading">
              <h3 id="data-work-item-detail-title">工單詳情</h3>
              <button ref={detailCloseRef} onClick={closeDetails} type="button">
                關閉
              </button>
            </div>
            <dl className="data-workbench__details">
              <dt>批次 ID</dt>
              <dd>{selectedItem.batchId}</dd>
              <dt>客戶 ID</dt>
              <dd>{selectedItem.customerId}</dd>
              <dt>工單 ID</dt>
              <dd>{selectedItem.workItemId}</dd>
              <dt>Email</dt>
              <dd>{selectedItem.customer.maskedEmail}</dd>
              <dt>公司</dt>
              <dd>{selectedItem.customer.company}</dd>
              <dt>Email 狀態</dt>
              <dd>{channelLabels[selectedItem.emailStatus]}</dd>
              <dt>TG 狀態</dt>
              <dd>{channelLabels[selectedItem.telegramStatus]}</dd>
              <dt>版本</dt>
              <dd>{selectedItem.version}</dd>
              <dt>建立時間</dt>
              <dd>{selectedItem.createdAt}</dd>
              <dt>更新時間</dt>
              <dd>{selectedItem.updatedAt}</dd>
            </dl>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
