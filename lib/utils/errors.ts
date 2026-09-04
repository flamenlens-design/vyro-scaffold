// Every API route catches `unknown` (not `any`) and uses these helpers to
// pull out a message/status safely. Keeps error handling consistent without
// each route needing its own type guard.

interface StatusError extends Error {
  status?: number;
}

function hasStatus(err: unknown): err is StatusError {
  return err instanceof Error && "status" in err;
}

export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  return err instanceof Error ? err.message : fallback;
}

export function errorStatus(err: unknown, fallback = 500): number {
  if (hasStatus(err) && typeof err.status === "number") return err.status;
  return fallback;
}
