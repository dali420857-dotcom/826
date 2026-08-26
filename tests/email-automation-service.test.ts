import { describe, expect, it } from "vitest";
import {
  createEmailAutomationService,
  type MailAdapter,
} from "../826-Emailautosave/production/backend/email-automation-service";

describe("EmailAutomationService", () => {
  it("requires explicit review approval before queueing a synthetic draft", async () => {
    const calls: string[] = [];
    const adapter: MailAdapter = {
      kind: "fake",
      async dispatch(command) {
        calls.push(command.commandId);
        return { status: "accepted", receiptId: "fake-receipt-1" };
      },
    };
    const service = createEmailAutomationService({ adapter });

    const draft = service.createDraft({
      templateId: "welcome-v1",
      recipientPlaceholder: "CONTACT-001",
      subjectPreview: "合成主旨",
      bodyPreview: "合成內容，只供測試。",
    });

    expect(() => service.enqueueApprovedDraft(draft.id)).toThrow(
      "DraftApprovalRequired",
    );
    expect(calls).toEqual([]);

    service.approveDraft(draft.id, "local-reviewer");
    service.enqueueApprovedDraft(draft.id);
    await service.processNext();

    const snapshot = service.getSnapshot();
    expect(calls).toHaveLength(1);
    expect(snapshot.queue[0]).toMatchObject({ status: "completed" });
    expect(snapshot.audit.map((entry) => entry.action)).toEqual([
      "draft.created",
      "draft.approved",
      "queue.enqueued",
      "send.accepted",
    ]);
  });

  it("surfaces adapter failures without retrying or losing audit evidence", async () => {
    let attempts = 0;
    const adapter: MailAdapter = {
      kind: "fake",
      async dispatch() {
        attempts += 1;
        throw new Error("Synthetic adapter failure");
      },
    };
    const service = createEmailAutomationService({ adapter });
    const draft = service.createDraft({
      templateId: "followup-v1",
      recipientPlaceholder: "CONTACT-FAIL",
      subjectPreview: "合成失敗案例",
      bodyPreview: "不會離開本機。",
    });
    service.approveDraft(draft.id, "local-reviewer");
    service.enqueueApprovedDraft(draft.id);

    await service.processNext();

    const snapshot = service.getSnapshot();
    expect(attempts).toBe(1);
    expect(snapshot.queue[0]).toMatchObject({
      status: "failed",
      error: "Synthetic adapter failure",
    });
    expect(snapshot.audit.at(-1)?.action).toBe("send.failed");
  });
});
