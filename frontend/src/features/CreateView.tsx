import { useRef, useState } from "react";

import {
  cancelDefaultVideo,
  generateDefaultVideo,
} from "../api/h3Client";
import type { GenerateUpdate } from "../api/types";

const SAMPLE_PROMPT =
  "A quiet Japanese station at sunset, warm platform lights, cinematic tracking shot, natural motion, stereo ambience.";

export function CreateView() {
  const [prompt, setPrompt] = useState(SAMPLE_PROMPT);
  const [running, setRunning] = useState(false);
  const [update, setUpdate] = useState<GenerateUpdate>({
    outputUrl: "",
    status: "Ready",
  });
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  const generate = async () => {
    const value = prompt.trim();
    if (!value || running) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setError("");
    setUpdate({ outputUrl: "", status: "Submitting" });

    try {
      const final = await generateDefaultVideo(value, setUpdate, controller.signal);
      setUpdate(final);
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      controllerRef.current = null;
      setRunning(false);
    }
  };

  const stop = async () => {
    controllerRef.current?.abort();
    try {
      const message = await cancelDefaultVideo();
      setUpdate((current) => ({ ...current, status: message }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <div className="page-grid create-grid">
      <section className="panel composer-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">MiniMax H3</span>
            <h2>Create</h2>
          </div>
          <span className="badge">Default video path</span>
        </div>

        <label className="field-label" htmlFor="prompt">
          Prompt
        </label>
        <textarea
          id="prompt"
          className="prompt-box"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe the shot, camera, motion, lighting and audio..."
        />

        <div className="button-row">
          <button className="primary-button" onClick={generate} disabled={running || !prompt.trim()}>
            {running ? "Generating…" : "Generate video"}
          </button>
          <button className="secondary-button" onClick={stop} disabled={!running}>
            Stop
          </button>
        </div>

        <div className="notice compact">
          This first standalone slice intentionally uses the proven <code>/generate_video</code> defaults.
          Advanced H3 controls migrate next without changing this page structure.
        </div>
      </section>

      <section className="panel preview-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Output</span>
            <h2>Preview</h2>
          </div>
          <span className={`status-dot ${running ? "active" : ""}`} />
        </div>

        <div className="video-stage">
          {update.outputUrl ? (
            <video src={update.outputUrl} controls autoPlay playsInline />
          ) : (
            <div className="empty-state">
              <strong>No output yet</strong>
              <span>The generated video appears here without leaving the Studio.</span>
            </div>
          )}
        </div>

        <div className="status-card">
          <div className="status-title">{update.status || "Ready"}</div>
          {(update.queuePosition != null || update.queueSize != null) && (
            <div className="status-meta">
              Queue {update.queuePosition != null ? update.queuePosition + 1 : "–"}
              {update.queueSize != null ? ` / ${update.queueSize}` : ""}
            </div>
          )}
          {error && <div className="error-text">{error}</div>}
        </div>
      </section>
    </div>
  );
}
