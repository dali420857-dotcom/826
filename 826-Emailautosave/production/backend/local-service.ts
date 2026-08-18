import { createFakeMailAdapter } from "../adapters/fake-mail-adapter";
import { createEmailAutomationService } from "./email-automation-service";

export function createLocalEmailAutomationService() {
  return createEmailAutomationService({ adapter: createFakeMailAdapter() });
}
