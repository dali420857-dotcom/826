export type DraftStatus = "pending_review" | "approved" | "queued";
export type QueueStatus = "queued" | "processing" | "completed" | "failed";

export interface CreateDraftInput {
  templateId: string;
  recipientPlaceholder: string;
  subjectPreview: string;
  bodyPreview: string;
}

export interface MailDraft extends CreateDraftInput {
  id: string;
  status: DraftStatus;
  approvedBy: string | null;
}

export interface SendCommand {
  commandId: string;
  draftId: string;
  templateId: string;
  recipientPlaceholder: string;
  subjectPreview: string;
  bodyPreview: string;
}

export interface MailAdapterReceipt {
  status: "accepted";
  receiptId: string;
}

export interface MailAdapter {
  readonly kind: "fake" | "mailspring-private-transport";
  dispatch(command: SendCommand): Promise<MailAdapterReceipt>;
}

export interface QueueItem {
  id: string;
  draftId: string;
  status: QueueStatus;
  receiptId: string | null;
  error: string | null;
}

export interface AuditEntry {
  id: string;
  action:
    | "draft.created"
    | "draft.approved"
    | "queue.enqueued"
    | "send.accepted"
    | "send.failed";
  entityId: string;
  summary: string;
}

export interface EmailAutomationSnapshot {
  adapterKind: MailAdapter["kind"];
  drafts: MailDraft[];
  queue: QueueItem[];
  audit: AuditEntry[];
}

export interface EmailAutomationService {
  createDraft(input: CreateDraftInput): MailDraft;
  approveDraft(draftId: string, reviewerId: string): MailDraft;
  enqueueApprovedDraft(draftId: string): QueueItem;
  processNext(): Promise<QueueItem | null>;
  getSnapshot(): EmailAutomationSnapshot;
}

function required(value: string, field: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`Invalid${field}`);
  }
  return normalized;
}

export function createEmailAutomationService(options: {
  adapter: MailAdapter;
}): EmailAutomationService {
  const drafts: MailDraft[] = [];
  const queue: QueueItem[] = [];
  const audit: AuditEntry[] = [];
  let nextId = 1;

  const id = (prefix: string) => `${prefix}-${String(nextId++).padStart(4, "0")}`;
  const record = (action: AuditEntry["action"], entityId: string, summary: string) => {
    audit.push({ id: id("audit"), action, entityId, summary });
  };
  const findDraft = (draftId: string) => {
    const draft = drafts.find((candidate) => candidate.id === draftId);
    if (!draft) throw new Error("DraftNotFound");
    return draft;
  };

  return {
    createDraft(input) {
      const draft: MailDraft = {
        id: id("draft"),
        status: "pending_review",
        approvedBy: null,
        templateId: required(input.templateId, "TemplateId", 80),
        recipientPlaceholder: required(
          input.recipientPlaceholder,
          "RecipientPlaceholder",
          80,
        ),
        subjectPreview: required(input.subjectPreview, "SubjectPreview", 160),
        bodyPreview: required(input.bodyPreview, "BodyPreview", 4000),
      };
      drafts.push(draft);
      record("draft.created", draft.id, "Synthetic draft created for review.");
      return { ...draft };
    },

    approveDraft(draftId, reviewerId) {
      const draft = findDraft(draftId);
      if (draft.status !== "pending_review") throw new Error("DraftNotReviewable");
      draft.status = "approved";
      draft.approvedBy = required(reviewerId, "ReviewerId", 80);
      record("draft.approved", draft.id, "Local reviewer approved synthetic draft.");
      return { ...draft };
    },

    enqueueApprovedDraft(draftId) {
      const draft = findDraft(draftId);
      if (draft.status !== "approved") throw new Error("DraftApprovalRequired");
      if (queue.some((item) => item.draftId === draftId)) {
        throw new Error("DraftAlreadyQueued");
      }
      draft.status = "queued";
      const item: QueueItem = {
        id: id("queue"),
        draftId,
        status: "queued",
        receiptId: null,
        error: null,
      };
      queue.push(item);
      record("queue.enqueued", item.id, "Approved draft entered local queue.");
      return { ...item };
    },

    async processNext() {
      const item = queue.find((candidate) => candidate.status === "queued");
      if (!item) return null;
      const draft = findDraft(item.draftId);
      item.status = "processing";
      const command: SendCommand = {
        commandId: item.id,
        draftId: draft.id,
        templateId: draft.templateId,
        recipientPlaceholder: draft.recipientPlaceholder,
        subjectPreview: draft.subjectPreview,
        bodyPreview: draft.bodyPreview,
      };
      try {
        const receipt = await options.adapter.dispatch(command);
        item.status = "completed";
        item.receiptId = receipt.receiptId;
        record("send.accepted", item.id, "Fake adapter accepted synthetic command.");
      } catch (error) {
        item.status = "failed";
        item.error = error instanceof Error ? error.message : "Unknown adapter failure";
        record("send.failed", item.id, "Fake adapter failed; no automatic retry.");
      }
      return { ...item };
    },

    getSnapshot() {
      return {
        adapterKind: options.adapter.kind,
        drafts: drafts.map((draft) => ({ ...draft })),
        queue: queue.map((item) => ({ ...item })),
        audit: audit.map((entry) => ({ ...entry })),
      };
    },
  };
}
