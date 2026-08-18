/**
 * Route-specific task-domain fixtures.
 *
 * These records are intentionally local and provider-neutral.  The MSW
 * handler can project them into the shared LocalResponse envelope without
 * coupling the task pages to a remote service or to a browser session.
 */

export const taskFixtureKeys = [
  "task-manager",
  "group-send-msg",
  "pull-group",
  "screen-data",
  "position",
  "group-adv",
  "build-group",
  "collect",
  "position-collect",
  "work-order",
] as const;

export type TaskFixtureKey = (typeof taskFixtureKeys)[number];

export type TaskRecordState =
  "queued" | "review" | "ready" | "safe-stop" | "draft";

export interface TaskMetricFixture {
  label: string;
  value: string;
  detail: string;
  tone: "teal" | "amber" | "red" | "neutral";
}

export interface TaskRecordFixture {
  id: string;
  primary: string;
  secondary: string;
  status: TaskRecordState;
  owner: "operator" | "reviewer" | "viewer";
  updated_at: string;
}

export interface TaskActionFixture {
  id: string;
  label_zh_cn: string;
  capability: string;
  destructive: false;
}

export interface TaskPageFixture {
  page_id: TaskFixtureKey;
  title_zh_cn: string;
  description_zh_cn: string;
  page_type: "table" | "form" | "workflow";
  required_role: "operator" | "viewer";
  metrics: readonly TaskMetricFixture[];
  records: readonly TaskRecordFixture[];
  actions: readonly TaskActionFixture[];
  source: "local-fixture";
  freshness: "fresh";
}

function action(
  pageId: TaskFixtureKey,
  suffix: string,
  label_zh_cn: string,
): TaskActionFixture {
  return {
    id: `${pageId}-${suffix}`,
    label_zh_cn,
    capability: `simulate_${pageId}_${suffix}`,
    destructive: false,
  };
}

function metrics(
  pending: string,
  review: string,
  stopped: string,
  mode: string,
): readonly TaskMetricFixture[] {
  return [
    { label: "待处理", value: pending, detail: "本地队列", tone: "teal" },
    { label: "需复核", value: review, detail: "人工确认", tone: "amber" },
    { label: "已停止", value: stopped, detail: "安全停止", tone: "red" },
    { label: "模式", value: mode, detail: "本地模板", tone: "neutral" },
  ];
}

function records(
  pageId: TaskFixtureKey,
  names: readonly [string, string, string],
): readonly TaskRecordFixture[] {
  const updated = [
    "2026-08-15T17:20:00.000Z",
    "2026-08-15T16:45:00.000Z",
    "2026-08-15T15:30:00.000Z",
  ] as const;
  const states: readonly TaskRecordState[] = ["queued", "review", "safe-stop"];
  return names.map((name, index) => ({
    id: `${pageId}-${index + 1}`,
    primary: name,
    secondary:
      index === 0
        ? "等待本地复核"
        : index === 1
          ? "已通过只读检查"
          : "触发安全停止条件",
    status: states[index],
    owner: index === 1 ? "reviewer" : "operator",
    updated_at: updated[index],
  }));
}

export const TASK_FIXTURES = {
  "task-manager": {
    page_id: "task-manager",
    title_zh_cn: "任务管理",
    description_zh_cn: "编排本地任务队列、停止条件与复核步骤。",
    page_type: "workflow",
    required_role: "operator",
    metrics: metrics("12", "4", "1", "队列"),
    records: records("task-manager", [
      "设备健康检查",
      "来源质量复核",
      "队列安全演练",
    ]),
    actions: [
      action("task-manager", "preview", "预览任务执行"),
      action("task-manager", "safe-stop", "触发安全停止"),
    ],
    source: "local-fixture",
    freshness: "fresh",
  },
  "group-send-msg": {
    page_id: "group-send-msg",
    title_zh_cn: "群发消息",
    description_zh_cn:
      "保留群发配置与确认步骤，但不会发送 Telegram 或外部消息。",
    page_type: "form",
    required_role: "operator",
    metrics: metrics("3", "2", "0", "草稿"),
    records: records("group-send-msg", [
      "运营通知草稿",
      "活动提醒草稿",
      "安全公告草稿",
    ]),
    actions: [
      action("group-send-msg", "preview", "预览本地发送"),
      action("group-send-msg", "safe-stop", "安全停止发送流程"),
    ],
    source: "local-fixture",
    freshness: "fresh",
  },
  "pull-group": {
    page_id: "pull-group",
    title_zh_cn: "拉取群组",
    description_zh_cn: "演示群组发现与人工复核流程，不操作真实账号或群组。",
    page_type: "workflow",
    required_role: "operator",
    metrics: metrics("8", "3", "1", "流程"),
    records: records("pull-group", [
      "公开群组样本 A",
      "公开群组样本 B",
      "待确认群组 C",
    ]),
    actions: [
      action("pull-group", "preview", "预览拉群流程"),
      action("pull-group", "safe-stop", "停止本地流程"),
    ],
    source: "local-fixture",
    freshness: "fresh",
  },
  "screen-data": {
    page_id: "screen-data",
    title_zh_cn: "筛选数据",
    description_zh_cn: "按本地样本筛选数据，不导入生产数据或外部资料。",
    page_type: "table",
    required_role: "viewer",
    metrics: metrics("24", "5", "0", "筛选"),
    records: records("screen-data", [
      "样本集 Alpha",
      "样本集 Beta",
      "样本集 Gamma",
    ]),
    actions: [],
    source: "local-fixture",
    freshness: "fresh",
  },
  position: {
    page_id: "position",
    title_zh_cn: "位置管理",
    description_zh_cn: "展示定位任务参数与审计，不发起真实定位。",
    page_type: "form",
    required_role: "operator",
    metrics: metrics("5", "2", "1", "定位"),
    records: records("position", ["区域样本 A", "区域样本 B", "区域样本 C"]),
    actions: [
      action("position", "preview", "预览定位任务"),
      action("position", "safe-stop", "停止定位任务"),
    ],
    source: "local-fixture",
    freshness: "fresh",
  },
  "group-adv": {
    page_id: "group-adv",
    title_zh_cn: "群组推广",
    description_zh_cn: "配置推广草稿，不投放、不付款、不调用外部 API。",
    page_type: "form",
    required_role: "operator",
    metrics: metrics("2", "1", "0", "草稿"),
    records: records("group-adv", ["推广草稿 01", "推广草稿 02", "待审核素材"]),
    actions: [
      action("group-adv", "preview", "预览推广草稿"),
      action("group-adv", "safe-stop", "停止推广流程"),
    ],
    source: "local-fixture",
    freshness: "fresh",
  },
  "build-group": {
    page_id: "build-group",
    title_zh_cn: "创建群组",
    description_zh_cn: "展示建群步骤与安全停止点，不创建真实群组。",
    page_type: "workflow",
    required_role: "operator",
    metrics: metrics("4", "2", "1", "建群"),
    records: records("build-group", [
      "群组草稿 A",
      "群组草稿 B",
      "待复核群组 C",
    ]),
    actions: [
      action("build-group", "preview", "预览建群步骤"),
      action("build-group", "safe-stop", "停止建群流程"),
    ],
    source: "local-fixture",
    freshness: "fresh",
  },
  collect: {
    page_id: "collect",
    title_zh_cn: "数据采集",
    description_zh_cn: "展示采集队列与结果样本，不抓取受限资料。",
    page_type: "workflow",
    required_role: "operator",
    metrics: metrics("9", "3", "1", "采集"),
    records: records("collect", [
      "公开页面样本 A",
      "公开页面样本 B",
      "已安全停止样本",
    ]),
    actions: [
      action("collect", "preview", "预览采集任务"),
      action("collect", "safe-stop", "停止采集任务"),
    ],
    source: "local-fixture",
    freshness: "fresh",
  },
  "position-collect": {
    page_id: "position-collect",
    title_zh_cn: "位置采集",
    description_zh_cn: "组合定位与采集流程的本地演示，不连接外部账号。",
    page_type: "workflow",
    required_role: "operator",
    metrics: metrics("6", "2", "1", "组合流程"),
    records: records("position-collect", [
      "定位样本 A",
      "采集样本 B",
      "需复核样本 C",
    ]),
    actions: [
      action("position-collect", "preview", "预览组合流程"),
      action("position-collect", "safe-stop", "停止组合流程"),
    ],
    source: "local-fixture",
    freshness: "fresh",
  },
  "work-order": {
    page_id: "work-order",
    title_zh_cn: "工单管理",
    description_zh_cn: "查看工单状态与复核动作，变更只停留在本地审计。",
    page_type: "table",
    required_role: "operator",
    metrics: metrics("7", "4", "0", "工单"),
    records: records("work-order", [
      "设备复核工单",
      "来源异常工单",
      "安全停止工单",
    ]),
    actions: [
      action("work-order", "preview", "预览工单动作"),
      action("work-order", "safe-stop", "安全停止工单动作"),
    ],
    source: "local-fixture",
    freshness: "fresh",
  },
} as const satisfies Record<TaskFixtureKey, TaskPageFixture>;

export function getTaskFixture(pageId: string): TaskPageFixture | undefined {
  return Object.prototype.hasOwnProperty.call(TASK_FIXTURES, pageId)
    ? TASK_FIXTURES[pageId as TaskFixtureKey]
    : undefined;
}
