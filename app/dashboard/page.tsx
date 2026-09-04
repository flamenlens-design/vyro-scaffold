import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const projects = await prisma.project.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl italic text-bone">Your projects</h1>
          <p className="mt-1 text-sm text-ash">{user.credits} credits available</p>
        </div>
        <Link
          href="/project/new"
          className="rounded-full bg-signal px-5 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
        >
          New project
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="mt-14 flex flex-col items-start gap-3 rounded-xl2 border border-dashed border-white/15 p-12">
          <p className="font-display text-xl italic text-bone">Nothing here yet.</p>
          <p className="max-w-sm text-sm text-ash">
            Start with a one-line idea — a Creative Director session will turn it into a script,
            a storyboard, and a shot list before you generate a single frame.
          </p>
          <Link href="/project/new" className="mt-2 text-sm text-signal hover:brightness-110">
            Start a project
          </Link>
        </div>
      ) : (
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/project/${p.id}`}
              className="rounded-xl2 border border-white/10 p-5 transition hover:border-white/25"
            >
              <div className="aspect-video rounded-lg bg-obsidian" />
              <p className="mt-3 font-display italic text-bone">{p.name}</p>
              <p className="mt-1 text-xs text-ash">
                {p.status.toLowerCase()} · {p.aspectRatio}
              </p>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
