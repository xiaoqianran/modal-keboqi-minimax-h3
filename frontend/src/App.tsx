import { useState } from "react";

import type { StudioSection } from "./api/types";
import { BatchView } from "./features/BatchView";
import { CreateView } from "./features/CreateView";
import { GalleryView } from "./features/GalleryView";
import { PlaceholderView } from "./features/PlaceholderView";
import { SystemView } from "./features/SystemView";

const NAV: Array<{ id: StudioSection; label: string; hint: string }> = [
  { id: "create", label: "Create", hint: "H3 generation" },
  { id: "batch", label: "Batch", hint: "Persistent queue" },
  { id: "gallery", label: "Gallery", hint: "Outputs & metadata" },
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
      return <GalleryView />;
    case "system":
      return <SystemView />;
    case "ltx":
      return (
        <PlaceholderView
          eyebrow="Lightricks"
          title="LTX 2.5"
          description="LTX remains a first-class workspace. The new page will expose the current official workflows and model preparation controls through typed adapters."
          items={["Text / image to video", "Two-stage upscale", "Audio-to-video", "IC-LoRA workflows"]}
        />
      );
    case "music":
      return (
        <PlaceholderView
          eyebrow="MiniMax"
          title="Music 3"
          description="Music 3 keeps its dedicated generation surface rather than being squeezed into H3 Create."
          items={["Caption & lyrics", "Prompt enhancement", "Duration / CFG / Top-K", "Audio preview & download"]}
        />
      );
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
