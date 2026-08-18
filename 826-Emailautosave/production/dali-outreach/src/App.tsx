import { useState } from 'react';
import { ComposedOutreachApp, createSyntheticComposition } from './composition/ComposedOutreachApp';
import {
  createBridgeBackedComposition,
  type RuntimeBridgeExecutor,
  type RuntimeSnapshotControl,
} from './composition/bridge-backed-clients';

declare global {
  interface Window {
    __DALI_OUTREACH_BOOTSTRAP__?:
      | {
          readonly mode: 'bridge';
          readonly mutationBridge: RuntimeBridgeExecutor;
          readonly snapshotControl: RuntimeSnapshotControl;
        }
      | { readonly mode: 'synthetic-preview' };
  }
}

function createActivatedComposition() {
  const bootstrap = window.__DALI_OUTREACH_BOOTSTRAP__;
  if (bootstrap?.mode === 'bridge') {
    return createBridgeBackedComposition(
      bootstrap.mutationBridge,
      bootstrap.snapshotControl,
    );
  }
  if (bootstrap?.mode === 'synthetic-preview') return createSyntheticComposition();
  return undefined;
}

export function App() {
  const [composition] = useState(createActivatedComposition);
  if (!composition) {
    return (
      <main aria-labelledby="activation-title" className="activation-off">
        <h1 id="activation-title">Dali Outreach 尚未啟用</h1>
        <p>需要受控的 loopback bridge 注入；合成預覽必須明確選擇。</p>
        <strong>activation off · monitoring only · no-send</strong>
      </main>
    );
  }
  return <ComposedOutreachApp {...composition} />;
}
