import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const preloadPath = fileURLToPath(new URL('./no-egress-preload.cjs', import.meta.url));
const vitestPath = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const existingNodeOptions = process.env.NODE_OPTIONS?.trim();
const requireOption = `--require=${JSON.stringify(preloadPath)}`;

const result = spawnSync(process.execPath, [vitestPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_OPTIONS: [existingNodeOptions, requireOption].filter(Boolean).join(' '),
    DALI_PHASE_ZERO: '1',
  },
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
