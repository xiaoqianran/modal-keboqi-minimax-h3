import { useState } from "react";

import type { StudioSection } from "./api/types";
import { BatchView } from "./features/BatchView";
import { CreateView } from "./features/CreateView";
import { GalleryImportPanel } from "./features/GalleryImportPanel";
import { GalleryView } from "./features/GalleryView";
import { LtxView } from "./features/LtxView";
import { MusicView } from "./features/MusicView";
import { SystemView } from "./features/SystemView";

const NAV: Array<{ id: StudioSection; label: string; hint: string }> = [
  { id: "create", label: "Create", hint: "H3 generation" },
  { id: "batch", label: "Batch", hint: "Persistent queue" },
  { id: "gallery", label: "Gallery", hint: "Outputs, import & finishing" },
  { id: "ltx", label: "LTX 2.5", hint: "Video workflows" },
  { id: "music", label: "Music 3", hint: "Audio generation" },
  { id: "system", label: "System", hint: "Runtime status" },
];

function page(section: StudioSection) {
  switch (section) {
    case "create":
      return <CreateView />;
    case "batch":
      return <BatchView />;
    case "gallery":
      return (
        <div className="stack-page">
          <GalleryImportPanel />
          <GalleryView />
        </div>
      );
    case "ltx":
      return <LtxView />;
    case "music":
      return <MusicView />;
    case "system":
      return <SystemView />;
  }
}

export default function App() {
  const [section, setSection] = useState<StudioSection>("create");
  const active = NAV.find((item) => item.id === section)!;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">H3</div>
          <div>
            <strong>MiniMax H3</strong>
            <span>Studio</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Studio navigation">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${section === item.id ? "active" : ""}`}
              onClick={() => setSection(item.id)}
            >
              <span className="nav-label">{item.label}</span>
              <span className="nav-hint">{item.hint}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="live-dot" />
          Standalone UI · existing H3 runtime
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div>
            <span className="topbar-kicker">MiniMax H3 Studio</span>
            <h1>{active.label}</h1>
          </div>
          <div className="topbar-meta">{active.hint}</div>
        </header>
        <div className="content">{page(section)}</div>
      </main>
    </div>
  );
}
