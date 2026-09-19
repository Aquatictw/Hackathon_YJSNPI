import { z } from "zod";

const id = z.string().min(1).max(120);

export const createCommandSchema = z.object({
  request_id: id,
  incident_id: id,
  kind: z.literal("show_message"),
  message: z.string().trim().min(1).max(500),
  ttl_seconds: z.number().int().min(30).max(300).default(120),
  user_confirmed: z.literal(true),
}).strict();

export const commandResultSchema = z.object({
  ack_id: id,
  run_id: id,
  tester_id: id,
  status: z.enum(["received", "queued_to_tester", "tester_confirmed", "rejected", "failed", "expired"]),
  tester_receipt_id: id.nullable().optional(),
  detail: z.string().max(1000).default(""),
  occurred_at: z.string().datetime({ offset: true }),
}).strict().superRefine((result, ctx) => {
  if (result.status === "tester_confirmed" && !result.tester_receipt_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tester_receipt_id"], message: "tester_confirmed requires tester_receipt_id" });
  }
});

export type CreateCommandInput = z.infer<typeof createCommandSchema>;
export type CommandResultInput = z.infer<typeof commandResultSchema>;

export const commandStatuses = ["queued", "received", "queued_to_tester", "tester_confirmed", "rejected", "failed", "expired"] as const;
export type CommandStatus = typeof commandStatuses[number];

const allowedTransitions: Record<CommandStatus, ReadonlySet<CommandStatus>> = {
  queued: new Set(["queued", "received", "queued_to_tester", "tester_confirmed", "rejected", "failed", "expired"]),
  received: new Set(["received", "queued_to_tester", "tester_confirmed", "rejected", "failed", "expired"]),
  queued_to_tester: new Set(["queued_to_tester", "tester_confirmed", "failed", "expired"]),
  tester_confirmed: new Set(["tester_confirmed"]),
  rejected: new Set(["rejected"]),
  failed: new Set(["failed"]),
  expired: new Set(["expired"]),
};

export function canApplyCommandStatus(current: string, next: CommandResultInput["status"]): boolean {
  return commandStatuses.includes(current as CommandStatus)
    && allowedTransitions[current as CommandStatus].has(next);
}
