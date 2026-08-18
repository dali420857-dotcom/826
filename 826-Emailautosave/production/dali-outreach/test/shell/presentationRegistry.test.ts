import { describe, expect, it } from 'vitest';
import {
  emailPresentationModule,
  normalizePresentationRegistry,
  telegramPresentationModule,
} from '../../src/shell/syntheticPresentationRegistry';
import type { OutreachPresentationModule } from '../../src/contracts';

describe('Email and Telegram presentation registry', () => {
  it('keeps the supported registry in stable assembly order', () => {
    expect(
      normalizePresentationRegistry([
        telegramPresentationModule,
        emailPresentationModule,
      ]).map((module) => module.moduleId),
    ).toEqual(['email', 'telegram']);
  });

  it('rejects duplicate module contributions', () => {
    expect(() =>
      normalizePresentationRegistry([
        emailPresentationModule,
        emailPresentationModule,
      ]),
    ).toThrow('DUPLICATE_PRESENTATION_MODULE');
  });

  it('does not register unsupported runtime contributions', () => {
    const unsupported = {
      moduleId: 'unsupported-channel',
      navItems: [{ id: 'unsupported', label: 'Unsupported', path: '/unsupported' }],
      routes: [{ id: 'unsupported', path: '/unsupported' }],
    } as unknown as OutreachPresentationModule;

    expect(normalizePresentationRegistry([unsupported])).toEqual([]);
  });
});
