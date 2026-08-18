import { routeRegistry } from "./route-registry";
import type { PageAction, PageData, PageMetric, PageRecord } from "./contracts";

const descriptions: Record<string, string> = {
  login: "只接受本地演示角色切换，不接收真实账号或密码。",
  index: "汇总设备、任务、风险与工单的本地演示状态。",
  preventing_fraud: "查看风险信号与本地审计，不触碰真实账号、设备或付款状态。",
  user_info: "展示本地演示操作者资料，不保存个人资料或凭证。",
  reset_password: "保留重置确认流程，但只生成本地 dry-run 审计。",
  account_tatistics: "按本地 fixture 展示账号活跃度与风险分布。",
  intelligence: "汇总公开面观察到的风险线索与本地分析队列。",
  proxy_manager: "管理代理池的本地表格视图，变更只做 dry-run。",
  source_manager: "维护来源分组与质量标签，所有写入停在本地模拟。",
  device_manager: "展示设备队列、健康与绑定状态，不连接真实设备。",
  ip_manager: "展示 IP 池质量与分配状态，不访问外部代理。",
  service_manager: "查看服务开关与限额，本阶段不调用生产服务。",
  task_manager: "编排任务队列与停止条件，执行按钮只返回 dry-run receipt。",
  group_send_msg: "保留群发配置与确认步骤，不发送 Telegram 或外部消息。",
  pull_group: "展示拉群流程状态，不操作真实群组或账号。",
  screen_data: "按本地样本筛选数据，不导入生产数据。",
  position: "展示定位任务参数与审计，不发起真实定位。",
  group_adv: "配置广告投放草稿，不投放、不付款、不调用外部 API。",
  build_group: "展示建群步骤与安全停止点，不创建真实群组。",
  collect: "展示采集队列与结果样本，不抓取受限资料。",
  position_collect: "组合定位与采集流程的本地演示，不连外部账号。",
  work_order: "查看工单状态与复核动作，变更只停留在本地审计。",
};

function metrics(seed: number, type: PageData["page_type"]): PageMetric[] {
  return [
    {
      label: "待处理",
      value: String(8 + seed),
      detail: "本地队列",
      tone: "teal",
    },
    {
      label: "需复核",
      value: String((seed % 5) + 2),
      detail: "人工确认",
      tone: "amber",
    },
    {
      label: "已停止",
      value: String(seed % 3),
      detail: "安全停止",
      tone: "red",
    },
    {
      label: "类型",
      value:
        type === "dashboard"
          ? "看板"
          : type === "workflow"
            ? "流程"
            : type === "form"
              ? "表单"
              : "表格",
      detail: "页面模板",
      tone: "neutral",
    },
  ];
}

function records(pageId: string, seed: number): PageRecord[] {
  return Array.from({ length: 3 }, (_, index) => ({
    id: `${pageId}-${index + 1}`,
    primary: `${pageId.replaceAll("_", " ")} 样本 ${index + 1}`,
    secondary:
      index === 0
        ? "等待本地复核"
        : index === 1
          ? "已通过只读检查"
          : "触发安全停止条件",
    status: index === 2 ? "safe-stop" : index === 1 ? "ready" : "review",
    owner: index === 1 ? "reviewer" : "operator",
    updated_at: `2026-08-15T1${(seed + index) % 10}:2${index}:00.000Z`,
  }));
}

function actions(pageId: string, supportsDryRun: boolean): PageAction[] {
  if (!supportsDryRun) return [];
  return [
    {
      id: `${pageId}-dry-run`,
      label_zh_cn: "执行本地 dry-run",
      capability: `simulate_${pageId}_change`,
      destructive: false,
    },
    {
      id: `${pageId}-safe-stop`,
      label_zh_cn: "触发安全停止",
      capability: `safe_stop_${pageId}`,
      destructive: false,
    },
  ];
}

export const pageFixtures: Record<string, PageData> = Object.fromEntries(
  routeRegistry.map((entry, index) => [
    entry.fixture_key,
    {
      page_id: entry.fixture_key,
      title_zh_cn: entry.label_zh_cn,
      description_zh_cn: descriptions[entry.fixture_key] ?? "本地演示页面。",
      page_type: entry.page_type,
      required_role: entry.required_role,
      metrics: metrics(index, entry.page_type),
      records: records(entry.fixture_key, index),
      actions: actions(entry.fixture_key, entry.supports_dry_run),
      source: "local-fixture",
      freshness: "fresh",
    },
  ]),
) as Record<string, PageData>;
