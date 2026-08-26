import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(process.cwd(), "826-Emailautosave");
const read = (relativePath: string) =>
  readFileSync(join(projectRoot, relativePath), "utf8");

describe.skipIf(!existsSync(projectRoot))(
  "Mailspring A/DB/B one-way contract",
  () => {
    it("keeps A and B as Mailspring plugins and DB as the only durable store", () => {
      const adr = read(
        "docs/adr/2026-08-23-mailspring-two-plugin-one-way-loop.md",
      );
      const diagram = read("docs/architecture/mailspring-one-way-loop.mmd");
      expect(adr).toContain("A and B are both Mailspring");
      expect(adr).toContain("only heavy, durable store");
      expect(adr).toContain("There is no B-to-database ACK");
      expect(diagram).toContain('A -->|"one-way journal stream');
      expect(diagram).toContain(
        'DB -->|"one-way read-only eligibility snapshot',
      );
      expect(diagram).toContain('B -->|"send operation"| Core');
      expect(diagram).toContain('Core -->|"observable client event"| A');
      expect(diagram).not.toMatch(/B\s*-+\.?>\s*\|?"?[^\n]*\|?\s*DB/);
    });

    it("keeps the A readiness/disconnect gate and explicit unknown stop", () => {
      const rules = read("AGENTS.md");
      const adr = read(
        "docs/adr/2026-08-23-mailspring-two-plugin-one-way-loop.md",
      );
      expect(rules).toContain("ready／heartbeat lease");
      expect(rules).toContain("撤銷 Mailspring 連線／發送能力");
      expect(adr).toContain("`unknown` → pause → reconcile");
      expect(adr).toMatch(/Unknown is never silently\s+converted to success/);
    });

    it("does not reintroduce a fixed one-message questionnaire limit", () => {
      const questionnaire = read(
        "to-questionnaire-mailspring-private-adapter.md",
      );
      expect(questionnaire).toContain(
        "Q01：首發／回訪是否按目前 runtime／資料庫設定與既定順序執行？",
      );
      expect(questionnaire).toContain(
        "歷史答案（已由 2026-08-23 ADR supersede）",
      );
      expect(questionnaire).not.toMatch(/### Q01[^\n]*一封/);
      expect(questionnaire).not.toMatch(/### Q11[^\n]*一個人/);
      expect(questionnaire).not.toMatch(/### Q18[^\n]*一封/);
      expect(questionnaire).toContain(
        "provider health、receipt、mailbox readback 與停止條件",
      );
    });
  },
);
