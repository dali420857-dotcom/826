import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmailOutreachModule } from '../../../../src/modules/email';
import {
  createLocalEmailUiClient,
  EmailOutreachPage,
  type SyntheticEmailOutcome,
} from '../../../../src/modules/email/ui';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage(transform: (client: ReturnType<typeof createLocalEmailUiClient>) => ReturnType<typeof createLocalEmailUiClient> = (client) => client) {
  let outcome: SyntheticEmailOutcome = 'success';
  const service = createEmailOutreachModule({
    clock: { now: () => new Date('2026-08-17T12:00:00.000Z') },
    fakeOutcome: () => outcome,
  });
  const client = createLocalEmailUiClient(service, {
    setSyntheticOutcome(next) {
      outcome = next;
    },
  });
  const renderedClient = transform(client);
  const view = render(<EmailOutreachPage client={renderedClient} />);
  return { client, renderedClient, service, view };
}

describe('EmailOutreachPage', () => {
  it('runs the complete synthetic no-send workflow with masked readback', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { client } = renderPage();
    const readQueue = vi.spyOn(client, 'readQueue');

    expect(screen.getByRole('heading', { name: 'Email 外聯流程' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '正式發送（未啟用）' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '連接郵箱帳號（未啟用）' })).toBeDisabled();
    expect(screen.getByText('Monitoring only · synthetic · no-send')).toBeInTheDocument();
    await screen.findByText('本機流程可操作');

    fireEvent.click(screen.getByRole('button', { name: '載入合成聯絡人' }));
    expect(await screen.findByText('a***@alpha.example.test')).toBeInTheDocument();
    expect(screen.queryByText('ada@alpha.example.test')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '建立本機草稿' }));
    expect(await screen.findByText('待審核')).toBeInTheDocument();
    expect(screen.getByTestId('sanitized-preview')).toHaveTextContent('&lt;strong&gt;');

    fireEvent.change(screen.getByLabelText('郵件內容（會安全編碼）'), {
      target: { value: 'Unsaved {{firstName}}' },
    });
    expect(screen.getByText('未儲存變更')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批准目前版本' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '更新本機草稿' }));
    expect(await screen.findByText('待審核')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '批准目前版本' }));
    expect(await screen.findByText('已批准')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('郵件主旨'), {
      target: { value: 'Updated {{firstName}}' },
    });
    expect(screen.getByText('未儲存變更')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加入本機佇列' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '更新本機草稿' }));
    expect(await screen.findByText('批准已失效')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '批准目前版本' }));
    expect(await screen.findByText('已批准')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('合成結果'), { target: { value: 'success' } });
    fireEvent.click(screen.getByRole('button', { name: '加入本機佇列' }));
    expect(await screen.findAllByText('成功 · queued-local')).toHaveLength(2);
    expect(readQueue).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('郵件主旨'), { target: { value: 'Failure {{firstName}}' } });
    fireEvent.click(screen.getByRole('button', { name: '更新本機草稿' }));
    expect(await screen.findByText('批准已失效')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '批准目前版本' }));
    expect(await screen.findByText('已批准')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('合成結果'), { target: { value: 'failure' } });
    fireEvent.click(screen.getByRole('button', { name: '加入本機佇列' }));
    expect(await screen.findAllByText('失敗 · fake-failed')).toHaveLength(2);

    fireEvent.change(screen.getByLabelText('郵件主旨'), { target: { value: 'Unknown {{firstName}}' } });
    fireEvent.click(screen.getByRole('button', { name: '更新本機草稿' }));
    expect(await screen.findByText('批准已失效')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '批准目前版本' }));
    expect(await screen.findByText('已批准')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('合成結果'), { target: { value: 'unknown' } });
    fireEvent.click(screen.getByRole('button', { name: '加入本機佇列' }));
    expect(await screen.findAllByText('未知 · 需要對帳')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '更新本機草稿' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '批准目前版本' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '對帳為成功' }));
    expect(await screen.findAllByText('已對帳 · queued-local')).toHaveLength(2);
    expect(screen.getByText('批准已失效')).toBeInTheDocument();

    const audit = screen.getByRole('region', { name: 'Email 稽核記錄' });
    expect(audit).toHaveTextContent('email.import.previewed');
    expect(audit).toHaveTextContent('email.queue.reconciled');
    expect(audit).not.toHaveTextContent('@alpha.example.test');
    expect(audit).not.toHaveTextContent('Synthetic body');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('pauses and resumes the local workflow without enabling live controls', async () => {
    const { client } = renderPage();

    await screen.findByText('本機流程可操作');

    fireEvent.click(screen.getByRole('button', { name: '暫停本機流程' }));
    expect(await screen.findByText('本機流程已暫停')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '載入合成聯絡人' })).toBeDisabled();
    expect(client.getStatus()).toMatchObject({ paused: true });

    fireEvent.click(screen.getByRole('button', { name: '恢復本機流程' }));
    await waitFor(() => expect(client.getStatus()).toMatchObject({ paused: false }));
    expect(screen.getByRole('button', { name: '載入合成聯絡人' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '正式發送（未啟用）' })).toBeDisabled();
  });

  it.each([
    ['synchronous throw', () => { throw new Error('synthetic status failure'); }],
    ['never-settling call', () => new Promise<never>(() => undefined) as never],
  ])('fails initial status closed for a %s', async (_scenario, getStatus) => {
    expect(() => renderPage((client) => ({ ...client, getStatus }))).not.toThrow();

    expect(await screen.findByText('本機狀態不可用；流程已鎖定。', {}, { timeout: 2_000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '狀態不可用' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '載入合成聯絡人' })).toBeDisabled();
  });

  it.each([
    ['audit synchronous throw', (client: ReturnType<typeof createLocalEmailUiClient>) => ({
      ...client,
      readAudit: () => { throw new Error('synthetic initial audit failure'); },
    })],
    ['queue never settles', (client: ReturnType<typeof createLocalEmailUiClient>) => ({
      ...client,
      readQueue: () => new Promise<never>(() => undefined),
    })],
  ])('requires complete authoritative initial readback before enabling imports: %s', async (_scenario, transform) => {
    renderPage(transform);

    expect(await screen.findByText('本機狀態不可用；流程已鎖定。', {}, { timeout: 2_000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '載入合成聯絡人' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '狀態不可用' })).toBeDisabled();
  });

  it('fails resume closed when the client throws synchronously', async () => {
    renderPage((client) => ({
      ...client,
      resume: () => { throw new Error('synthetic resume failure'); },
    }));
    const pauseButton = await screen.findByRole('button', { name: '暫停本機流程' });
    await waitFor(() => expect(pauseButton).toBeEnabled());
    fireEvent.click(pauseButton);
    const resumeButton = await screen.findByRole('button', { name: '恢復本機流程' });
    await waitFor(() => expect(resumeButton).toBeEnabled());
    fireEvent.click(resumeButton);

    expect(await screen.findByText('本機狀態不可用；流程已鎖定。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '狀態不可用' })).toBeDisabled();
  });

  it.each([
    ['synchronous throw', () => { throw new Error('synthetic pause failure'); }],
    ['never-settling call', () => new Promise<never>(() => undefined) as never],
  ])('fails pause closed for a %s', async (_scenario, pause) => {
    renderPage((client) => ({ ...client, pause }));
    const pauseButton = await screen.findByRole('button', { name: '暫停本機流程' });
    await waitFor(() => expect(pauseButton).toBeEnabled());
    fireEvent.click(pauseButton);

    expect(await screen.findByText('本機狀態不可用；流程已鎖定。', {}, { timeout: 2_000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '狀態不可用' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '載入合成聯絡人' })).toBeDisabled();
  });

  it('announces held async work and exposes the workflow busy state', async () => {
    let release!: () => void;
    renderPage((client) => ({
      ...client,
      async previewImport(input) {
        await new Promise<void>((resolve) => { release = resolve; });
        return client.previewImport(input);
      },
    }));

    await screen.findByText('本機流程可操作');

    fireEvent.click(screen.getByRole('button', { name: '載入合成聯絡人' }));
    const controls = screen.getByTestId('email-workflow-controls');
    const liveStatus = screen.getByText('處理中…');
    expect(controls).toHaveAttribute('aria-busy', 'true');
    expect(controls).not.toContainElement(liveStatus);
    expect(screen.getByRole('button', { name: '載入合成聯絡人' })).toBeDisabled();

    await waitFor(() => expect(release).toBeTypeOf('function'));
    await act(async () => { release(); });
    expect(await screen.findByText('a***@alpha.example.test')).toBeInTheDocument();
    expect(controls).toHaveAttribute('aria-busy', 'false');
  });

  it('times out a hanging workflow read and locks instead of remaining busy', async () => {
    renderPage((client) => {
      let auditReads = 0;
      return {
        ...client,
        readAudit: () => {
          auditReads += 1;
          return auditReads === 1 ? client.readAudit() : new Promise<never>(() => undefined);
        },
      };
    });
    await screen.findByText('本機流程可操作');
    fireEvent.click(screen.getByRole('button', { name: '載入合成聯絡人' }));

    expect(await screen.findByText('本機操作逾時；結果未知，流程已鎖定並等待對帳。', {}, { timeout: 2_000 })).toBeInTheDocument();
    expect(screen.getByTestId('email-workflow-controls')).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByRole('button', { name: '載入合成聯絡人' })).toBeDisabled();
  });

  it('keeps a timed-out late workflow mutation locked after it settles', async () => {
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => { release = resolve; });
    const { client } = renderPage((localClient) => ({
      ...localClient,
      previewImport: async (input) => {
        await deferred;
        return localClient.previewImport(input);
      },
    }));
    await screen.findByText('本機流程可操作');
    fireEvent.click(screen.getByRole('button', { name: '載入合成聯絡人' }));

    expect(await screen.findByText('本機操作逾時；結果未知，流程已鎖定並等待對帳。', {}, { timeout: 2_000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '載入合成聯絡人' })).toBeDisabled();
    await act(async () => { release(); });
    await waitFor(() => expect(client.readAudit()).resolves.toEqual(expect.any(Array)));
    expect(screen.getByRole('button', { name: '載入合成聯絡人' })).toBeDisabled();
    expect(screen.getByText('本機操作逾時；結果未知，流程已鎖定並等待對帳。')).toBeInTheDocument();
  });

  it('preserves an unknown workflow mutation lock across route remount', async () => {
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => { release = resolve; });
    const { renderedClient, view } = renderPage((localClient) => ({
      ...localClient,
      previewImport: async (input) => {
        await deferred;
        return localClient.previewImport(input);
      },
    }));
    await screen.findByText('本機流程可操作');
    fireEvent.click(screen.getByRole('button', { name: '載入合成聯絡人' }));
    await screen.findByText('本機操作逾時；結果未知，流程已鎖定並等待對帳。', {}, { timeout: 2_000 });
    view.unmount();

    render(<EmailOutreachPage client={renderedClient} />);
    expect(await screen.findByText('本機操作結果未知；流程保持鎖定並等待對帳。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '載入合成聯絡人' })).toBeDisabled();
    await act(async () => { release(); });
    expect(screen.getByRole('button', { name: '載入合成聯絡人' })).toBeDisabled();
  });

  it('persists an in-flight mutation guard before its timeout across route remount', async () => {
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => { release = resolve; });
    const { renderedClient, view } = renderPage((localClient) => ({
      ...localClient,
      previewImport: async (input) => {
        await deferred;
        return localClient.previewImport(input);
      },
    }));
    await screen.findByText('本機流程可操作');
    fireEvent.click(screen.getByRole('button', { name: '載入合成聯絡人' }));
    await waitFor(() => expect(release).toBeTypeOf('function'));
    view.unmount();

    render(<EmailOutreachPage client={renderedClient} />);
    expect(await screen.findByText('本機操作結果未知；流程保持鎖定並等待對帳。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '暫停本機流程' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '載入合成聯絡人' })).toBeDisabled();
    await act(async () => { release(); });
    expect(screen.getByRole('button', { name: '載入合成聯絡人' })).toBeDisabled();
  });

  it('persists a normal unknown reconciliation key across route remount', async () => {
    const { renderedClient, view } = renderPage();
    await screen.findByText('本機流程可操作');
    fireEvent.click(screen.getByRole('button', { name: '載入合成聯絡人' }));
    await screen.findByText('a***@alpha.example.test');
    fireEvent.click(screen.getByRole('button', { name: '建立本機草稿' }));
    await screen.findByText('待審核');
    fireEvent.click(screen.getByRole('button', { name: '批准目前版本' }));
    await screen.findByText('已批准');
    fireEvent.change(screen.getByLabelText('合成結果'), { target: { value: 'unknown' } });
    fireEvent.click(screen.getByRole('button', { name: '加入本機佇列' }));
    await screen.findAllByText('未知 · 需要對帳');
    view.unmount();

    render(<EmailOutreachPage client={renderedClient} />);
    expect(await screen.findByText('本機佇列仍有未知結果；流程保持鎖定並等待對帳。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '暫停本機流程' })).toBeDisabled();
    const reconcileButton = screen.getByRole('button', { name: '對帳為成功' });
    expect(reconcileButton).toBeEnabled();
    fireEvent.click(reconcileButton);
    expect(await screen.findAllByText('已對帳 · queued-local')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '載入合成聯絡人' })).toBeEnabled();
  });

  it('fails closed when command outcome and queue readback disagree', async () => {
    renderPage((client) => ({ ...client, readQueue: async () => [] }));

    await screen.findByText('本機流程可操作');

    fireEvent.click(screen.getByRole('button', { name: '載入合成聯絡人' }));
    await screen.findByText('a***@alpha.example.test');
    fireEvent.click(screen.getByRole('button', { name: '建立本機草稿' }));
    await screen.findByText('待審核');
    fireEvent.click(screen.getByRole('button', { name: '批准目前版本' }));
    await screen.findByText('已批准');
    fireEvent.click(screen.getByRole('button', { name: '加入本機佇列' }));

    expect(await screen.findByText('本機讀回不一致；流程已鎖定，請停止並檢查。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加入本機佇列' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '更新本機草稿' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '批准目前版本' })).toBeDisabled();
  });

  it('latches a queue intent synchronously so a double trigger creates one record', async () => {
    const { client } = renderPage();
    await screen.findByText('本機流程可操作');
    fireEvent.click(screen.getByRole('button', { name: '載入合成聯絡人' }));
    await screen.findByText('a***@alpha.example.test');
    fireEvent.click(screen.getByRole('button', { name: '建立本機草稿' }));
    await screen.findByText('待審核');
    fireEvent.click(screen.getByRole('button', { name: '批准目前版本' }));
    await screen.findByText('已批准');
    const enqueueButton = screen.getByRole('button', { name: '加入本機佇列' });

    await act(async () => {
      enqueueButton.click();
      enqueueButton.click();
    });

    expect(await screen.findAllByText('成功 · queued-local')).toHaveLength(2);
    expect(await client.readQueue()).toHaveLength(1);
    expect(enqueueButton).toBeDisabled();

    await act(async () => {
      enqueueButton.click();
      enqueueButton.click();
    });
    expect(await client.readQueue()).toHaveLength(1);
  });

  it.each(['resolve', 'reject'] as const)(
    'isolates a replaced client from a stale mutation that later %ss',
    async (settlement) => {
      let release!: () => void;
      const deferred = new Promise<void>((resolve) => { release = resolve; });
      const first = renderPage((client) => ({
        ...client,
        previewImport: async (input) => {
          await deferred;
          if (settlement === 'reject') throw new Error('stale client failure');
          return client.previewImport(input);
        },
      }));
      await screen.findByText('本機流程可操作');
      fireEvent.click(screen.getByRole('button', { name: '載入合成聯絡人' }));
      await waitFor(() => expect(release).toBeTypeOf('function'));

      let secondOutcome: SyntheticEmailOutcome = 'success';
      const secondService = createEmailOutreachModule({
        clock: { now: () => new Date('2026-08-17T12:01:00.000Z') },
        fakeOutcome: () => secondOutcome,
      });
      const secondClient = createLocalEmailUiClient(secondService, {
        setSyntheticOutcome(next) { secondOutcome = next; },
      });
      first.view.rerender(<EmailOutreachPage client={secondClient} />);
      expect(await screen.findByText('本機流程可操作')).toBeInTheDocument();

      await act(async () => { release(); });
      await waitFor(() => expect(screen.getByText('本機流程可操作')).toBeInTheDocument());
      expect(screen.queryByText('a***@alpha.example.test')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '載入合成聯絡人' })).toBeEnabled();
    },
  );

  it('rejects a stale same-status queue item from an earlier operation', async () => {
    renderPage((client) => {
      let stale: Awaited<ReturnType<typeof client.readQueue>> | undefined;
      return {
        ...client,
        async readQueue() {
          const current = await client.readQueue();
          if (!stale && current.length) stale = [current[0]!];
          return stale ?? current;
        },
      };
    });

    await screen.findByText('本機流程可操作');

    fireEvent.click(screen.getByRole('button', { name: '載入合成聯絡人' }));
    await screen.findByText('a***@alpha.example.test');
    fireEvent.click(screen.getByRole('button', { name: '建立本機草稿' }));
    await screen.findByText('待審核');
    fireEvent.click(screen.getByRole('button', { name: '批准目前版本' }));
    await screen.findByText('已批准');
    fireEvent.click(screen.getByRole('button', { name: '加入本機佇列' }));
    await screen.findAllByText('成功 · queued-local');

    fireEvent.change(screen.getByLabelText('郵件主旨'), { target: { value: 'Second {{firstName}}' } });
    fireEvent.click(screen.getByRole('button', { name: '更新本機草稿' }));
    await screen.findByText('批准已失效');
    fireEvent.click(screen.getByRole('button', { name: '批准目前版本' }));
    await screen.findByText('已批准');
    fireEvent.click(screen.getByRole('button', { name: '加入本機佇列' }));
    expect(await screen.findByText('本機讀回不一致；流程已鎖定，請停止並檢查。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加入本機佇列' })).toBeDisabled();
  });
});
