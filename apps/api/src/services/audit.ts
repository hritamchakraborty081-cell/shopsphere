import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';

/** Write an audit record for security-relevant and administrative actions. Never throws. */
export async function audit(
  actorId: string | null,
  action: string,
  entity: string,
  entityId?: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: { actorId, action, entity, entityId: entityId ?? null, metadata: metadata as object },
    });
  } catch (err) {
    logger.error({ err, action }, 'failed to write audit log');
  }
}
