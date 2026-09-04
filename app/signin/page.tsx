"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="font-display text-3xl italic text-bone">Sign in to VYRO</h1>
      <p className="mt-2 text-sm text-ash">One idea away from a film.</p>

      <button
        onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
        className="mt-8 rounded-full border border-white/15 px-5 py-2.5 text-sm font-medium text-bone transition hover:bg-white/5"
      >
        Continue with Google
      </button>

      <div className="my-6 flex items-center gap-3 text-xs text-ash">
        <span className="h-px flex-1 bg-white/10" />
        or
        <span className="h-px flex-1 bg-white/10" />
      </div>

      {sent ? (
        <p className="text-sm text-ash">
          Check <span className="text-bone">{email}</span> for a sign-in link.
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await signIn("email", { email, redirect: false, callbackUrl: "/dashboard" });
            setSent(true);
          }}
          className="flex flex-col gap-3"
        >
          <input
            type="email"
            required
            placeholder="you@studio.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-white/15 bg-obsidian/60 px-4 py-2.5 text-sm text-bone placeholder:text-ash"
          />
          <button
            type="submit"
            className="rounded-full bg-signal px-5 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
          >
            Send sign-in link
          </button>
        </form>
      )}
    </main>
  );
}
