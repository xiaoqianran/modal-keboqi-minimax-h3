import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  cancelMusic3,
  generateMusic3,
  studioCatalog,
} from "../api/h3Client";
import type { GenerateUpdate, Music3Request } from "../api/types";

export function MusicView() {
  const catalogQuery = useQuery({
    queryKey: ["studio-catalog"],
    queryFn: studioCatalog,
    staleTime: 60_000,
  });
  const defaults = catalogQuery.data?.music3.defaults;
  const models = catalogQuery.data?.music3.models ?? [];

  const [initialized, setInitialized] = useState(false);
  const [model, setModel] = useState("");
  const [caption, setCaption] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [duration, setDuration] = useState(120);
  const [seed, setSeed] = useState(-1);
  const [steps, setSteps] = useState(30);
  const [cfg, setCfg] = useState(1.7);
  const [arCfg, setArCfg] = useState(1.7);
  const [topK, setTopK] = useState(50);
  const [tiledDecode, setTiledDecode] = useState(true);
  const [running, setRunning] = useState(false);
  const [update, setUpdate] = useState<GenerateUpdate>({ outputUrl: "", status: "Ready" });
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!defaults || initialized) return;
    setModel(defaults.model);
    setDuration(defaults.duration);
    setSeed(defaults.seed);
    setSteps(defaults.steps);
    setCfg(defaults.cfg);
    setArCfg(defaults.ar_cfg);
    setTopK(defaults.top_k);
    setTiledDecode(defaults.tiled_decode);
    setInitialized(true);
  }, [defaults, initialized]);

  const generate = async () => {
    const trimmed = caption.trim();
    if (!trimmed || !model || running) return;

    setRunning(true);
    setError("");
    setUpdate({ outputUrl: "", status: "Submitting Music 3 job" });
    const controller = new AbortController();
    controllerRef.current = controller;

    const request: Music3Request = {
      model,
      caption: trimmed,
      lyrics: lyrics.trim(),
      duration,
      seed,
      steps,
      cfg,
      arCfg,
      topK,
      tiledDecode,
    };

    try {
      const finalUpdate = await generateMusic3(request, setUpdate, controller.signal);
      setUpdate(finalUpdate);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setRunning(false);
    }
  };

  const stop = async () => {
    controllerRef.current?.abort();
    try {
      const message = await cancelMusic3();
      setUpdate((current) => ({ ...current, status: message }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="page-grid music-grid">
      <section className="panel composer-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">MiniMax Music 3</span>
            <h2>Compose</h2>
          </div>
          <span className="badge">Shared GPU queue</span>
        </div>

        <label className="field-label" htmlFor="music-caption">Caption</label>
        <textarea
          id="music-caption"
          className="prompt-box music-caption-box"
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          placeholder="Cinematic dream-pop with restrained vocals, warm analog synths and a slow emotional rise…"
        />

        <label className="field-label music-lyrics-label" htmlFor="music-lyrics">Lyrics</label>
        <textarea
          id="music-lyrics"
          className="prompt-box music-lyrics-box"
          value={lyrics}
          onChange={(event) => setLyrics(event.target.value)}
          placeholder="Optional lyrics…"
        />

        <div className="studio-control-grid music-control-grid">
          <label>
            <span>Model</span>
            <select
              className="select-control studio-inline-control"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={catalogQuery.isLoading}
            >
              {!model && <option value="">Loading models…</option>}
              {models.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
            </select>
          </label>
          <label>
            <span>Max duration</span>
            <input type="number" min={1} max={300} value={duration} onChange={(event) => setDuration(Number(event.target.value))} />
          </label>
          <label>
            <span>Seed</span>
            <input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} />
          </label>
          <label>
            <span>Steps</span>
            <input type="number" min={1} max={100} value={steps} onChange={(event) => setSteps(Number(event.target.value))} />
          </label>
          <label>
            <span>CFG</span>
            <input type="number" step="0.1" min={0} max={100} value={cfg} onChange={(event) => setCfg(Number(event.target.value))} />
          </label>
          <label>
            <span>AR CFG</span>
            <input type="number" step="0.1" min={0} max={100} value={arCfg} onChange={(event) => setArCfg(Number(event.target.value))} />
          </label>
          <label>
            <span>Top K</span>
            <input type="number" min={1} max={8192} value={topK} onChange={(event) => setTopK(Number(event.target.value))} />
          </label>
          <label className="toggle-control">
            <input type="checkbox" checked={tiledDecode} onChange={(event) => setTiledDecode(event.target.checked)} />
            <span>Tiled decode</span>
          </label>
        </div>

        <div className="button-row">
          <button className="primary-button" disabled={!caption.trim() || !model || running} onClick={generate}>
            {running ? "Generating…" : "Generate music"}
          </button>
          <button className="secondary-button" disabled={!running} onClick={stop}>Stop</button>
        </div>
        {catalogQuery.error && <div className="error-text">{catalogQuery.error instanceof Error ? catalogQuery.error.message : String(catalogQuery.error)}</div>}
        {error && <div className="error-text">{error}</div>}
      </section>

      <section className="panel music-preview-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Output</span>
            <h2>Audio</h2>
          </div>
          <span className={`connection-pill ${running ? "" : "offline"}`}>{running ? "Working" : "Idle"}</span>
        </div>

        <div className="music-stage">
          {update.outputUrl ? (
            <audio key={update.outputUrl} src={update.outputUrl} controls preload="metadata" />
          ) : (
            <div className="empty-state">
              <span className={`status-dot ${running ? "active" : ""}`} />
              <strong>{running ? "Music 3 is generating" : "No audio yet"}</strong>
              <span>The generated track will appear here without leaving the Studio.</span>
            </div>
          )}
        </div>

        <div className="status-card">
          <div className="status-title">{update.status}</div>
          {(update.queuePosition !== undefined || update.queueSize !== undefined) && (
            <div className="status-meta">
              Queue {update.queuePosition !== undefined ? update.queuePosition + 1 : "—"}
              {update.queueSize !== undefined ? ` / ${update.queueSize}` : ""}
            </div>
          )}
        </div>
        {update.outputUrl && (
          <div className="button-row">
            <a className="primary-button link-button" href={update.outputUrl}>Download audio</a>
          </div>
        )}
      </section>
    </div>
  );
}
