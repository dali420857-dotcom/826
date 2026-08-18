import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createSyntheticSourceEvidence,
  DaliOutreachShell,
  emailPresentationModule,
  telegramPresentationModule,
  type SourceEvidence,
} from '../../src/shell';

type Scenario = 'loading' | 'degraded' | 'unavailable' | 'stale' | 'duplicate';

const scenario = new URLSearchParams(window.location.search).get('scenario') as Scenario | null;
const modules = [emailPresentationModule, telegramPresentationModule] as const;
const now = '2026-08-17T00:00:30.000Z';

function evidenceFor(value: Scenario | null): readonly SourceEvidence[] {
  switch (value) {
    case 'loading':
      return [
        createSyntheticSourceEvidence('email', 'loading'),
        createSyntheticSourceEvidence('telegram', 'loading'),
      ];
    case 'degraded':
      return [
        createSyntheticSourceEvidence('email', 'degraded'),
        createSyntheticSourceEvidence('telegram', 'ready'),
      ];
    case 'unavailable':
      return [createSyntheticSourceEvidence('telegram', 'ready')];
    case 'stale':
      return [
        { ...createSyntheticSourceEvidence('email', 'ready'), observedAt: '2026-08-16T23:58:00.000Z' },
        createSyntheticSourceEvidence('telegram', 'ready'),
      ];
    case 'duplicate':
      return [
        createSyntheticSourceEvidence('email', 'ready'),
        createSyntheticSourceEvidence('email', 'loading'),
        createSyntheticSourceEvidence('telegram', 'ready'),
      ];
    default:
      throw new Error('UNKNOWN_BROWSER_SCENARIO');
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('ROOT_NOT_FOUND');

createRoot(root).render(
  <StrictMode>
    <DaliOutreachShell
      currentPath="/overview"
      modules={modules}
      now={now}
      sourceEvidence={evidenceFor(scenario)}
    />
  </StrictMode>,
);
