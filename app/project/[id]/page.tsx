// Studio shell: left tool rail, center preview, bottom timeline, right AI panel.
// This is a layout skeleton — wire real state (project data, timeline, chat)
// in before treating any panel as functional.

const LEFT_TOOLS = ["Assets", "Scenes", "Media", "Text", "Captions", "Brand", "Audio", "AI Tools"];

// Next.js 15+ makes dynamic route `params` async — must be awaited before use.
export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex h-screen flex-col bg-void text-bone">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <span className="font-display italic text-bone">Untitled project</span>
        <div className="flex items-center gap-3 text-sm text-ash">
          <button className="hover:text-bone">Undo</button>
          <button className="hover:text-bone">Redo</button>
          <span className="text-xs">Saved</span>
          <button className="rounded-full bg-signal px-4 py-1.5 text-white hover:brightness-110">
            Export
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left tool rail */}
        <aside className="flex w-16 shrink-0 flex-col items-center gap-4 border-r border-white/10 py-4">
          {LEFT_TOOLS.map((tool) => (
            <button
              key={tool}
              title={tool}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-[10px] text-ash hover:bg-white/5 hover:text-bone"
            >
              {tool.slice(0, 2)}
            </button>
          ))}
        </aside>

        {/* Center: preview + timeline */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 items-center justify-center bg-obsidian/40">
            <div className="aspect-[9/16] h-[70%] rounded-xl2 border border-white/10 bg-void" />
          </div>
          <div className="h-48 shrink-0 border-t border-white/10 bg-obsidian/60 p-3">
            <p className="text-xs text-ash">Timeline — project {id}</p>
            <div className="mt-2 h-32 rounded-lg border border-dashed border-white/10" />
          </div>
        </div>

        {/* Right: properties + AI assistant */}
        <aside className="w-80 shrink-0 border-l border-white/10 p-4">
          <p className="text-sm font-medium text-bone">Creative Director</p>
          <p className="mt-1 text-xs text-ash">
            Ask for a change in plain language — e.g. &quot;make the first 3 seconds more exciting.&quot;
          </p>
          <div className="mt-4 h-64 rounded-lg border border-white/10" />
          <textarea
            placeholder="Type a note…"
            className="mt-3 w-full rounded-lg border border-white/10 bg-obsidian/60 p-2 text-sm text-bone placeholder:text-ash"
            rows={2}
          />
        </aside>
      </div>
    </div>
  );
}
