export const outreachAssemblyManifest = Object.freeze({
  schemaVersion: 1 as const,
  mode: 'monitoring-only' as const,
  modules: ['data', 'email', 'telegram'] as const,
  liveSend: false as const,
  providerAdapters: [] as const,
  schedules: [
    { moduleId: 'data' as const, label: '數據導入預覽', enabled: false as const },
    { moduleId: 'email' as const, label: 'Email 本機佇列預覽', enabled: false as const },
    { moduleId: 'telegram' as const, label: 'Telegram 本機佇列預覽', enabled: false as const },
  ],
  settings: {
    network: 'loopback-only' as const,
    data: 'synthetic-masked' as const,
    unknownOutcome: 'reconciliation-required' as const,
  },
});
