import "server-only";
import { PrismaClient } from "@prisma/client";

// One client per process. In dev, Next.js hot reload re-evaluates modules,
// so the client is cached on globalThis to avoid opening a new pool each time.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
