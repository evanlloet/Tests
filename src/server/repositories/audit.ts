import "server-only";
import type { DbOrTx } from "../db/client";
import { auditLogs } from "../db/schema";

export type AuditEntry = {
  userId: string;
  entity: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
};

/** Journalise une modification (planning, rapprochements, référentiel). */
export async function logAudit(db: DbOrTx, entry: AuditEntry | AuditEntry[]): Promise<void> {
  const rows = Array.isArray(entry) ? entry : [entry];
  if (rows.length === 0) return;
  await db.insert(auditLogs).values(
    rows.map((e) => ({
      userId: e.userId,
      entity: e.entity,
      entityId: e.entityId,
      action: e.action,
      before: e.before === undefined ? null : JSON.parse(JSON.stringify(e.before)),
      after: e.after === undefined ? null : JSON.parse(JSON.stringify(e.after)),
      reason: e.reason ?? null,
    })),
  );
}
