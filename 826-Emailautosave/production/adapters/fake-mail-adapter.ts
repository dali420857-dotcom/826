import type {
  MailAdapter,
  SendCommand,
} from "../backend/email-automation-service";

export function createFakeMailAdapter(): MailAdapter {
  return {
    kind: "fake",
    async dispatch(command: SendCommand) {
      if (command.recipientPlaceholder.endsWith("FAIL")) {
        throw new Error("Synthetic adapter failure");
      }
      return {
        status: "accepted",
        receiptId: `fake:${command.commandId}`,
      };
    },
  };
}
