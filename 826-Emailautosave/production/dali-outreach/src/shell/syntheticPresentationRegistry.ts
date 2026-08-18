import type { OutreachPresentationModule } from '../contracts';

export const emailPresentationModule: OutreachPresentationModule = Object.freeze({
  moduleId: 'email',
  navItems: [{ id: 'email-workflows', label: '郵件流程', path: '/email' }],
  routes: [{ id: 'email-workflows', path: '/email' }],
});

export const telegramPresentationModule: OutreachPresentationModule = Object.freeze({
  moduleId: 'telegram',
  navItems: [{ id: 'telegram-workflows', label: 'Telegram', path: '/telegram' }],
  routes: [{ id: 'telegram-workflows', path: '/telegram' }],
});

const moduleOrder = new Map([
  ['email', 0],
  ['telegram', 1],
]);

export function normalizePresentationRegistry(
  modules: readonly OutreachPresentationModule[],
): readonly OutreachPresentationModule[] {
  const supported = modules.filter((module) => moduleOrder.has(module.moduleId));
  const seen = new Set<string>();
  for (const module of supported) {
    if (seen.has(module.moduleId)) throw new Error('DUPLICATE_PRESENTATION_MODULE');
    seen.add(module.moduleId);
  }

  return [...supported].sort(
    (left, right) =>
      (moduleOrder.get(left.moduleId) ?? Number.MAX_SAFE_INTEGER) -
      (moduleOrder.get(right.moduleId) ?? Number.MAX_SAFE_INTEGER),
  );
}
