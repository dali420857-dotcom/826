import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DaliOutreachShell } from '../../src/shell/DaliOutreachShell';
import { createSyntheticSourceEvidence } from '../../src/shell/SourceStateBand';
import {
  emailPresentationModule,
  telegramPresentationModule,
} from '../../src/shell/syntheticPresentationRegistry';

function ViewportPreview() {
  const [readback, setReadback] = useState({ viewport: 0, overflowX: true });

  useEffect(() => {
    requestAnimationFrame(() => {
      const shell = document.querySelector<HTMLElement>('.outreach-shell');
      setReadback({
        viewport: document.documentElement.clientWidth,
        overflowX:
          document.documentElement.scrollWidth > document.documentElement.clientWidth ||
          Boolean(shell && shell.scrollWidth > shell.clientWidth),
      });
    });
  }, []);

  return (
    <>
      <DaliOutreachShell
        currentPath="/overview"
        modules={[emailPresentationModule, telegramPresentationModule]}
        now="2026-08-17T00:00:30.000Z"
        sourceEvidence={[
          createSyntheticSourceEvidence('email', 'ready'),
          createSyntheticSourceEvidence('telegram', 'ready'),
        ]}
      />
      <output
        data-overflow-x={String(readback.overflowX)}
        data-viewport={readback.viewport}
        hidden
        id="viewport-readback"
      />
    </>
  );
}

const root = document.getElementById('viewport-root');
if (!root) throw new Error('VIEWPORT_ROOT_NOT_FOUND');
createRoot(root).render(<ViewportPreview />);
