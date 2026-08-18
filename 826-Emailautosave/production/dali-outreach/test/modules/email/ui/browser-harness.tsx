import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createSyntheticEmailUiClient,
  EmailOutreachPage,
} from '../../../../src/modules/email/ui';

const root = document.getElementById('root');
if (!root) throw new Error('EMAIL_BROWSER_HARNESS_ROOT_MISSING');

createRoot(root).render(
  <StrictMode>
    <EmailOutreachPage client={createSyntheticEmailUiClient()} />
  </StrictMode>,
);
