"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Deliberately not importing the generated Prisma `Script` type here — see
// the existing note in page.tsx about not pulling Prisma types into
// client-facing code. Only the fields this panel actually reads.
interface ScriptState {
  current: string;
  hook: string | null;
  approved: boolean;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const TRANSFORMS = [
  "cinematic", "emotional", "viral", "concise", "storytelling",
  "dialogue", "hooks", "pacing", "luxury", "humorous", "dramatic",
] as const;

type Tab = "director" | "script";

export default function CreativeStudioPanel({
  projectId,
  initialBrief,
  initialScript,
  initialSceneCount,
}: {
  projectId: string;
  initialBrief: string | null;
  initialScript: ScriptState | null;
  initialSceneCount: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialScript ? "script" : "director");

  // --- Creative Director chat ---
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // --- Script ---
  const [brief, setBrief] = useState(initialBrief ?? "");
  const [script, setScript] = useState<ScriptState | null>(initialScript);
  const [transform, setTransform] = useState<(typeof TRANSFORMS)[number]>("cinematic");
  const [scriptLoading, setScriptLoading] = useState<"generate" | "refine" | "approve" | null>(null);

  // --- Storyboard ---
  const [sceneCount, setSceneCount] = useState(initialSceneCount);
  const [storyboardLoading, setStoryboardLoading] = useState(false);
  const [scenes, setScenes] = useState<
    { order: number; visualDesc: string; cameraAngle: string | null; durationSec: number }[] | null
  >(null);

  const [error, setError] = useState<string | null>(null);

  async function sendChat() {
    const message = chatInput.trim();
    if (!message || chatLoading) return;
    setError(null);
    setChatLoading(true);
    setChatInput("");
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: message }];
    setMessages(nextMessages);
    try {
      const res = await fetch("/api/ai/creative-director", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history: messages }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Creative Director failed");
      setMessages([...nextMessages, { role: "assistant", content: body.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creative Director failed");
      setMessages(messages); // roll back the optimistic user message on failure
    } finally {
      setChatLoading(false);
    }
  }

  async function generateScript() {
    if (!brief.trim() || scriptLoading) return;
    setError(null);
    setScriptLoading("generate");
    try {
      const res = await fetch("/api/ai/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", projectId, brief: brief.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Script generation failed");
      setScript(body.script);
      setScenes(null); // stale relative to the new script
      setTab("script");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Script generation failed");
    } finally {
      setScriptLoading(null);
    }
  }

  async function refineScript() {
    if (!script || scriptLoading) return;
    setError(null);
    setScriptLoading("refine");
    try {
      const res = await fetch("/api/ai/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refine", projectId, script: script.current, transform }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Refine failed");
      setScript(body.script);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refine failed");
    } finally {
      setScriptLoading(null);
    }
  }

  async function toggleApprove() {
    if (!script || scriptLoading) return;
    setError(null);
    setScriptLoading("approve");
    try {
      const res = await fetch("/api/ai/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", projectId, approved: !script.approved }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Approval failed");
      setScript(body.script);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setScriptLoading(null);
    }
  }

  async function generateStoryboard() {
    if (storyboardLoading) return;
    const regenerate = sceneCount > 0;
    if (regenerate && !confirm(`This replaces the existing ${sceneCount}-scene storyboard. Continue?`)) {
      return;
    }
    setError(null);
    setStoryboardLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/storyboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Storyboard generation failed");
      setScenes(body.scenes);
      setSceneCount(body.scenes.length);
      router.refresh(); // picks up any timeline/asset-panel state that reads scenes server-side
    } catch (err) {
      setError(err instanceof Error ? err.message : "Storyboard generation failed");
    } finally {
      setStoryboardLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col text-sm">
      <div className="flex gap-1 rounded-full bg-obsidian/60 p-1">
        {(["director", "script"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-full px-3 py-1.5 text-xs capitalize transition ${
              tab === t ? "bg-signal text-white" : "text-ash hover:text-bone"
            }`}
          >
            {t === "director" ? "Creative Director" : "Script & Storyboard"}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 text-xs text-ember">
          {error}
        </p>
      )}

      {tab === "director" ? (
        <div className="mt-4 flex flex-1 flex-col overflow-hidden">
          <p className="text-xs text-ash">
            Ask for a change in plain language — e.g. &quot;make the first 3 seconds more exciting.&quot;
          </p>
          <div className="mt-3 flex-1 space-y-3 overflow-y-auto rounded-lg border border-white/10 p-3">
            {messages.length === 0 && (
              <p className="text-xs text-ash">No messages yet — say hello.</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                <span
                  className={`inline-block max-w-[90%] rounded-lg px-3 py-1.5 text-xs ${
                    m.role === "user" ? "bg-signal/20 text-bone" : "bg-white/5 text-ash"
                  }`}
                >
                  {m.content}
                </span>
              </div>
            ))}
            {chatLoading && <p className="text-xs text-ash">Thinking…</p>}
          </div>
          <div className="mt-3 flex gap-2">
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendChat();
                }
              }}
              placeholder="Type a note…"
              rows={2}
              className="flex-1 rounded-lg border border-white/10 bg-obsidian/60 p-2 text-sm text-bone placeholder:text-ash"
            />
            <button
              onClick={sendChat}
              disabled={chatLoading || !chatInput.trim()}
              className="rounded-full bg-signal px-4 text-xs font-medium text-white disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex-1 space-y-4 overflow-y-auto">
          {!script ? (
            <div className="space-y-2">
              <p className="text-xs text-ash">
                No script yet. Describe what this video is about and the Script Agent will draft one.
              </p>
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={4}
                placeholder="A 30-second launch film for a new luxury perfume…"
                className="w-full rounded-lg border border-white/10 bg-obsidian/60 p-2 text-xs text-bone placeholder:text-ash"
              />
              <button
                onClick={generateScript}
                disabled={scriptLoading !== null || !brief.trim()}
                className="w-full rounded-full bg-signal px-4 py-2 text-xs font-medium text-white disabled:opacity-40"
              >
                {scriptLoading === "generate" ? "Writing…" : "Generate script"}
              </button>
            </div>
          ) : (
            <>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ash">Script</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                      script.approved ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-ash"
                    }`}
                  >
                    {script.approved ? "Approved" : "Draft"}
                  </span>
                </div>
                <textarea
                  value={script.current}
                  readOnly
                  rows={8}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-obsidian/60 p-2 text-xs text-bone"
                />
              </div>

              <div className="flex gap-2">
                <select
                  value={transform}
                  onChange={(e) => setTransform(e.target.value as (typeof TRANSFORMS)[number])}
                  disabled={script.approved}
                  className="flex-1 rounded-lg border border-white/10 bg-obsidian/60 px-2 py-1.5 text-xs text-bone disabled:opacity-40"
                >
                  {TRANSFORMS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <button
                  onClick={refineScript}
                  disabled={scriptLoading !== null || script.approved}
                  className="rounded-full border border-white/15 px-3 text-xs text-bone disabled:opacity-40"
                  title={script.approved ? "Un-approve to keep editing" : undefined}
                >
                  {scriptLoading === "refine" ? "Refining…" : "Refine"}
                </button>
              </div>

              <button
                onClick={toggleApprove}
                disabled={scriptLoading !== null}
                className="w-full rounded-full border border-white/15 px-4 py-1.5 text-xs text-bone disabled:opacity-40"
              >
                {scriptLoading === "approve"
                  ? "Saving…"
                  : script.approved
                    ? "Un-approve"
                    : "Approve script"}
              </button>

              <button
                onClick={generateStoryboard}
                disabled={!script.approved || storyboardLoading}
                title={!script.approved ? "Approve the script first" : undefined}
                className="w-full rounded-full bg-signal px-4 py-2 text-xs font-medium text-white disabled:opacity-40"
              >
                {storyboardLoading
                  ? "Storyboarding…"
                  : sceneCount > 0
                    ? `Regenerate storyboard (${sceneCount} scenes)`
                    : "Generate storyboard"}
              </button>

              {scenes && (
                <div className="space-y-2 rounded-lg border border-white/10 p-2">
                  <p className="text-xs text-ash">{scenes.length} scenes generated</p>
                  {scenes.map((s) => (
                    <div key={s.order} className="rounded bg-white/5 p-2 text-xs">
                      <span className="text-ash">
                        #{s.order + 1} · {s.durationSec}s{s.cameraAngle ? ` · ${s.cameraAngle}` : ""}
                      </span>
                      <p className="mt-0.5 text-bone">{s.visualDesc}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
