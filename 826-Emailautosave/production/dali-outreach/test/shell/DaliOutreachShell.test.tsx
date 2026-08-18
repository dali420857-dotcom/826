import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DaliOutreachShell } from '../../src/shell/DaliOutreachShell';
import {
  createSyntheticSourceEvidence,
  type SourceState,
} from '../../src/shell/SourceStateBand';
import {
  emailPresentationModule,
  telegramPresentationModule,
} from '../../src/shell/syntheticPresentationRegistry';

afterEach(cleanup);

const now = '2026-08-17T00:00:30.000Z';
const sources = (state: SourceState) => [
  createSyntheticSourceEvidence('email', state),
  createSyntheticSourceEvidence('telegram', state),
];

describe('DaliOutreachShell', () => {
  it('renders navigation and routes only for registered modules', () => {
    render(
      <DaliOutreachShell
        modules={[emailPresentationModule]}
        currentPath="/email"
        sourceEvidence={sources('ready')}
        now={now}
      />,
    );

    expect(screen.getByRole('link', { name: '郵件流程' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '郵件流程' })).toBeInTheDocument();
    expect(screen.queryByText('Telegram')).not.toBeInTheDocument();
    expect(screen.queryByText(/Unsupported/i)).not.toBeInTheDocument();
  });

  it('renders only the active registered module contribution', () => {
    render(
      <DaliOutreachShell
        modules={[emailPresentationModule, telegramPresentationModule]}
        currentPath="/email"
        sourceEvidence={sources('ready')}
        now={now}
        renderRoute={(moduleId) => <div>{moduleId} workflow contribution</div>}
      />,
    );

    expect(screen.getByText('email workflow contribution')).toBeInTheDocument();
    expect(screen.queryByText('telegram workflow contribution')).not.toBeInTheDocument();
  });

  it('falls back to overview without rendering a placeholder for an unregistered path', () => {
    render(
      <DaliOutreachShell
        modules={[emailPresentationModule]}
        currentPath="/unsupported"
        sourceEvidence={sources('ready')}
        now={now}
      />,
    );

    expect(screen.getByRole('heading', { name: '外聯總覽' })).toBeInTheDocument();
    expect(screen.queryByText(/Unsupported/i)).not.toBeInTheDocument();
    expect(screen.queryByText('此頁面未註冊')).not.toBeInTheDocument();
  });

  it.each([
    ['loading', '正在讀取資料'],
    ['degraded', '資料來源降級'],
    ['unavailable', '資料來源目前無法使用'],
    ['stale', '資料快照已過期'],
  ] as const)('announces the %s source state', (sourceState, message) => {
    render(
      <DaliOutreachShell
        modules={[emailPresentationModule, telegramPresentationModule]}
        currentPath="/overview"
        sourceEvidence={sources(sourceState)}
        now={now}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(message);
    expect(screen.getByRole('status')).toHaveTextContent('synthetic-shell-fixture');
    expect(screen.getByRole('status')).toHaveTextContent('TTL 60 秒');
  });

  it('renders the Email and Telegram synthetic overview without live actions', () => {
    render(
      <DaliOutreachShell
        modules={[emailPresentationModule, telegramPresentationModule]}
        currentPath="/overview"
        sourceEvidence={sources('ready')}
        now={now}
      />,
    );

    expect(screen.getByRole('heading', { name: '外聯總覽' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Telegram' })).toBeInTheDocument();
    expect(screen.getAllByText('Monitoring only')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '暫停全部' })).toBeDisabled();
    expect(screen.getByRole('searchbox', { name: '搜尋目前畫面' })).toBeDisabled();
  });

  it('does not report unavailable sources as healthy', () => {
    render(
      <DaliOutreachShell
        modules={[emailPresentationModule, telegramPresentationModule]}
        currentPath="/overview"
        sourceEvidence={sources('unavailable')}
        now={now}
      />,
    );

    expect(screen.getByText('0/2 來源')).toHaveClass('source-count--unavailable');
    expect(screen.getByRole('status')).toHaveTextContent('停止條件');
  });

  it('derives stale when a ready source exceeds its TTL', () => {
    render(
      <DaliOutreachShell
        modules={[emailPresentationModule, telegramPresentationModule]}
        currentPath="/overview"
        sourceEvidence={sources('ready')}
        now="2026-08-17T00:01:01.000Z"
      />,
    );

    expect(screen.getByText('0/2 來源')).toHaveClass('source-count--stale');
    expect(screen.getByRole('status')).toHaveTextContent('snapshot-ttl-expired');
  });

  it('counts ready evidence independently for each registered module', () => {
    render(
      <DaliOutreachShell
        modules={[emailPresentationModule, telegramPresentationModule]}
        currentPath="/overview"
        sourceEvidence={[
          createSyntheticSourceEvidence('email', 'ready'),
          createSyntheticSourceEvidence('telegram', 'degraded'),
        ]}
        now={now}
      />,
    );

    expect(screen.getByText('1/2 來源')).toHaveClass('source-count--degraded');
    expect(
      within(screen.getByRole('heading', { name: 'Email' }).closest('article')!).getByText(
        'ready',
      ),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole('heading', { name: 'Telegram' }).closest('article')!,
      ).getByText('degraded'),
    ).toBeInTheDocument();
  });

  it('does not downgrade an unavailable source when its TTL has elapsed', () => {
    render(
      <DaliOutreachShell
        modules={[emailPresentationModule]}
        currentPath="/overview"
        sourceEvidence={[createSyntheticSourceEvidence('email', 'unavailable')]}
        now="2026-08-17T00:02:00.000Z"
      />,
    );

    expect(screen.getByText('0/1 來源')).toHaveClass('source-count--unavailable');
    expect(screen.getByRole('status')).toHaveTextContent('fixture-state-injection');
  });

  it.each([
    [{ observedAt: '2026-08-17T00:00:31.000Z' }, 'future timestamp'],
    [{ ttlMs: Number.POSITIVE_INFINITY }, 'infinite TTL'],
    [{ ttlMs: Number.NaN }, 'NaN TTL'],
    [{ ttlMs: 0 }, 'nonpositive TTL'],
  ])('fails closed for invalid freshness evidence: $1', (override, _label) => {
    render(
      <DaliOutreachShell
        modules={[emailPresentationModule]}
        currentPath="/overview"
        sourceEvidence={[
          { ...createSyntheticSourceEvidence('email', 'ready'), ...override },
        ]}
        now={now}
      />,
    );

    expect(screen.getByText('0/1 來源')).toHaveClass('source-count--unavailable');
    expect(screen.getByRole('status')).toHaveTextContent('invalid-source-freshness');
  });

  it('fails closed when one module has conflicting duplicate evidence', () => {
    render(
      <DaliOutreachShell
        modules={[emailPresentationModule]}
        currentPath="/overview"
        sourceEvidence={[
          createSyntheticSourceEvidence('email', 'ready'),
          createSyntheticSourceEvidence('email', 'unavailable'),
        ]}
        now={now}
      />,
    );

    expect(screen.getByText('0/1 來源')).toHaveClass('source-count--unavailable');
    expect(screen.getByRole('status')).toHaveTextContent('duplicate-module-evidence');
  });
});
