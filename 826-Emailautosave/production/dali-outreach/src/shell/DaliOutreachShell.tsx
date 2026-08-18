import type { ReactNode } from 'react';
import type { OutreachPresentationModule } from '../contracts';
import '../styles/dali-outreach.css';
import { HomeIcon, MailIcon, SearchIcon, TelegramIcon } from './ShellIcons';
import {
  SourceStateBand,
  summarizeSourceEvidence,
  type SourceEvidence,
  type SourceSummary,
  type SourceState,
} from './SourceStateBand';
import { normalizePresentationRegistry } from './syntheticPresentationRegistry';

export interface DaliOutreachShellProps {
  readonly modules: readonly OutreachPresentationModule[];
  readonly currentPath: string;
  readonly sourceEvidence: readonly SourceEvidence[];
  readonly now: string;
  readonly renderRoute?: (moduleId: 'email' | 'telegram', path: string) => ReactNode;
  readonly overviewContent?: ReactNode;
}

const moduleMeta = {
  email: {
    title: 'Email',
    description: '郵件草稿、審核與本機待辦佇列。',
    icon: MailIcon,
  },
  telegram: {
    title: 'Telegram',
    description: 'Telegram 訊息草稿、審核與本機待辦佇列。',
    icon: TelegramIcon,
  },
} as const;

export function DaliOutreachShell({
  modules,
  currentPath,
  sourceEvidence,
  now,
  renderRoute,
  overviewContent,
}: DaliOutreachShellProps) {
  const registry = normalizePresentationRegistry(modules);
  const sourceSummary = summarizeSourceEvidence(
    registry.map((module) => module.moduleId),
    sourceEvidence,
    now,
  );
  const sourceState = sourceSummary.state;
  const activeRoute = registry.flatMap((module) =>
    module.routes.map((route) => ({ module, route })),
  ).find(({ route }) => route.path === currentPath);

  return (
    <div className="outreach-shell">
      <aside className="outreach-sidebar" aria-label="主要導航">
        <div className="outreach-brand">
          <span className="outreach-brand__mark" aria-hidden="true">D</span>
          <span>Dali Outreach</span>
        </div>
        <nav className="outreach-nav">
          <a
            aria-current={currentPath === '/overview' ? 'page' : undefined}
            className={currentPath === '/overview' ? 'is-active' : ''}
            href="#/overview"
          >
            <HomeIcon />
            <span>總覽</span>
          </a>
          {registry.flatMap((module) => {
            const Icon = moduleMeta[module.moduleId].icon;
            return module.navItems.map((item) => (
              <a
                aria-current={currentPath === item.path ? 'page' : undefined}
                className={currentPath === item.path ? 'is-active' : ''}
                href={`#${item.path}`}
                key={`${module.moduleId}:${item.id}`}
              >
                <Icon />
                <span>{item.label}</span>
              </a>
            ));
          })}
        </nav>
        <div className="outreach-sidebar__foot">Phase 0 · no-send</div>
      </aside>

      <div className="outreach-workspace">
        <header className="outreach-topbar">
          <h1>{activeRoute ? moduleMeta[activeRoute.module.moduleId].title : '總覽'}</h1>
          <label className="outreach-search">
            <SearchIcon />
            <span className="sr-only">搜尋目前畫面</span>
            <input disabled placeholder="搜尋尚未啟用" type="search" />
          </label>
          <div className="outreach-topbar__status">
            <span className={`source-count source-count--${sourceState}`}><i aria-hidden="true" />{sourceSummary.readyCount}/{sourceSummary.totalCount} 來源</span>
            <span>執行模式 <strong>Monitoring only</strong></span>
            <button disabled type="button">暫停全部</button>
          </div>
        </header>

        <SourceStateBand summary={sourceSummary} />

        <main className="outreach-main">
          {activeRoute ? (
            <ModuleRoute
              label={
                activeRoute.module.navItems.find(
                  (item) => item.path === activeRoute.route.path,
                )?.label ?? moduleMeta[activeRoute.module.moduleId].title
              }
              module={activeRoute.module}
              sourceState={
                sourceSummary.sources.find(
                  (source) => source.moduleId === activeRoute.module.moduleId,
                )?.state ?? 'unavailable'
              }
            >
              {renderRoute?.(activeRoute.module.moduleId, activeRoute.route.path)}
            </ModuleRoute>
          ) : (
            <Overview modules={registry} sourceSummary={sourceSummary}>
              {overviewContent}
            </Overview>
          )}
        </main>
      </div>
    </div>
  );
}

function Overview({
  modules,
  sourceSummary,
  children,
}: {
  modules: readonly OutreachPresentationModule[];
  sourceSummary: SourceSummary;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby="overview-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">SYNTHETIC READ MODEL</p>
          <h2 id="overview-title">外聯總覽</h2>
        </div>
        <span className="monitoring-badge">Monitoring only</span>
      </div>
      <div className="module-grid">
        {modules.map((module) => {
          const meta = moduleMeta[module.moduleId];
          const Icon = meta.icon;
          const moduleState =
            sourceSummary.sources.find((source) => source.moduleId === module.moduleId)
              ?.state ?? 'unavailable';
          return (
            <article className="module-card" key={module.moduleId}>
              <div className="module-card__icon"><Icon /></div>
              <div>
                <h3>{meta.title}</h3>
                <p>{meta.description}</p>
              </div>
              <span className={`module-state module-state--${moduleState}`}>{moduleState}</span>
            </article>
          );
        })}
      </div>
      {children}
    </section>
  );
}

function ModuleRoute({
  label,
  module,
  sourceState,
  children,
}: {
  label: string;
  module: OutreachPresentationModule;
  sourceState: SourceState;
  children?: ReactNode;
}) {
  const meta = moduleMeta[module.moduleId];
  return (
    <section aria-labelledby="module-route-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{module.moduleId.toUpperCase()} · SYNTHETIC</p>
          <h2 id="module-route-title">{label}</h2>
          <p>{meta.description}</p>
        </div>
        <span className={`module-state module-state--${sourceState}`}>{sourceState}</span>
      </div>
      {children ?? (
        <div className="outreach-empty">
          <h3>尚未載入正式快照</h3>
          <p>此模塊目前只顯示 deterministic fixture，不會連接或發送真實訊息。</p>
        </div>
      )}
    </section>
  );
}
