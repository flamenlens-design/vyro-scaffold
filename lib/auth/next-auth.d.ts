import type { DefaultSession, DefaultUser } from "next-auth";

// Extends NextAuth's built-in types with the fields our Prisma User model
// adds (id, credits, plan) so `session.user.credits` etc. are properly typed
// everywhere — in lib/auth/options.ts, lib/auth/session.ts, and any component
// using useSession() — without ever needing an `as any` cast.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      credits: number;
      plan: string;
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    credits: number;
    plan: string;
  }
}
