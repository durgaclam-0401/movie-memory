import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth";

let counter = 0;

export async function createUser(
  overrides: { favoriteMovie?: string | null; name?: string | null } = {},
): Promise<SessionUser> {
  counter += 1;
  return prisma.user.create({
    data: {
      email: `user${counter}@example.com`,
      name: overrides.name === undefined ? `User ${counter}` : overrides.name,
      favoriteMovie:
        overrides.favoriteMovie === undefined ? "Inception" : overrides.favoriteMovie,
    },
    select: { id: true, name: true, email: true, image: true, favoriteMovie: true },
  });
}
