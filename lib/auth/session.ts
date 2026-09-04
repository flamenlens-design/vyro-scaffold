import { getServerSession } from "next-auth";
import { authOptions } from "./options";

export async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  return session?.user ?? null;
}

// Throws a plain Error with a `status` the caller can map to a 401 response.
// Kept simple on purpose — API routes catch and format it consistently.
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    const err = new Error("Not authenticated") as Error & { status: number };
    err.status = 401;
    throw err;
  }
  return user;
}
