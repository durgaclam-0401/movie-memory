import { prisma } from "@/lib/prisma";
import type { FactGenerator } from "@/lib/facts";
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

/** Inserts a fact that is `ageMs` old, so cache tests never have to sleep. */
export function insertFact(args: {
  userId: string;
  movieTitle: string;
  ageMs: number;
  content?: string;
}) {
  return prisma.fact.create({
    data: {
      userId: args.userId,
      movieTitle: args.movieTitle,
      content: args.content ?? `Old fact about ${args.movieTitle}`,
      createdAt: new Date(Date.now() - args.ageMs),
    },
  });
}

/** Fake OpenAI: counts calls, can be slow or fail. */
export function fakeGenerator(opts: { fail?: boolean; delayMs?: number } = {}) {
  const generator = {
    calls: 0,
    async generate(movieTitle: string) {
      generator.calls += 1;
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.fail) throw new Error("simulated OpenAI failure");
      return `Fresh fact #${generator.calls} about ${movieTitle}`;
    },
  };
  return generator satisfies FactGenerator;
}
