import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  cancelGalleryPostprocess,
  deleteGalleryItem,
  emptyGallery,
  gallerySnapshot,
  postprocessGalleryItem,
  studioCatalog,
} from "../api/h3Client";
import type { GalleryItem, GalleryPostprocessUpdate } from "../api/types";

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** index;
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function formatDate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

function family(item: GalleryItem): string {
  const value = item.snapshot?.family;
  return typeof value === "string" && value.trim() ? value : "Generated output";
}

function snapshotJson(item: GalleryItem | null): string {
  if (!item?.snapshot) return "Settings metadata is unavailable for this output.";
  return JSON.stringify(item.snapshot, null, 2);
}

export function GalleryView() {
  const queryClient = useQueryClient();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const catalogQuery = useQuery({ queryKey: ["studio-catalog"], queryFn: studioCatalog, staleTime: 60_000 });
  const galleryCatalog = catalogQuery.data?.gallery;

  const galleryQuery = useQuery({
    queryKey: ["gallery"],
    queryFn: gallerySnapshot,
    refetchInterval: 5000,
  });

  const [postOption, setPostOption] = useState("None");
  const [postSeed, setPostSeed] = useState(-1);
  const [seedvr2Model, setSeedvr2Model] = useState("");
  const [ltx25Model, setLtx25Model] = useState("");
  const [ltx25Prompt, setLtx25Prompt] = useState("");
  const [forceOffload, setForceOffload] = useState(false);
  const [splitUpscale, setSplitUpscale] = useState(false);
  const [splitSeconds, setSplitSeconds] = useState(5);
  const [upscaleResolution, setUpscaleResolution] = useState("");
  const [postRunning, setPostRunning] = useState(false);
  const [postUpdate, setPostUpdate] = useState<GalleryPostprocessUpdate>({ status: "Ready" });
  const postControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!galleryCatalog) return;
    setPostOption((current) => current === "None" && galleryCatalog.postprocess_options.length ? galleryCatalog.postprocess_options[0] : current);
    setSeedvr2Model((current) => current || galleryCatalog.default_seedvr2_model);
    setLtx25Model((current) => current || galleryCatalog.default_ltx25_model);
    setUpscaleResolution((current) => current || galleryCatalog.default_upscale_resolution);
  }, [galleryCatalog]);

  const deleteMutation = useMutation({
    mutationFn: deleteGalleryItem,
    onSuccess: (data) => {
      queryClient.setQueryData(["gallery"], data);
      setSelectedPath((current) =>
        current && data.items.some((item) => item.path === current)
          ? current
          : data.items[0]?.path ?? null,
      );
    },
  });

  const emptyMutation = useMutation({
    mutationFn: emptyGallery,
    onSuccess: (data) => {
      queryClient.setQueryData(["gallery"], data);
      setSelectedPath(null);
    },
  });

  const items = galleryQuery.data?.items ?? [];
  const selected = useMemo(
    () => items.find((item) => item.path === selectedPath) ?? items[0] ?? null,
    [items, selectedPath],
  );

  useEffect(() => {
    if (!selectedPath && items[0]) {
      setSelectedPath(items[0].path);
      return;
    }
    if (selectedPath && !items.some((item) => item.path === selectedPath)) {
      setSelectedPath(items[0]?.path ?? null);
    }
  }, [items, selectedPath]);

  const mutationError = deleteMutation.error || emptyMutation.error;
  const message = deleteMutation.data?.message || emptyMutation.data?.message || galleryQuery.data?.message;
  const isAiPost = Boolean(galleryCatalog?.ai_postprocess_options.includes(postOption));
  const isSeedVr = postOption === galleryCatalog?.seedvr2_option;
  const isLtx = postOption === galleryCatalog?.ltx25_option;

  const removeSelected = () => {
    if (!selected) return;
    if (!window.confirm(`Permanently delete ${selected.name}?`)) return;
    deleteMutation.mutate(selected.path);
  };

  const removeAll = () => {
    if (!items.length) return;
    if (!window.confirm(`Permanently delete all ${items.length} generated videos?`)) return;
    emptyMutation.mutate();
  };

  const runPostprocess = async () => {
    if (!selected || !galleryCatalog || postRunning || postOption === "None") return;
    const controller = new AbortController();
    postControllerRef.current = controller;
    setPostRunning(true);
    setPostUpdate({ status: `Submitting ${postOption}` });
    try {
      const result = await postprocessGalleryItem({
        selectedPath: selected.path,
        option: postOption,
        seed: postSeed,
        seedvr2Model,
        ltx25Model,
        ltx25Prompt,
        forceOffload,
        splitUpscale,
        splitSeconds,
        upscaleResolution,
      }, setPostUpdate, controller.signal);
      const refreshed = await galleryQuery.refetch();
      if (result.selected_path && refreshed.data?.items.some((item) => item.path === result.selected_path)) {
        setSelectedPath(result.selected_path);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setPostUpdate({ status: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      if (postControllerRef.current === controller) postControllerRef.current = null;
      setPostRunning(false);
    }
  };

  const stopPostprocess = async () => {
    postControllerRef.current?.abort();
    try {
      const message = await cancelGalleryPostprocess();
      setPostUpdate((current) => ({ ...current, status: message }));
    } catch (cause) {
      setPostUpdate((current) => ({ ...current, status: cause instanceof Error ? cause.message : String(cause) }));
    }
  };

  return (
    <div className="stack-page">
      <section className="panel gallery-toolbar-panel">
        <div className="section-heading gallery-heading-row">
          <div><span className="eyebrow">Output workspace</span><h2>Generated videos</h2></div>
          <div className="gallery-toolbar-actions">
            <span className="badge">{items.length} output{items.length === 1 ? "" : "s"}</span>
            <button className="secondary-button" disabled={galleryQuery.isFetching} onClick={() => galleryQuery.refetch()}>{galleryQuery.isFetching ? "Refreshing…" : "Refresh"}</button>
            <button className="danger-button gallery-empty-button" disabled={!items.length || emptyMutation.isPending || postRunning} onClick={removeAll}>Empty gallery</button>
          </div>
        </div>
        <p className="gallery-intro">This is the same managed output store used by Gradio. Refreshing, post-processing, or deleting here operates on the same files; the React frontend does not create a second media library.</p>
        {message && <div className="notice compact">{message}</div>}
        {mutationError && <div className="error-text">{mutationError instanceof Error ? mutationError.message : String(mutationError)}</div>}
      </section>

      <div className="gallery-workspace-grid">
        <section className="panel gallery-browser-panel">
          <div className="section-heading"><div><span className="eyebrow">Newest first</span><h2>Library</h2></div></div>
          <div className="gallery-list" role="listbox" aria-label="Generated videos">
            {galleryQuery.isLoading ? (
              <div className="empty-state gallery-list-empty"><strong>Loading outputs…</strong><span>Reading the existing managed Gallery from the H3 backend.</span></div>
            ) : items.length ? items.map((item) => (
              <button type="button" role="option" aria-selected={selected?.path === item.path} key={item.path} className={`gallery-list-item ${selected?.path === item.path ? "active" : ""}`} onClick={() => setSelectedPath(item.path)}>
                <span className="gallery-list-icon">▶</span>
                <span className="gallery-list-copy"><strong>{item.name}</strong><span>{family(item)}</span><small>{formatDate(item.modified_at)} · {formatBytes(item.size_bytes)}</small></span>
              </button>
            )) : (
              <div className="empty-state gallery-list-empty"><strong>No generated videos yet</strong><span>Create a video or finish a batch and it will appear here automatically.</span></div>
            )}
          </div>
        </section>

        <section className="panel gallery-preview-panel">
          <div className="section-heading">
            <div><span className="eyebrow">Selected output</span><h2>{selected?.name ?? "Preview"}</h2></div>
            {selected && <span className="badge muted">{family(selected)}</span>}
          </div>
          <div className="video-stage gallery-video-stage">
            {selected ? <video key={selected.preview_url} src={selected.preview_url} controls preload="metadata" /> : (
              <div className="empty-state"><span className="status-dot" /><strong>Select an output</strong><span>The player, download action and exact generation metadata will appear here.</span></div>
            )}
          </div>
          {selected && (
            <>
              <div className="gallery-selected-meta">
                <div><span>Modified</span><strong>{formatDate(selected.modified_at)}</strong></div>
                <div><span>Size</span><strong>{formatBytes(selected.size_bytes)}</strong></div>
                <div><span>Family</span><strong>{family(selected)}</strong></div>
              </div>
              <div className="button-row">
                <a className="primary-button link-button" href={selected.download_url}>Download video</a>
                <button className="danger-button gallery-delete-button" disabled={deleteMutation.isPending || postRunning} onClick={removeSelected}>{deleteMutation.isPending ? "Deleting…" : "Delete output"}</button>
              </div>
            </>
          )}
        </section>
      </div>

      <section className="panel gallery-post-panel">
        <div className="section-heading">
          <div><span className="eyebrow">Finishing</span><h2>Post-process selected video</h2></div>
          <span className={`connection-pill ${postRunning ? "" : "offline"}`}>{postRunning ? "Working" : "Idle"}</span>
        </div>
        <div className="tool-control-grid gallery-post-grid">
          <label><span>Method</span><select value={postOption} onChange={(event) => setPostOption(event.target.value)}>{galleryCatalog?.postprocess_options.map((choice) => <option key={choice}>{choice}</option>)}</select></label>
          <label><span>Seed</span><input type="number" value={postSeed} onChange={(event) => setPostSeed(Number(event.target.value))} /></label>
          {isAiPost && <label><span>Output resolution</span><select value={upscaleResolution} onChange={(event) => setUpscaleResolution(event.target.value)}>{galleryCatalog?.upscale_resolutions.map((choice) => <option key={choice}>{choice}</option>)}</select></label>}
          {isSeedVr && <label><span>SeedVR2 model</span><select value={seedvr2Model} onChange={(event) => setSeedvr2Model(event.target.value)}>{galleryCatalog?.seedvr2_models.map((choice) => <option key={choice}>{choice}</option>)}</select></label>}
          {isLtx && <label><span>LTX model</span><select value={ltx25Model} onChange={(event) => setLtx25Model(event.target.value)}>{galleryCatalog?.ltx25_models.map((choice) => <option key={choice}>{choice}</option>)}</select></label>}
          {isAiPost && <label className="toggle-control"><input type="checkbox" checked={forceOffload} onChange={(event) => setForceOffload(event.target.checked)} /><span>Unload resident models first</span></label>}
          {isLtx && <label className="toggle-control"><input type="checkbox" checked={splitUpscale} onChange={(event) => setSplitUpscale(event.target.checked)} /><span>Split source into clips</span></label>}
          {isLtx && splitUpscale && <label><span>Clip seconds</span><input type="number" min={1} max={15} step="0.5" value={splitSeconds} onChange={(event) => setSplitSeconds(Number(event.target.value))} /></label>}
        </div>
        {isLtx && <label className="field-label gallery-post-prompt"><span>LTX upscale prompt</span><textarea className="prompt-box ltx-negative-box" value={ltx25Prompt} onChange={(event) => setLtx25Prompt(event.target.value)} placeholder="Optional guidance for LTX 2.5 upscale…" /></label>}
        <div className="button-row">
          <button className="primary-button" disabled={!selected || !postOption || postOption === "None" || postRunning} onClick={runPostprocess}>{postRunning ? "Processing…" : "Run post-process"}</button>
          <button className="secondary-button" disabled={!postRunning} onClick={stopPostprocess}>Stop</button>
        </div>
        <div className="status-card"><div className="status-title">{postUpdate.status}</div>{(postUpdate.queuePosition !== undefined || postUpdate.queueSize !== undefined) && <div className="status-meta">Queue {postUpdate.queuePosition !== undefined ? postUpdate.queuePosition + 1 : "—"}{postUpdate.queueSize !== undefined ? ` / ${postUpdate.queueSize}` : ""}</div>}</div>
      </section>

      <section className="panel diagnostics-panel">
        <div className="section-heading"><div><span className="eyebrow">Provenance</span><h2>Settings used</h2></div><span className="badge muted">Credential-free snapshot</span></div>
        <pre className="diagnostics-output gallery-settings-output">{snapshotJson(selected)}</pre>
      </section>
    </div>
  );
}
