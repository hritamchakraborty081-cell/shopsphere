import type { Role } from '../generated/prisma/client';

declare global {
  namespace Express {
    interface Request {
      id: string;
      auth?: {
        sessionId: string;
        csrfToken: string;
        user: {
          id: string;
          email: string;
          name: string;
          role: Role;
          emailVerifiedAt: Date | null;
        };
      };
    }
  }
}
export {};
