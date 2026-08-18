import type { MailAdapter } from "../backend/email-automation-service";

/**
 * Contract marker for the reference-selected private transport route.
 * Construction is fail-closed until a separate user approval and runtime probe exist.
 */
export function createMailspringPrivateTransportAdapter(): MailAdapter {
  throw new Error("MailspringRuntimeApprovalRequired");
}
