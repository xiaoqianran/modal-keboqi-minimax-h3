import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  cancelLtx25,
  generateLtx25,
  ltxInventory,
  prepareAllLtxModels,
  prepareLtxWorkflow,
  studioCatalog,
} from "../api/h3Client";
import type { GenerateUpdate, Ltx25Request } from "../api/types";

function KeyframeInput({
  label,
  file,
  onChange,
  required = false,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  required?: boolean;
}) {
  const [preview, setPreview] = useState("");

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <label className="ltx-keyframe-card">
      <span>{label}{required ? " · required" : ""}</span>
      <div className="ltx-keyframe-preview">
        {preview ? <img src={preview} alt="" /> : <small>No image selected</small>}
      </div>
      <input
        type="file"
        accept="image/*"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      {file && <small className="ltx-file-name">{file.name}</small>}
    </label>
  );
}

export function LtxView() {
  const queryClient = useQueryClient();
  const catalogQuery = useQuery({
    queryKey: ["studio-catalog"],
    queryFn: studioCatalog,
    staleTime: 60_000,
  });
  const inventoryQuery = useQuery({
    queryKey: ["ltx-inventory"],
    queryFn: ltxInventory,
    staleTime: 10_000,
  });

  const catalog = catalogQuery.data?.ltx25;
  const defaults = catalog?.defaults;
  const [initialized, setInitialized] = useState(false);
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<"Text to video" | "Image to video">("Text to video");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [duration, setDuration] = useState(5);
  const [fps, setFps] = useState(24);
  const [width, setWidth] = useState(960);
  const [height, setHeight] = useState(544);
  const [seed, setSeed] = useState(-1);
  const [cfg, setCfg] = useState(1);
  const [sampler, setSampler] = useState("euler_ancestral");
  const [firstImage, setFirstImage] = useState<File | null>(null);
  const [imageStrength, setImageStrength] = useState(.7);
  const [middleImage, setMiddleImage] = useState<File | null>(null);
  const [middleTime, setMiddleTime] = useState(2.5);
  const [middleStrength, setMiddleStrength] = useState(.7);
  const [endImage, setEndImage] = useState<File | null>(null);
  const [endStrength, setEndStrength] = useState(.7);
  const [workflowName, setWorkflowName] = useState("");
  const [workflowStatus, setWorkflowStatus] = useState("");
  const [running, setRunning] = useState(false);
  const [update, setUpdate] = useState<GenerateUpdate>({ outputUrl: "", status: "Ready" });
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!defaults || initialized) return;
    setModel(defaults.model);
    setMode(defaults.mode === "Image to video" ? "Image to video" : "Text to video");
    setDuration(defaults.duration);
    setFps(defaults.fps);
    setWidth(defaults.width);
    setHeight(defaults.height);
    setSeed(defaults.seed);
    setCfg(defaults.cfg);
    setSampler(defaults.sampler);
    setImageStrength(defaults.image_strength);
    setMiddleTime(defaults.middle_time);
    setMiddleStrength(defaults.middle_strength);
    setEndStrength(defaults.end_strength);
    setWorkflowName(catalog?.workflows[0]?.name ?? "");
    setInitialized(true);
  }, [catalog?.workflows, defaults, initialized]);

  const selectedWorkflow = useMemo(
    () => catalog?.workflows.find((workflow) => workflow.name === workflowName) ?? null,
    [catalog?.workflows, workflowName],
  );

  const prepareWorkflowMutation = useMutation({
    mutationFn: prepareLtxWorkflow,
    onSuccess: (data) => {
      setWorkflowStatus(data.status);
      queryClient.setQueryData(["ltx-inventory"], { inventory: data.inventory });
    },
  });
  const prepareAllMutation = useMutation({
    mutationFn: prepareAllLtxModels,
    onSuccess: (data) => {
      setWorkflowStatus(data.status);
      queryClient.setQueryData(["ltx-inventory"], { inventory: data.inventory });
    },
  });

  const generate = async () => {
    if (!prompt.trim() || !model || running) return;
    if (mode === "Image to video" && !firstImage) {
      setError("Image-to-video mode requires a start keyframe.");
      return;
    }
    setError("");
    setRunning(true);
    setUpdate({ outputUrl: "", status: "Submitting LTX-2.5 job" });
    const controller = new AbortController();
    controllerRef.current = controller;

    const request: Ltx25Request = {
      mode,
      model,
      prompt: prompt.trim(),
      negativePrompt: negativePrompt.trim(),
      firstImage: mode === "Image to video" ? firstImage : null,
      duration,
      fps,
      width,
      height,
      seed,
      cfg,
      sampler,
      imageStrength,
      middleImage: mode === "Image to video" ? middleImage : null,
      middleTime,
      middleStrength,
      endImage: mode === "Image to video" ? endImage : null,
      endStrength,
    };

    try {
      const finalUpdate = await generateLtx25(request, setUpdate, controller.signal);
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
      const message = await cancelLtx25();
      setUpdate((current) => ({ ...current, status: message }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const mutationError = prepareWorkflowMutation.error || prepareAllMutation.error;

  return (
    <div className="stack-page">
      <div className="page-grid ltx-grid">
        <section className="panel composer-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">LTX 2.5 distilled</span>
              <h2>Generate video</h2>
            </div>
            <span className="badge">Shared GPU queue</span>
          </div>

          <div className="ltx-top-controls">
            <label>
              <span>Mode</span>
              <select className="select-control studio-inline-control" value={mode} onChange={(event) => setMode(event.target.value as "Text to video" | "Image to video")}>
                <option>Text to video</option>
                <option>Image to video</option>
              </select>
            </label>
            <label>
              <span>Transformer model</span>
              <select className="select-control studio-inline-control" value={model} onChange={(event) => setModel(event.target.value)} disabled={catalogQuery.isLoading}>
                {!model && <option value="">Loading models…</option>}
                {catalog?.models.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
              </select>
            </label>
          </div>

          <label className="field-label" htmlFor="ltx-prompt">Positive prompt</label>
          <textarea id="ltx-prompt" className="prompt-box ltx-prompt-box" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe action chronologically, then setting, camera, lighting, dialogue, sound effects and music…" />
          <label className="field-label ltx-negative-label" htmlFor="ltx-negative">Negative prompt</label>
          <textarea id="ltx-negative" className="prompt-box ltx-negative-box" value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} placeholder="Optional artifacts or qualities to avoid…" />

          {mode === "Image to video" && (
            <div className="ltx-keyframes">
              <KeyframeInput label="Start keyframe" file={firstImage} onChange={setFirstImage} required />
              <KeyframeInput label="Middle keyframe" file={middleImage} onChange={setMiddleImage} />
              <KeyframeInput label="End keyframe" file={endImage} onChange={setEndImage} />
            </div>
          )}

          <div className="studio-control-grid ltx-control-grid">
            <label><span>Seconds</span><input type="number" min={1} max={20} step="0.5" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label>
            <label><span>FPS</span><input type="number" min={1} max={60} value={fps} onChange={(event) => setFps(Number(event.target.value))} /></label>
            <label><span>Width</span><input type="number" value={width} onChange={(event) => setWidth(Number(event.target.value))} /></label>
            <label><span>Height</span><input type="number" value={height} onChange={(event) => setHeight(Number(event.target.value))} /></label>
            <label><span>Seed</span><input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} /></label>
            <label><span>CFG</span><input type="number" min={0} max={3} step="0.05" value={cfg} onChange={(event) => setCfg(Number(event.target.value))} /></label>
            <label>
              <span>Sampler</span>
              <select className="select-control studio-inline-control" value={sampler} onChange={(event) => setSampler(event.target.value)}>
                {['euler_ancestral', 'euler', 'dpmpp_2m', 'dpmpp_2m_sde'].map((choice) => <option key={choice} value={choice}>{choice}</option>)}
              </select>
            </label>
            {mode === "Image to video" && <label><span>Start strength</span><input type="number" min={0} max={1} step="0.05" value={imageStrength} onChange={(event) => setImageStrength(Number(event.target.value))} /></label>}
            {mode === "Image to video" && middleImage && <label><span>Middle time</span><input type="number" min={0.1} max={Math.max(.1, duration - .1)} step="0.1" value={middleTime} onChange={(event) => setMiddleTime(Number(event.target.value))} /></label>}
            {mode === "Image to video" && middleImage && <label><span>Middle strength</span><input type="number" min={0} max={1} step="0.05" value={middleStrength} onChange={(event) => setMiddleStrength(Number(event.target.value))} /></label>}
            {mode === "Image to video" && endImage && <label><span>End strength</span><input type="number" min={0} max={1} step="0.05" value={endStrength} onChange={(event) => setEndStrength(Number(event.target.value))} /></label>}
          </div>

          <div className="button-row">
            <button className="primary-button" disabled={!prompt.trim() || !model || running} onClick={generate}>{running ? "Generating…" : "Generate with LTX 2.5"}</button>
            <button className="secondary-button" disabled={!running} onClick={stop}>Stop</button>
          </div>
          {error && <div className="error-text">{error}</div>}
        </section>

        <section className="panel ltx-preview-panel">
          <div className="section-heading">
            <div><span className="eyebrow">Output</span><h2>Video</h2></div>
            <span className={`connection-pill ${running ? "" : "offline"}`}>{running ? "Working" : "Idle"}</span>
          </div>
          <div className="video-stage ltx-video-stage">
            {update.outputUrl ? <video key={update.outputUrl} src={update.outputUrl} controls preload="metadata" /> : (
              <div className="empty-state"><span className={`status-dot ${running ? "active" : ""}`} /><strong>{running ? "LTX is generating" : "No LTX output yet"}</strong><span>Text-to-video and image keyframes use the same existing ComfyUI pipeline.</span></div>
            )}
          </div>
          <div className="status-card"><div className="status-title">{update.status}</div>{(update.queuePosition !== undefined || update.queueSize !== undefined) && <div className="status-meta">Queue {update.queuePosition !== undefined ? update.queuePosition + 1 : "—"}{update.queueSize !== undefined ? ` / ${update.queueSize}` : ""}</div>}</div>
          {update.outputUrl && <div className="button-row"><a className="primary-button link-button" href={update.outputUrl}>Download video</a></div>}
        </section>
      </div>

      <section className="panel ltx-workflow-panel">
        <div className="section-heading">
          <div><span className="eyebrow">Official workflows</span><h2>Models & workflow inventory</h2></div>
          {inventoryQuery.isFetching && <span className="badge muted">Refreshing</span>}
        </div>
        <div className="ltx-workflow-grid">
          <div>
            <label className="field-label" htmlFor="ltx-workflow">Workflow</label>
            <select id="ltx-workflow" className="select-control" value={workflowName} onChange={(event) => setWorkflowName(event.target.value)}>
              {catalog?.workflows.map((workflow) => <option key={workflow.id} value={workflow.name}>{workflow.name}</option>)}
            </select>
            {selectedWorkflow && <div className="ltx-workflow-detail"><strong>{selectedWorkflow.description}</strong><span>{selectedWorkflow.inputs}</span></div>}
            <div className="button-row ltx-workflow-actions">
              <button className="primary-button" disabled={!workflowName || prepareWorkflowMutation.isPending} onClick={() => prepareWorkflowMutation.mutate(workflowName)}>{prepareWorkflowMutation.isPending ? "Preparing…" : "Download selected models"}</button>
              <button className="secondary-button" disabled={prepareAllMutation.isPending} onClick={() => prepareAllMutation.mutate()}>{prepareAllMutation.isPending ? "Preparing…" : "Download all missing"}</button>
              <button className="secondary-button" onClick={() => inventoryQuery.refetch()}>Refresh inventory</button>
            </div>
            {workflowStatus && <div className="notice compact">{workflowStatus}</div>}
            {mutationError && <div className="error-text">{mutationError instanceof Error ? mutationError.message : String(mutationError)}</div>}
          </div>
          <pre className="diagnostics-output ltx-inventory-output">{inventoryQuery.data?.inventory || "Loading model inventory…"}</pre>
        </div>
      </section>
    </div>
  );
}
