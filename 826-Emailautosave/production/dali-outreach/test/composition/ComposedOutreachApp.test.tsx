import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/App';
import { ComposedOutreachApp, createSyntheticComposition } from '../../src/composition/ComposedOutreachApp';
import { outreachAssemblyManifest } from '../../src/composition/assemblyManifest';

beforeEach(() => {
  window.__DALI_OUTREACH_BOOTSTRAP__ = { mode: 'synthetic-preview' };
  window.location.hash = '#/overview';
});

afterEach(() => {
  cleanup();
  delete window.__DALI_OUTREACH_BOOTSTRAP__;
  window.location.hash = '';
});

describe('Email and Telegram composition root', () => {
  it('fails closed without an explicit activation bootstrap', () => {
    delete window.__DALI_OUTREACH_BOOTSTRAP__;
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Dali Outreach 尚未啟用' })).toBeInTheDocument();
    expect(screen.getByText('activation off · monitoring only · no-send')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '郵件流程' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Telegram' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '暫停兩個模塊' })).not.toBeInTheDocument();
  });

  it('installs exactly the three approved modules and shared no-send operations', async () => {
    render(<App />);

    expect(screen.getByRole('link', { name: '郵件流程' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Telegram' })).toBeInTheDocument();
    expect(screen.getByText('3 modules · no-send')).toBeInTheDocument();
    expect(screen.getByText(/Provider、OAuth、排程與 live-send 未安裝/)).toBeInTheDocument();

    const pauseButton = screen.getByRole('button', { name: '暫停兩個模塊' });
    await waitFor(() => expect(pauseButton).toBeEnabled());
    fireEvent.click(pauseButton);
    await waitFor(() => expect(screen.getByText(/Email：paused · Telegram：paused/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '恢復兩個模塊' }));
    await waitFor(() => expect(screen.getByText(/Email：monitoring · Telegram：monitoring/)).toBeInTheDocument());
  });

  it('routes only to the selected registered module contribution', async () => {
    render(<App />);

    window.location.hash = '#/email';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(await screen.findByRole('heading', { name: 'Email 外聯流程' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Telegram 外聯工作台' })).not.toBeInTheDocument();

    window.location.hash = '#/telegram';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(await screen.findByRole('heading', { name: 'Telegram 外聯工作台' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Email 外聯流程' })).not.toBeInTheDocument();
  });

  it('reads pause state back after the overview is remounted', async () => {
    const composition = createSyntheticComposition();
    render(<ComposedOutreachApp {...composition} />);
    const pauseButton = screen.getByRole('button', { name: '暫停兩個模塊' });
    await waitFor(() => expect(pauseButton).toBeEnabled());
    fireEvent.click(pauseButton);
    await screen.findByText('Email：paused · Telegram：paused');

    window.location.hash = '#/email';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await screen.findByRole('heading', { name: 'Email 外聯流程' });
    window.location.hash = '#/overview';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(await screen.findByText('Email：paused · Telegram：paused')).toBeInTheDocument();
  });

  it('reports and locks a split pause outcome instead of claiming global success', async () => {
    const composition = createSyntheticComposition();
    const failingEmail = {
      ...composition.emailClient,
      pause: () => { throw new Error('synthetic pause failure'); },
    };
    render(
      <ComposedOutreachApp
        emailClient={failingEmail}
        telegramClient={composition.telegramClient}
      />,
    );
    const pauseButton = screen.getByRole('button', { name: '暫停兩個模塊' });
    await waitFor(() => expect(pauseButton).toBeEnabled());
    fireEvent.click(pauseButton);

    expect(await screen.findByText('Email：monitoring · Telegram：paused')).toBeInTheDocument();
    expect(screen.getByText(/操作只部分完成/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '暫停兩個模塊' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '恢復兩個模塊' })).toBeDisabled();
  });

  it('fails readback closed and never renders an unknown count as zero', async () => {
    const composition = createSyntheticComposition();
    const unreadableEmail = {
      ...composition.emailClient,
      readAudit: async () => { throw new Error('synthetic readback failure'); },
    };
    render(
      <ComposedOutreachApp
        emailClient={unreadableEmail}
        telegramClient={composition.telegramClient}
      />,
    );

    expect(await screen.findByText('Email：unavailable · Telegram：monitoring')).toBeInTheDocument();
    expect(screen.getByText('Email：unavailable · Telegram：0')).toBeInTheDocument();
    expect(screen.getByText('1/2 來源')).toBeInTheDocument();
    expect(screen.getByText(/讀回不完整/)).toBeInTheDocument();
  });

  it('contains a synchronous status throw at the shared readback boundary', async () => {
    const composition = createSyntheticComposition();
    const unreadableEmail = {
      ...composition.emailClient,
      getStatus: () => { throw new Error('synthetic synchronous status failure'); },
    };

    expect(() => render(
      <ComposedOutreachApp
        emailClient={unreadableEmail}
        telegramClient={composition.telegramClient}
      />,
    )).not.toThrow();

    expect(await screen.findByText('Email：unavailable · Telegram：monitoring')).toBeInTheDocument();
    expect(screen.getByText(/讀回不完整/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '暫停兩個模塊' })).toBeDisabled();
  });

  it('times out a never-settling shared readback and fails closed', async () => {
    const composition = createSyntheticComposition();
    const unreadableEmail = {
      ...composition.emailClient,
      readAudit: () => new Promise<never>(() => undefined),
    };
    render(
      <ComposedOutreachApp
        emailClient={unreadableEmail}
        telegramClient={composition.telegramClient}
      />,
    );

    expect(await screen.findByText('Email：unavailable · Telegram：monitoring', {}, { timeout: 2_000 })).toBeInTheDocument();
    expect(screen.getByText(/讀回不完整/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '暫停兩個模塊' })).toBeDisabled();
  });

  it('times out a never-settling shared pause and locks further changes', async () => {
    const composition = createSyntheticComposition();
    const hangingEmail = {
      ...composition.emailClient,
      pause: () => new Promise<never>(() => undefined) as never,
    };
    render(
      <ComposedOutreachApp
        emailClient={hangingEmail}
        telegramClient={composition.telegramClient}
      />,
    );
    const pauseButton = screen.getByRole('button', { name: '暫停兩個模塊' });
    await waitFor(() => expect(pauseButton).toBeEnabled());
    fireEvent.click(pauseButton);

    expect(await screen.findByText(/操作只部分完成/, {}, { timeout: 2_000 })).toBeInTheDocument();
    expect(screen.getByText('Email：monitoring · Telegram：paused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '恢復兩個模塊' })).toBeDisabled();
  });

  it('keeps a timed-out shared mutation locked until a manual authoritative readback', async () => {
    const composition = createSyntheticComposition();
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => { release = resolve; });
    const lateEmail = {
      ...composition.emailClient,
      pause: (async () => {
        await deferred;
        return composition.emailClient.pause();
      }) as never,
    };
    render(
      <ComposedOutreachApp
        emailClient={lateEmail}
        telegramClient={composition.telegramClient}
      />,
    );
    const pauseButton = screen.getByRole('button', { name: '暫停兩個模塊' });
    await waitFor(() => expect(pauseButton).toBeEnabled());
    fireEvent.click(pauseButton);

    expect(await screen.findByText(/操作只部分完成/, {}, { timeout: 2_000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '恢復兩個模塊' })).toBeDisabled();
    await act(async () => { release(); });
    expect(await screen.findByText('逾時操作已結束；結果仍需手動重新整理與對帳。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '恢復兩個模塊' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重新整理讀回' }));
    expect(await screen.findByText('Email：paused · Telegram：paused')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '恢復兩個模塊' })).toBeEnabled());
  });

  it('preserves a timed-out shared mutation guard across route unmount and remount', async () => {
    const composition = createSyntheticComposition();
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => { release = resolve; });
    const lateEmail = {
      ...composition.emailClient,
      pause: (async () => {
        await deferred;
        return composition.emailClient.pause();
      }) as never,
    };
    render(<ComposedOutreachApp emailClient={lateEmail} telegramClient={composition.telegramClient} />);
    const pauseButton = screen.getByRole('button', { name: '暫停兩個模塊' });
    await waitFor(() => expect(pauseButton).toBeEnabled());
    fireEvent.click(pauseButton);
    await screen.findByText(/操作只部分完成/, {}, { timeout: 2_000 });

    window.location.hash = '#/email';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await screen.findByRole('heading', { name: 'Email 外聯流程' });
    window.location.hash = '#/overview';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await screen.findByRole('heading', { name: '共同營運' });
    expect(screen.getByRole('button', { name: '暫停兩個模塊' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '恢復兩個模塊' })).toBeDisabled();

    await act(async () => { release(); });
    expect(screen.getByRole('button', { name: '恢復兩個模塊' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重新整理讀回' }));
    expect(await screen.findByText('Email：paused · Telegram：paused')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '恢復兩個模塊' })).toBeEnabled());
  });

  it('ignores a stale shared readback after the clients are replaced', async () => {
    const first = createSyntheticComposition();
    first.emailClient.pause();
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => { release = resolve; });
    const slowPausedEmail = {
      ...first.emailClient,
      readAudit: async () => {
        await deferred;
        return first.emailClient.readAudit();
      },
    };
    const second = createSyntheticComposition();
    const view = render(
      <ComposedOutreachApp emailClient={slowPausedEmail} telegramClient={first.telegramClient} />,
    );
    view.rerender(
      <ComposedOutreachApp emailClient={second.emailClient} telegramClient={second.telegramClient} />,
    );

    expect(await screen.findByText('Email：monitoring · Telegram：monitoring')).toBeInTheDocument();
    await act(async () => { release(); });
    expect(screen.getByText('Email：monitoring · Telegram：monitoring')).toBeInTheDocument();
  });

  it('canonicalizes unknown hashes and freezes the Email plus Telegram-only manifest', async () => {
    window.location.hash = '#/whatsapp';
    render(<App />);
    await screen.findByRole('heading', { name: '共同營運' });

    expect(window.location.hash).toBe('#/overview');
    expect(outreachAssemblyManifest.modules).toEqual(['data', 'email', 'telegram']);
    expect(outreachAssemblyManifest.providerAdapters).toEqual([]);
    expect(outreachAssemblyManifest.liveSend).toBe(false);
  });

  it.each(['#/email', '#/telegram'])('loads source evidence on a direct %s deep link', async (hash) => {
    window.location.hash = hash;
    render(<App />);

    expect(await screen.findByText('2/2 來源')).toBeInTheDocument();
    expect(screen.queryByText('0/2 來源')).not.toBeInTheDocument();
  });

  it('bounds a hanging Email readback on a direct Email deep link', async () => {
    window.location.hash = '#/email';
    const composition = createSyntheticComposition();
    const hangingEmail = {
      ...composition.emailClient,
      readAudit: () => new Promise<never>(() => undefined),
    };
    render(<ComposedOutreachApp emailClient={hangingEmail} telegramClient={composition.telegramClient} />);

    expect(await screen.findByRole('heading', { name: 'Email 外聯流程' })).toBeInTheDocument();
    expect(await screen.findByText('1/2 來源', {}, { timeout: 2_000 })).toBeInTheDocument();
    expect(await screen.findByText('本機狀態不可用；流程已鎖定。', {}, { timeout: 2_000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '載入合成聯絡人' })).toBeDisabled();
  });

  it('bounds a hanging Telegram readback on a direct Telegram deep link', async () => {
    window.location.hash = '#/telegram';
    const composition = createSyntheticComposition();
    const hangingTelegram = Object.create(composition.telegramClient) as typeof composition.telegramClient;
    hangingTelegram.readAudit = () => new Promise<never>(() => undefined);
    render(<ComposedOutreachApp emailClient={composition.emailClient} telegramClient={hangingTelegram} />);

    expect(await screen.findByText('1/2 來源', {}, { timeout: 2_000 })).toBeInTheDocument();
  });

  it('locks a fulfilled pause whose readback does not reach the requested state', async () => {
    const composition = createSyntheticComposition();
    const lyingEmail = {
      ...composition.emailClient,
      pause: () => composition.emailClient.getStatus(),
    };
    render(
      <ComposedOutreachApp emailClient={lyingEmail} telegramClient={composition.telegramClient} />,
    );
    const pauseButton = screen.getByRole('button', { name: '暫停兩個模塊' });
    await waitFor(() => expect(pauseButton).toBeEnabled());
    fireEvent.click(pauseButton);

    expect(await screen.findByText('Email：monitoring · Telegram：paused')).toBeInTheDocument();
    expect(screen.getByText(/操作只部分完成/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '恢復兩個模塊' })).toBeDisabled();
  });

  it('preserves Telegram stale as a first-class composed source state', async () => {
    const composition = createSyntheticComposition();
    const staleTelegram = Object.create(composition.telegramClient) as typeof composition.telegramClient;
    staleTelegram.readSnapshot = async () => ({
      ...(await composition.telegramClient.readSnapshot()),
      sessionState: 'stale' as const,
    });
    render(
      <ComposedOutreachApp emailClient={composition.emailClient} telegramClient={staleTelegram} />,
    );

    expect(await screen.findByText('資料快照已過期')).toBeInTheDocument();
    expect(screen.getByText('1/2 來源')).toBeInTheDocument();
  });
});
