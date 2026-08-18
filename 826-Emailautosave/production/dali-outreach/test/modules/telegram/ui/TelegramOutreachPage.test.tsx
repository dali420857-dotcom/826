import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  TelegramApprovalResult,
  TelegramPreviewResult,
  TelegramQueueResult,
  TelegramTargetPreviewResult,
} from '../../../../src/modules/telegram';
import {
  TelegramOutreachPage,
  type TelegramUiClient,
  type TelegramUiSnapshot,
} from '../../../../src/modules/telegram/ui';

afterEach(cleanup);

class SyntheticTelegramClient implements TelegramUiClient {
  snapshot: TelegramUiSnapshot = {
    maskedAccount: 'tg-***-4821',
    sessionState: 'ready',
    providerAccess: false,
    paused: false,
    reconciliationRequired: false,
  };

  outcome: TelegramQueueResult['outcome'] = 'success';
  lagUnknownSnapshot = false;
  failNextReadback = false;
  operationError?: Error;
  reconcileResultOverride?: TelegramQueueResult['outcome'];
  approveGate?: Promise<void>;
  preview?: TelegramPreviewResult;
  approval?: TelegramApprovalResult;
  readonly audit: Awaited<ReturnType<TelegramUiClient['readAudit']>>[number][] = [];

  async readSnapshot() {
    if (this.failNextReadback) {
      this.failNextReadback = false;
      throw new Error('READBACK_UNAVAILABLE');
    }
    return { ...this.snapshot };
  }
  async readAudit() { return [...this.audit]; }

  async previewTargets(): Promise<TelegramTargetPreviewResult> {
    if (this.operationError) throw this.operationError;
    this.audit.push({ type: 'telegram.targets-previewed' });
    return {
      targetPreviewId: 'tg-targets-1111111111111111',
      targets: [{ targetRef: 'synthetic:prospect_1', displayName: '合成聯絡人' }],
      targetSetHash: '1'.repeat(64),
      sessionState: this.snapshot.sessionState,
    };
  }

  async createMessage(input: Parameters<TelegramUiClient['createMessage']>[0]) {
    this.preview = {
      previewId: 'tg-preview-2222222222222222',
      targetPreviewId: input.targetPreviewId,
      renderedMessage: '你好 合成聯絡人\\.',
      binding: {
        schemaVersion: 1,
        contentHash: '2'.repeat(64),
        templateVersion: input.templateVersion,
        variablesVersion: input.variablesVersion,
        targetSetHash: '1'.repeat(64),
        expectedStateVersion: input.expectedStateVersion,
      },
      sessionState: this.snapshot.sessionState,
    };
    this.audit.push({ type: 'telegram.message-created' });
    return this.preview;
  }

  async reviseMessage(input: Parameters<TelegramUiClient['reviseMessage']>[0]) {
    this.approval = undefined;
    this.preview = {
      ...this.preview!,
      renderedMessage: '更新後 合成聯絡人\\.',
      binding: {
        ...this.preview!.binding,
        contentHash: '3'.repeat(64),
        templateVersion: input.templateVersion,
        variablesVersion: input.variablesVersion,
        expectedStateVersion: input.expectedStateVersion + 1,
      },
    };
    this.audit.push({ type: 'telegram.message-revised' });
    return this.preview;
  }

  async approveMessage(input: Parameters<TelegramUiClient['approveMessage']>[0]) {
    await this.approveGate;
    this.approval = {
      approvalId: 'tg-approval-3333333333333333',
      previewId: input.previewId,
      binding: input.binding,
    };
    this.audit.push({ type: 'telegram.approved' });
    return this.approval;
  }

  async enqueueLocal(): Promise<TelegramQueueResult> {
    if (!this.lagUnknownSnapshot) {
      this.snapshot = { ...this.snapshot, reconciliationRequired: this.outcome === 'unknown' };
    }
    this.audit.push({
      type: this.outcome === 'success' ? 'telegram.queued' : this.outcome === 'failure' ? 'telegram.enqueue-failure' : 'telegram.enqueue-unknown',
      outcome: this.outcome,
    });
    return { outcome: this.outcome, value: { queueReceipt: `fake-${this.outcome}` }, replayed: false };
  }

  async reconcile(outcome: 'success' | 'failure'): Promise<TelegramQueueResult> {
    const resultOutcome = this.reconcileResultOverride ?? outcome;
    if (resultOutcome !== 'unknown') this.snapshot = { ...this.snapshot, reconciliationRequired: false };
    this.audit.push({ type: 'telegram.reconciled', outcome: resultOutcome });
    return { outcome: resultOutcome, value: { queueReceipt: `reconciled-${resultOutcome}` }, replayed: false };
  }

  async pause() { this.snapshot = { ...this.snapshot, paused: true }; this.audit.push({ type: 'telegram.paused' }); return this.readSnapshot(); }
  async resume() { this.snapshot = { ...this.snapshot, paused: false }; this.audit.push({ type: 'telegram.resumed' }); return this.readSnapshot(); }
}

async function renderReady(client = new SyntheticTelegramClient()) {
  render(<TelegramOutreachPage client={client} />);
  await screen.findByText('tg-***-4821');
  return client;
}

async function advanceToApproval(client: SyntheticTelegramClient) {
  fireEvent.click(screen.getByRole('button', { name: '預覽合成目標' }));
  await screen.findByText('合成聯絡人');
  fireEvent.click(screen.getByRole('button', { name: '建立訊息預覽' }));
  await screen.findByText('你好 合成聯絡人\\.');
  fireEvent.click(screen.getByRole('button', { name: '批准目前內容' }));
  await screen.findByText(/已綁定批准/);
  return client;
}

describe('TelegramOutreachPage', () => {
  it('bounds a hanging initial read and offers an explicit safe recovery', async () => {
    const client = new SyntheticTelegramClient();
    client.readSnapshot = () => new Promise(() => {});
    const view = render(<TelegramOutreachPage client={client} />);

    expect(await screen.findByRole('alert', {}, { timeout: 800 })).toHaveTextContent('無法安全讀取');
    expect(screen.getByRole('button', { name: '重試安全讀回' })).toBeInTheDocument();

    client.readSnapshot = async () => ({ ...client.snapshot });
    fireEvent.click(screen.getByRole('button', { name: '重試安全讀回' }));
    expect(await screen.findByText('tg-***-4821')).toBeInTheDocument();
    view.unmount();
  });

  it('assimilates synchronous throws from both initial read calls without an unhandled error', async () => {
    for (const method of ['readSnapshot', 'readAudit'] as const) {
      const client = new SyntheticTelegramClient();
      client[method] = (() => { throw new Error('TOKEN:must-not-render'); }) as never;
      const view = render(<TelegramOutreachPage client={client} />);

      expect(await screen.findByRole('alert')).toHaveTextContent('無法安全讀取');
      expect(screen.queryByText(/must-not-render/)).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('keeps a timed-out mutation reconciliation-locked across same-client remount and ignores late completion', async () => {
    const client = await renderReady();
    let resolveLate!: (value: TelegramTargetPreviewResult) => void;
    client.previewTargets = () => new Promise((resolve) => { resolveLate = resolve; });

    fireEvent.click(screen.getByRole('button', { name: '預覽合成目標' }));
    expect(await screen.findByText(/結果未知/, {}, { timeout: 800 })).toBeInTheDocument();
    resolveLate({
      targetPreviewId: 'tg-targets-1111111111111111',
      targets: [{ targetRef: 'synthetic:prospect_1', displayName: '合成聯絡人' }],
      targetSetHash: '1'.repeat(64),
      sessionState: 'ready',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('合成聯絡人')).not.toBeInTheDocument();

    cleanup();
    render(<TelegramOutreachPage client={client} />);
    await screen.findByText('tg-***-4821');
    expect(screen.getByText(/結果未知/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '預覽合成目標' })).toBeDisabled();
  });

  it('persists reconciliation when a mutation resolves after route unmount', async () => {
    const client = await renderReady();
    let resolveLate!: (value: TelegramTargetPreviewResult) => void;
    client.previewTargets = () => new Promise((resolve) => { resolveLate = resolve; });
    fireEvent.click(screen.getByRole('button', { name: '預覽合成目標' }));
    await Promise.resolve();
    cleanup();
    resolveLate({
      targetPreviewId: 'tg-targets-1111111111111111',
      targets: [{ targetRef: 'synthetic:prospect_1', displayName: '合成聯絡人' }],
      targetSetHash: '1'.repeat(64),
      sessionState: 'ready',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    render(<TelegramOutreachPage client={client} />);
    await screen.findByText('tg-***-4821');
    expect(screen.getByText(/結果未知/)).toBeInTheDocument();
    expect(screen.queryByText('合成聯絡人')).not.toBeInTheDocument();
  });

  it('persists both reconciliation and unavailable locks when a mutation times out after route unmount', async () => {
    const client = await renderReady();
    client.previewTargets = () => new Promise(() => {});
    fireEvent.click(screen.getByRole('button', { name: '預覽合成目標' }));
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 350));

    render(<TelegramOutreachPage client={client} />);
    await screen.findByText('tg-***-4821');
    expect(screen.getByText(/結果未知/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重試安全讀回' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '對帳為成功' })).toBeDisabled();
  });

  it('persists both locks when post-mutation readback fails after route unmount', async () => {
    const client = await renderReady();
    let rejectReadback!: (reason: Error) => void;
    client.readAudit = () => new Promise((_resolve, reject) => { rejectReadback = reject; });
    fireEvent.click(screen.getByRole('button', { name: '預覽合成目標' }));
    await waitFor(() => expect(rejectReadback).toBeTypeOf('function'));
    cleanup();
    rejectReadback(new Error('READBACK_UNAVAILABLE'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    client.readAudit = async () => [...client.audit];
    render(<TelegramOutreachPage client={client} />);
    await screen.findByText('tg-***-4821');
    expect(screen.getByText(/結果未知/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重試安全讀回' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '對帳為失敗' })).toBeDisabled();
  });

  it('isolates a timed-out client lock from a different client identity', async () => {
    const timedOutClient = await renderReady();
    timedOutClient.previewTargets = () => new Promise(() => {});
    fireEvent.click(screen.getByRole('button', { name: '預覽合成目標' }));
    await screen.findByText(/結果未知/, {}, { timeout: 800 });

    cleanup();
    const differentClient = new SyntheticTelegramClient();
    render(<TelegramOutreachPage client={differentClient} />);
    await screen.findByText('tg-***-4821');
    expect(screen.queryByText(/結果未知/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '預覽合成目標' })).toBeEnabled();
  });

  it('fails closed on a synchronous mutation throw and unlocks only after explicit readback recovery', async () => {
    const client = await renderReady();
    client.previewTargets = (() => { throw new Error('TOKEN:sync-secret'); }) as never;

    fireEvent.click(screen.getByRole('button', { name: '預覽合成目標' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('未顯示未受信任');
    expect(screen.queryByText(/sync-secret/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '預覽合成目標' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '重試安全讀回' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '預覽合成目標' })).toBeEnabled());
  });

  it('bounds a hanging post-mutation audit read and exposes recovery without committing the result', async () => {
    const client = await renderReady();
    client.readAudit = () => new Promise(() => {});

    fireEvent.click(screen.getByRole('button', { name: '預覽合成目標' }));
    expect(await screen.findByText(/讀回失敗/, {}, { timeout: 800 })).toBeInTheDocument();
    expect(screen.queryByText('合成聯絡人')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '預覽合成目標' })).toBeDisabled();

    client.readAudit = async () => [...client.audit];
    fireEvent.click(screen.getByRole('button', { name: '重試安全讀回' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '對帳為失敗' })).toBeEnabled());
    expect(screen.getByText(/結果未知/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '預覽合成目標' })).toBeDisabled();
  });

  it('keeps an unavailable lock recoverable after same-client route remount', async () => {
    const client = new SyntheticTelegramClient();
    client.readSnapshot = () => new Promise(() => {});
    render(<TelegramOutreachPage client={client} />);
    await screen.findByRole('button', { name: '重試安全讀回' }, { timeout: 800 });

    client.readSnapshot = async () => ({ ...client.snapshot });
    cleanup();
    render(<TelegramOutreachPage client={client} />);
    await screen.findByText('tg-***-4821');
    expect(screen.getByRole('button', { name: '預覽合成目標' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重試安全讀回' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '預覽合成目標' })).toBeEnabled());
  });

  it('retains reconciliation but disables repeated reconcile when its postflight read hangs', async () => {
    const client = await renderReady();
    client.outcome = 'unknown';
    await advanceToApproval(client);
    fireEvent.click(screen.getByRole('button', { name: '加入本機佇列' }));
    await screen.findByText(/結果未知/);
    client.readAudit = () => new Promise(() => {});

    fireEvent.click(screen.getByRole('button', { name: '對帳為失敗' }));
    expect(await screen.findByRole('button', { name: '重試安全讀回' }, { timeout: 800 })).toBeInTheDocument();
    expect(screen.getByText(/結果未知/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '對帳為成功' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '對帳為失敗' })).toBeDisabled();

    client.readAudit = async () => [...client.audit];
    fireEvent.click(screen.getByRole('button', { name: '重試安全讀回' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '對帳為失敗' })).toBeEnabled());
    expect(screen.getByText(/結果未知/)).toBeInTheDocument();
  });

  it('retains reconciliation and requires readback recovery after a synchronous reconcile throw', async () => {
    const client = await renderReady();
    client.outcome = 'unknown';
    await advanceToApproval(client);
    fireEvent.click(screen.getByRole('button', { name: '加入本機佇列' }));
    await screen.findByText(/結果未知/);
    const reconcile = client.reconcile.bind(client);
    client.reconcile = (() => { throw new Error('TOKEN:reconcile-secret'); }) as never;

    fireEvent.click(screen.getByRole('button', { name: '對帳為失敗' }));
    expect(await screen.findByRole('button', { name: '重試安全讀回' })).toBeInTheDocument();
    expect(screen.queryByText(/reconcile-secret/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '對帳為失敗' })).toBeDisabled();

    client.reconcile = reconcile;
    fireEvent.click(screen.getByRole('button', { name: '重試安全讀回' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '對帳為失敗' })).toBeEnabled());
  });

  it('renders masked synthetic session evidence without live access controls', async () => {
    await renderReady();

    expect(screen.getByRole('heading', { name: 'Telegram 外聯工作台' })).toBeInTheDocument();
    expect(screen.getByText('tg-***-4821')).toBeInTheDocument();
    expect(screen.getByText('provider access: false')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.queryByText(/QR|token|登入|聊天|live send/i)).not.toBeInTheDocument();
  });

  it('fails closed instead of rendering unmasked session evidence', async () => {
    const client = new SyntheticTelegramClient();
    client.snapshot = { ...client.snapshot, maskedAccount: 'private-account-name' };
    render(<TelegramOutreachPage client={client} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('無法安全讀取');
    expect(screen.queryByText('private-account-name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '預覽合成目標' })).not.toBeInTheDocument();
  });

  it('fails closed for an invalid runtime session state', async () => {
    const client = new SyntheticTelegramClient();
    client.snapshot = { ...client.snapshot, sessionState: 'secret-session-state' as never };
    render(<TelegramOutreachPage client={client} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('無法安全讀取');
    expect(screen.queryByText('secret-session-state')).not.toBeInTheDocument();
  });

  it('fails closed instead of rendering unrecognized audit content', async () => {
    const client = new SyntheticTelegramClient();
    client.audit.push({ type: 'secret-bearing-provider-error' } as never);
    render(<TelegramOutreachPage client={client} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('無法安全讀取');
    expect(screen.queryByText('secret-bearing-provider-error')).not.toBeInTheDocument();
  });

  it('runs target preview through content-bound approval and local queue success', async () => {
    const client = await renderReady();
    await advanceToApproval(client);

    fireEvent.click(screen.getByRole('button', { name: '加入本機佇列' }));
    expect(await screen.findByRole('status')).toHaveTextContent('本機佇列已接受');
    expect(screen.getByText(/telegram.queued · success/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批准目前內容' })).toBeDisabled();
  });

  it('shows fake failure without claiming that a message was sent', async () => {
    const client = await renderReady();
    client.outcome = 'failure';
    await advanceToApproval(client);
    fireEvent.click(screen.getByRole('button', { name: '加入本機佇列' }));

    expect(await screen.findByRole('status')).toHaveTextContent('fake adapter 回報失敗');
    expect(screen.getByRole('status')).toHaveTextContent('沒有發送真實訊息');
    expect(screen.getByText(/telegram.enqueue-failure · failure/)).toBeInTheDocument();
  });

  it('invalidates the visible approval after a revision', async () => {
    const client = await renderReady();
    await advanceToApproval(client);

    fireEvent.change(screen.getByLabelText('訊息範本'), { target: { value: '更新後 {{name}}.' } });
    fireEvent.click(screen.getByRole('button', { name: '修訂訊息預覽' }));
    await screen.findByText('更新後 合成聯絡人\\.');

    expect(screen.queryByText(/已綁定批准/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加入本機佇列' })).toBeDisabled();
    expect(screen.getByText(/內容已變更，需重新批准/)).toBeInTheDocument();
  });

  it.each([
    ['訊息範本', '另一個 {{name}}.'],
    ['變數 name', '另一個合成值'],
  ])('invalidates content binding as soon as %s is edited', async (label, value) => {
    const client = await renderReady();
    await advanceToApproval(client);

    fireEvent.change(screen.getByLabelText(label), { target: { value } });

    expect(screen.queryByText(/已綁定批准/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加入本機佇列' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '批准目前內容' })).toBeDisabled();
    expect(screen.getByText(/內容已變更，需重新批准/)).toBeInTheDocument();
  });

  it('locks bound inputs while approval is in flight and invalidates after the next edit', async () => {
    const client = await renderReady();
    fireEvent.click(screen.getByRole('button', { name: '預覽合成目標' }));
    await screen.findByText('合成聯絡人');
    fireEvent.click(screen.getByRole('button', { name: '建立訊息預覽' }));
    await screen.findByText('你好 合成聯絡人\\.');
    let release!: () => void;
    client.approveGate = new Promise((resolve) => { release = resolve; });

    fireEvent.click(screen.getByRole('button', { name: '批准目前內容' }));
    expect(screen.getByLabelText('Synthetic CSV')).toBeDisabled();
    expect(screen.getByLabelText('訊息範本')).toBeDisabled();
    expect(screen.getByLabelText('變數 name')).toBeDisabled();
    expect(screen.getByRole('button', { name: '加入本機佇列' })).toBeDisabled();
    release();
    await screen.findByText(/已綁定批准/);

    fireEvent.change(screen.getByLabelText('訊息範本'), { target: { value: '新的 {{name}}.' } });
    expect(screen.queryByText(/已綁定批准/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加入本機佇列' })).toBeDisabled();
  });

  it('clears all downstream bindings as soon as target CSV is edited', async () => {
    const client = await renderReady();
    await advanceToApproval(client);

    fireEvent.change(screen.getByLabelText('Synthetic CSV'), {
      target: { value: 'target_ref,display_name\nsynthetic:prospect_2,另一個合成目標' },
    });

    expect(screen.queryByText(/已綁定批准/)).not.toBeInTheDocument();
    expect(screen.queryByText('合成聯絡人')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '建立訊息預覽' })).toBeDisabled();
  });

  it('blocks all further mutations when post-operation readback fails', async () => {
    const client = await renderReady();
    fireEvent.click(screen.getByRole('button', { name: '預覽合成目標' }));
    await screen.findByText('合成聯絡人');
    fireEvent.click(screen.getByRole('button', { name: '建立訊息預覽' }));
    await screen.findByText('你好 合成聯絡人\\.');
    client.failNextReadback = true;
    fireEvent.click(screen.getByRole('button', { name: '批准目前內容' }));

    expect(await screen.findByText(/讀回失敗/)).toBeInTheDocument();
    expect(screen.queryByText(/已綁定批准/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加入本機佇列' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '修訂訊息預覽' })).toBeDisabled();
  });

  it('redacts secret-like uppercase client errors', async () => {
    const client = await renderReady();
    client.operationError = new Error('TOKEN:ABC123');
    fireEvent.click(screen.getByRole('button', { name: '預覽合成目標' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('未顯示未受信任');
    expect(screen.queryByText(/ABC123/)).not.toBeInTheDocument();
  });

  it.each([
    ['RECONCILIATION_REQUIRED', '結果仍待對帳'],
    ['TELEGRAM_SESSION_STALE', '工作階段證據已過期'],
    ['TELEGRAM_SESSION_DEGRADED', '工作階段目前降級'],
  ])('blocks retry when an operation fails with %s', async (code, message) => {
    const client = await renderReady();
    client.operationError = new Error(code);
    fireEvent.click(screen.getByRole('button', { name: '預覽合成目標' }));

    expect(await screen.findByText(new RegExp(message))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '預覽合成目標' })).toBeDisabled();
  });

  it('fails closed on unknown and requires reconciliation before more work', async () => {
    const client = await renderReady();
    client.outcome = 'unknown';
    await advanceToApproval(client);
    fireEvent.click(screen.getByRole('button', { name: '加入本機佇列' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('結果未知');
    expect(screen.getByRole('button', { name: '修訂訊息預覽' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '批准目前內容' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '對帳為失敗' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByText(/telegram.reconciled · failure/)).toBeInTheDocument();
  });

  it('latches unknown locally even when the read model has not caught up', async () => {
    const client = await renderReady();
    client.outcome = 'unknown';
    client.lagUnknownSnapshot = true;
    await advanceToApproval(client);
    fireEvent.click(screen.getByRole('button', { name: '加入本機佇列' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('結果未知');
    expect(screen.getByRole('button', { name: '預覽合成目標' })).toBeDisabled();
  });

  it('clears stale workflow bindings after successful reconciliation', async () => {
    const client = await renderReady();
    client.outcome = 'unknown';
    await advanceToApproval(client);
    fireEvent.click(screen.getByRole('button', { name: '加入本機佇列' }));
    await screen.findByText(/結果未知/);
    fireEvent.click(screen.getByRole('button', { name: '對帳為成功' }));

    await waitFor(() => expect(screen.queryByText('合成聯絡人')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '建立訊息預覽' })).toBeDisabled();
    expect(screen.getByText(/telegram.reconciled · success/)).toBeInTheDocument();
  });

  it.each(['unknown', 'failure'] as const)('keeps the unknown latch when success reconciliation returns %s', async (reconcileOutcome) => {
    const client = await renderReady();
    client.outcome = 'unknown';
    client.lagUnknownSnapshot = true;
    client.reconcileResultOverride = reconcileOutcome;
    await advanceToApproval(client);
    fireEvent.click(screen.getByRole('button', { name: '加入本機佇列' }));
    await screen.findByText(/結果未知/);
    fireEvent.click(screen.getByRole('button', { name: '對帳為成功' }));

    expect(await screen.findByText(/結果未知/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '預覽合成目標' })).toBeDisabled();
  });

  it.each(['stale', 'degraded'] as const)('blocks mutations when session is %s', async (state) => {
    const client = new SyntheticTelegramClient();
    client.snapshot = { ...client.snapshot, sessionState: state };
    await renderReady(client);

    expect(screen.getByRole('alert')).toHaveTextContent('停止條件');
    expect(screen.getByRole('button', { name: '預覽合成目標' })).toBeDisabled();
  });

  it('pauses and resumes local operations while keeping masked audit readback', async () => {
    await renderReady();
    fireEvent.click(screen.getByRole('button', { name: '暫停 Telegram' }));
    await screen.findByText('已暫停');
    expect(screen.getByRole('button', { name: '預覽合成目標' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '恢復 Telegram' }));
    await waitFor(() => expect(screen.queryByText('已暫停')).not.toBeInTheDocument());
    expect(within(screen.getByLabelText('稽核事件')).getByText(/telegram.resumed/)).toBeInTheDocument();
  });

  it('does not commit an unsafe pause response before validated readback', async () => {
    const client = await renderReady();
    client.pause = async () => ({ ...client.snapshot, maskedAccount: 'unsafe-account' });
    fireEvent.click(screen.getByRole('button', { name: '暫停 Telegram' }));

    await waitFor(() => expect(screen.queryByText('unsafe-account')).not.toBeInTheDocument());
    expect(screen.getByText('tg-***-4821')).toBeInTheDocument();
  });

  it('ignores late readback from a replaced client', async () => {
    const oldClient = new SyntheticTelegramClient();
    let resolveOld!: (snapshot: TelegramUiSnapshot) => void;
    oldClient.readSnapshot = () => new Promise((resolve) => { resolveOld = resolve; });
    const newClient = new SyntheticTelegramClient();
    newClient.snapshot = { ...newClient.snapshot, maskedAccount: 'tg-***-9999' };
    const view = render(<TelegramOutreachPage client={oldClient} />);

    view.rerender(<TelegramOutreachPage client={newClient} />);
    await screen.findByText('tg-***-9999');
    resolveOld({ ...oldClient.snapshot, maskedAccount: 'tg-***-1111' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText('tg-***-1111')).not.toBeInTheDocument();
    expect(screen.getByText('tg-***-9999')).toBeInTheDocument();
  });
});
