import { env } from '../config/env';
import { logger } from '../utils/logger';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Mail transport. Only a development "outbox" transport is implemented: emails are kept in
 * memory (bounded) so the verification / reset flows can be exercised without an SMTP server.
 * A real SMTP/SES transport is NOT implemented (see docs: known limitations).
 */
const outbox: Mail[] = [];

export async function sendMail(mail: Mail): Promise<void> {
  if (env.ENABLE_DEV_OUTBOX) {
    outbox.push(mail);
    if (outbox.length > 100) outbox.shift();
  }
  // Never log the body: it contains single-use links.
  logger.info({ subject: mail.subject }, 'mail queued');
}

export const getOutbox = (): Mail[] => [...outbox];
export const clearOutbox = (): void => {
  outbox.length = 0;
};
