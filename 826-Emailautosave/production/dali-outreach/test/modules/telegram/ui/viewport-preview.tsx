import { createRoot } from 'react-dom/client';
import { TelegramOutreachPage } from '../../../../src/modules/telegram/ui';
import { SyntheticTelegramUiClient } from './SyntheticTelegramUiClient';

const root = document.getElementById('telegram-viewport-root');
if (!root) throw new Error('TELEGRAM_VIEWPORT_ROOT_NOT_FOUND');

createRoot(root).render(<TelegramOutreachPage client={new SyntheticTelegramUiClient()} />);

