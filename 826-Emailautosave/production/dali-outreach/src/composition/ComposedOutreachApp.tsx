import { useCallback, useEffect, useRef, useState } from 'react';
import { EmailOutreachPage, createSyntheticEmailUiClient, type EmailUiClient } from '../modules/email/ui';
import { SyntheticTelegramUiClient, TelegramOutreachPage, type TelegramUiClient } from '../modules/telegram/ui';
import { createSyntheticDataUiClient, type DataUiClient } from '../modules/data';
import { DataWorkItemsPanel } from '../modules/data/ui/DataWorkItemsPanel';
import {
  createSyntheticSourceEvidence,
  DaliOutreachShell,
  emailPresentationModule,
  telegramPresentationModule,
  type SourceState,
} from '../shell';
import { SharedOperationsPanel } from './SharedOperationsPanel';

const modules = [emailPresentationModule, telegramPresentationModule] as const;
const fixtureNow = '2026-08-17T00:00:30.000Z';
const CLIENT_BOUNDARY_TIMEOUT_MS = 300;

function callClient<T>(operation: () => T | PromiseLike<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error('UI_CLIENT_TIMEOUT')),
      CLIENT_BOUNDARY_TIMEOUT_MS,
    );
  });
  return Promise.race([
    Promise.resolve().then(operation),
    timeout,
  ]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}

function readHashPath(): '/overview' | '/email' | '/telegram' {
  const path = window.location.hash.replace(/^#/, '');
  if (path === '/email' || path === '/telegram' || path === '/overview') return path;
  window.history.replaceState(null, '', '#/overview');
  return '/overview';
}

export function ComposedOutreachApp({
  dataClient,
  emailClient,
  telegramClient,
}: {
  readonly dataClient?: DataUiClient;
  readonly emailClient: EmailUiClient;
  readonly telegramClient: TelegramUiClient;
}) {
  const [currentPath, setCurrentPath] = useState(readHashPath);
  const [sourceStates, setSourceStates] = useState<Record<'email' | 'telegram', SourceState>>({
    email: 'loading',
    telegram: 'loading',
  });
  const readbackGenerationRef = useRef(0);
  const handleEvidenceChange = useCallback(
    (states: Readonly<Record<'email' | 'telegram', SourceState>>) => {
      setSourceStates(states);
    },
    [],
  );
  const sourceEvidence = [
    createSyntheticSourceEvidence('email', sourceStates.email),
    createSyntheticSourceEvidence('telegram', sourceStates.telegram),
  ] as const;

  useEffect(() => {
    const onHashChange = () => setCurrentPath(readHashPath());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    let active = true;
    const generation = ++readbackGenerationRef.current;
    setSourceStates({ email: 'loading', telegram: 'loading' });
    void Promise.allSettled([
      Promise.all([
        callClient(() => emailClient.getStatus()),
        callClient(() => emailClient.readAudit()),
        callClient(() => emailClient.readQueue()),
      ]),
      Promise.all([
        callClient(() => telegramClient.readSnapshot()),
        callClient(() => telegramClient.readAudit()),
      ]),
    ]).then(([emailResult, telegramResult]) => {
      if (!active || generation !== readbackGenerationRef.current) return;
      const telegramState = telegramResult.status === 'fulfilled'
        ? telegramResult.value[0].sessionState === 'stale'
          ? 'stale'
          : telegramResult.value[0].sessionState === 'ready'
            ? 'ready'
            : 'degraded'
        : 'unavailable';
      setSourceStates({
        email: emailResult.status === 'fulfilled' ? 'ready' : 'unavailable',
        telegram: telegramState,
      });
    });
    return () => {
      active = false;
      if (generation === readbackGenerationRef.current) readbackGenerationRef.current += 1;
    };
  }, [emailClient, telegramClient]);

  return (
    <DaliOutreachShell
      currentPath={currentPath}
      modules={modules}
      now={fixtureNow}
      sourceEvidence={sourceEvidence}
      overviewContent={
        <>
          {dataClient ? <DataWorkItemsPanel client={dataClient} /> : null}
          <SharedOperationsPanel
            emailClient={emailClient}
            onEvidenceChange={handleEvidenceChange}
            telegramClient={telegramClient}
          />
        </>
      }
      renderRoute={(moduleId) =>
        moduleId === 'email' ? (
          <EmailOutreachPage client={emailClient} />
        ) : (
          <TelegramOutreachPage client={telegramClient} />
        )
      }
    />
  );
}

export function createSyntheticComposition() {
  return {
    dataClient: createSyntheticDataUiClient(),
    emailClient: createSyntheticEmailUiClient(),
    telegramClient: new SyntheticTelegramUiClient(),
  };
}
