import { z } from "zod";

const HermesAdapterStatusSchema = z.enum([
  "contract_only_not_live",
  "loopback_verified",
  "blocked",
]);

export const HermesResearchRequestSchema = z.object({
  objective: z.string().trim().min(1),
  scope: z.array(z.string().trim().min(1)).min(1),
  evidence_requirements: z.array(z.string().trim().min(1)).default([]),
  authorization: z.enum(["local_only", "approved_read_only_external"]),
  max_parallel_children: z.number().int().min(1).max(3).default(3),
});

export type HermesResearchRequest = z.infer<typeof HermesResearchRequestSchema>;

export const HermesResearchReceiptSchema = z
  .object({
    status: z.enum(["success", "warning", "error"]),
    summary: z.string().min(1),
    next_actions: z.array(z.string()),
    artifacts: z.record(z.string(), z.unknown()),
    run_id: z.string().min(1),
    evidence_refs: z.array(z.string()),
    provenance: z.object({
      source: z.string().min(1),
      collected_at: z.string().min(1),
    }),
    adapter_status: HermesAdapterStatusSchema,
    mutation_applied: z.literal(false),
    external_mutations: z.literal(false),
    credentials_accessed: z.literal(false),
    network_requests: z.boolean(),
  })
  .strict();

export type HermesResearchReceipt = z.infer<typeof HermesResearchReceiptSchema>;

export const hermesResearchCoordinatorCapability = {
  id: "coordinate_hermes_research",
  classification: "diagnostics",
  mutating: false,
  dry_run: true,
  readback: "required",
  approval: "explicit_for_read_only_external_research",
  adapter_status: "contract_only_not_live",
  max_parallel_children: 3,
  max_depth: 1,
} as const satisfies Record<string, string | boolean | number>;

export function validateHermesResearchReceipt(
  receipt: unknown,
): HermesResearchReceipt {
  return HermesResearchReceiptSchema.parse(receipt);
}
