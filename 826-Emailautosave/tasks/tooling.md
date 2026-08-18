# Dali Outreach 工具、Skills、插件與套件清單

## 固定工作流

`Skill Preflight → ask-matt → using-agent-skills → /to-spec → /to-tickets → /implement → /tdd → /code-review`

## Verified local tools

| Tool | Status | Use |
| --- | --- | --- |
| Graphify | runtime-ready | 依賴地圖；原始檔仍是 source of truth |
| PowerShell 7.6.4 | verified | preflight、baseline、readback |
| Node 24.16.0 / npm 11.17.0 | verified | isolated production harness |
| Git 2.54.0 / rg 15.2.0 | verified | dirty/diff/search evidence |
| GitHub CLI 2.92.0 | readback verified | canonical source/commit read only |
| TypeScript 6.0.3 | installed | contracts/typecheck |
| Vite 8.2.1 / Vitest 4.1.10 | installed | new isolated config only |
| Playwright 1.62.1 | installed | loopback browser acceptance |
| Zod 4.4.3 / MSW 2.15.0 / jsdom 30.0.1 | installed | schemas、fakes、DOM tests |
| ESLint 10.8.1 / Prettier 3.9.6 | installed | static quality |

現有 root Vue config/harness 已退役；以上 executable/version 存在不代表可以重用其 Vue entry、route 或 build result。

## Proposed isolated React package boundary

新增 dependencies 前先固定版本與 lockfile diff：

- Runtime：`react`、`react-dom`、`zod`
- Build：`typescript`、`vite`、`@vitejs/plugin-react`
- Unit/component：`vitest`、`jsdom`、`@testing-library/react`
- Fake/integration：`msw`
- Browser：`@playwright/test`
- Quality：`eslint`、`prettier`

React、ReactDOM、React Vite plugin 與 React Testing Library 目前 missing；不得在未審查 package manifest/lockfile 前由 worker 自行安裝。

## Skills by phase

- Define/plan：`spec-driven-development`、`planning-and-task-breakdown`、`domain-modeling`、`codebase-design`、`api-and-interface-design`、`documentation-and-adrs`。
- Build：`incremental-implementation`、`frontend-ui-engineering`、`source-driven-development`、`context-engineering`。
- Verify：`tdd`／`test-driven-development`、`webapp-testing`、`browser-testing-with-devtools`、`security-and-hardening`、`observability-and-instrumentation`。
- Closeout：`code-review`、`code-review-and-quality`、`code-simplification`、`deprecation-and-migration`。

## Plugins / MCP

- 使用：OpenAI bundled Browser/Chrome（UI readback）、GitHub CLI（source readback）、本機 Playwright。
- `multi_agent_v2`: feature enabled/callable；不是 plugin，也不是 side-effect 授權。
- Configured only：GitHub/Context7/Playwright MCP 等需要時先做窄 probe；不因 configured 升格 runtime-ready。
- 不需安裝：Outlook Email、其他 recommended plugins、provider connectors。
- 不使用：Firecrawl/Exa 作必要路徑、Hermes live adapter、真實 Email/TG connector、退役 Vue runtime、reference runtime、push/PR/deploy。
