import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  cancelH3Advanced,
  generateH3Advanced,
  studioCatalog,
} from "../api/h3Client";
import type {
  H3AdvancedRequest,
  H3Catalog,
  H3GenerateUpdate,
} from "../api/types";

const SAMPLE_PROMPT =
  "A quiet Japanese station at sunset, warm platform lights, cinematic tracking shot, natural motion, stereo ambience.";

function initialRequest(catalog: H3Catalog): H3AdvancedRequest {
  const d = catalog.defaults;
  return {
    batchCount: d.batch_count,
    mode: d.mode,
    modelProfile: d.model_profile,
    textEncoder: d.text_encoder,
    stageModelOffload: d.stage_model_offload,
    generationMode: d.generation_mode,
    turboVariant: d.turbo_variant,
    prompt: SAMPLE_PROMPT,
    firstImage: null,
    lastImage: null,
    referenceImages: Array<File | null>(9).fill(null),
    referenceVideos: Array<File | null>(3).fill(null),
    referenceAudios: Array<File | null>(3).fill(null),
    duration: d.duration,
    width: d.width,
    height: d.height,
    steps: d.steps,
    scheduler: d.scheduler,
    seed: d.seed,
    attentionMode: d.attention_mode,
    slaPreset: d.sla_preset,
    solTau: d.sol_tau,
    solThreshType: d.sol_thresh_type,
    solExactMode: d.sol_exact_mode,
    solDenseSteps: d.sol_dense_steps,
    solStepOff: d.sol_step_off,
    solSinkTokens: d.sol_sink_tokens,
    cacheMode: d.cache_mode,
    fbcachePreset: d.fbcache_preset,
    fbcacheThreshold: d.fbcache_threshold,
    fbcacheStart: d.fbcache_start,
    fbcacheEnd: d.fbcache_end,
    fbcacheMaxHits: d.fbcache_max_hits,
    fbcacheTemporalGuard: d.fbcache_temporal_guard,
    easycacheThreshold: d.easycache_threshold,
    easycacheStart: d.easycache_start,
    easycacheEnd: d.easycache_end,
    easycacheVerbose: d.easycache_verbose,
    refImageSize: d.ref_image_size,
    postprocess: d.postprocess,
    reuseUnchangedInputs: d.reuse_unchanged_inputs,
    latentUpscale: d.latent_upscale,
    latentUpscalerModel: d.latent_upscaler_model,
    latentUpscaleRefineSteps: d.latent_upscale_refine_steps,
    latentUpscaleMethod: d.latent_upscale_method,
    latentSplitTileWidth: d.latent_split_tile_width,
    latentSplitTileHeight: d.latent_split_tile_height,
    latentSplitOverlapRatio: d.latent_split_overlap_ratio,
    latentSplitFadeRatio: d.latent_split_fade_ratio,
    latentSplitChunkFrames: d.latent_split_chunk_frames,
    latentSplitTemporalOverlapFrames: d.latent_split_temporal_overlap_frames,
    latentSplitSeamDenoise: d.latent_split_seam_denoise,
    latentSplitSeamPolish: d.latent_split_seam_polish,
    upscaleForceOffload: d.upscale_force_offload,
    upscaleSplitEnabled: d.upscale_split_enabled,
    upscaleSplitSeconds: d.upscale_split_seconds,
    upscaleResolution: d.upscale_resolution,
    seedvr2Model: d.seedvr2_model,
    ltx25Model: d.ltx25_model,
    useInt8Vae: d.use_int8_vae,
    useTrtVae: d.use_trt_vae,
    imageVae: d.image_vae,
    resultFormat: d.result_format,
    imageFrames: d.image_frames,
    semanticBridge: d.semantic_bridge,
    semanticBridgeAlpha: d.semantic_bridge_alpha,
    fl2vaAudios: Array<File | null>(3).fill(null),
  };
}

function SelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="h3-control">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function NumberControl({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="h3-control">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ToggleControl({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="h3-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function MediaSlot({
  label,
  accept,
  file,
  onChange,
  imagePreview = false,
}: {
  label: string;
  accept: string;
  file: File | null;
  onChange: (file: File | null) => void;
  imagePreview?: boolean;
}) {
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!file || !imagePreview) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, imagePreview]);

  return (
    <div className={`h3-media-slot ${file ? "filled" : ""}`}>
      <div className="h3-media-slot-head">
        <span>{label}</span>
        {file && <button type="button" onClick={() => onChange(null)}>Remove</button>}
      </div>
      {preview ? (
        <img src={preview} alt="" />
      ) : (
        <div className="h3-media-placeholder">{file ? file.name : "No file"}</div>
      )}
      <input
        type="file"
        accept={accept}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
    </div>
  );
}

function replaceAt<T>(values: T[], index: number, value: T): T[] {
  const next = [...values];
  next[index] = value;
  return next;
}

function OutputWorkspace({
  update,
  running,
  resultFormat,
}: {
  update: H3GenerateUpdate;
  running: boolean;
  resultFormat: string;
}) {
  return (
    <section className="panel h3-output-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Output</span>
          <h2>{resultFormat}</h2>
        </div>
        <span className={`connection-pill ${running ? "" : "offline"}`}>
          {running ? "Working" : "Idle"}
        </span>
      </div>

      {resultFormat === "Video" && (
        <div className={`h3-video-results ${update.videos.length > 1 ? "multi" : ""}`}>
          {update.videos.length ? update.videos.map((url, index) => (
            <div className="h3-result-card" key={url}>
              <div className="h3-result-label">Video {index + 1}</div>
              <video src={url} controls preload="metadata" />
              <a href={url}>Download</a>
            </div>
          )) : (
            <div className="empty-state h3-output-empty">
              <span className={`status-dot ${running ? "active" : ""}`} />
              <strong>{running ? "H3 is generating" : "No video yet"}</strong>
              <span>Up to four independent-seed variants can appear here.</span>
            </div>
          )}
        </div>
      )}

      {resultFormat === "Image" && (
        <div className="h3-image-results">
          {update.images.length ? update.images.map((url, index) => (
            <a href={url} key={`${url}-${index}`} className="h3-image-card" target="_blank" rel="noreferrer">
              <img src={url} alt={`H3 frame ${index + 1}`} />
              <span>Frame {index + 1}</span>
            </a>
          )) : (
            <div className="empty-state h3-output-empty">
              <strong>{running ? "Decoding image frames…" : "No images yet"}</strong>
              <span>Decoded H3 frames will appear as a selectable visual grid.</span>
            </div>
          )}
        </div>
      )}

      {resultFormat === "Audio" && (
        <div className="h3-audio-stage">
          {update.audioUrl ? <audio src={update.audioUrl} controls preload="metadata" /> : (
            <div className="empty-state">
              <strong>{running ? "Decoding audio…" : "No audio yet"}</strong>
              <span>The native H3 audio result will appear here.</span>
            </div>
          )}
        </div>
      )}

      <div className="status-card h3-status-card">
        <div className="status-title">{update.status || "Ready"}</div>
        {(update.queuePosition != null || update.queueSize != null) && (
          <div className="status-meta">
            Queue {update.queuePosition != null ? update.queuePosition + 1 : "–"}
            {update.queueSize != null ? ` / ${update.queueSize}` : ""}
          </div>
        )}
      </div>
    </section>
  );
}

export function CreateView() {
  const catalogQuery = useQuery({
    queryKey: ["studio-catalog"],
    queryFn: studioCatalog,
    staleTime: 60_000,
  });
  const catalog = catalogQuery.data?.h3;
  const [request, setRequest] = useState<H3AdvancedRequest | null>(null);
  const [running, setRunning] = useState(false);
  const [update, setUpdate] = useState<H3GenerateUpdate>({
    videos: [], images: [], audioUrl: "", status: "Ready",
  });
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (catalog && !request) setRequest(initialRequest(catalog));
  }, [catalog, request]);

  const set = <K extends keyof H3AdvancedRequest>(key: K, value: H3AdvancedRequest[K]) => {
    setRequest((current) => current ? { ...current, [key]: value } : current);
  };

  const referenceCount = useMemo(() => {
    if (!request) return 0;
    return [...request.referenceImages, ...request.referenceVideos, ...request.referenceAudios].filter(Boolean).length;
  }, [request]);

  if (!catalog || !request) {
    return (
      <section className="panel composer-panel">
        <div className="empty-state"><strong>Loading H3 configuration…</strong><span>Reading model, accelerator and output choices from the existing backend.</span></div>
        {catalogQuery.error && <div className="error-text">{catalogQuery.error instanceof Error ? catalogQuery.error.message : String(catalogQuery.error)}</div>}
      </section>
    );
  }

  const choices = catalog.choices;
  const isFirstLast = request.mode === "First / last frame";
  const isReference = request.mode === "Reference media";
  const isVideo = request.resultFormat === "Video";
  const isImage = request.resultFormat === "Image";
  const splitLatent = request.latentUpscaleMethod.toLowerCase().includes("split");
  const usesSol = request.attentionMode === "Sol-Attn" || request.attentionMode === "Auto";
  const usesSla = request.attentionMode === "SLA";
  const usesFbCache = request.cacheMode === "FirstBlockCache";
  const usesEasyCache = request.cacheMode === "EasyCache";
  const postprocessActive = request.postprocess !== "None";
  const ltxPostprocess = request.postprocess.toLowerCase().includes("ltx");

  const validationError = (() => {
    if (!request.prompt.trim()) return "Prompt is required.";
    if (isFirstLast && !request.firstImage && !request.lastImage) return "First / last frame mode needs at least one frame.";
    if (isReference && referenceCount === 0) return "Reference media mode needs at least one image, video, or audio reference.";
    return "";
  })();

  const generate = async () => {
    if (validationError || running) {
      setError(validationError);
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setError("");
    setUpdate({ videos: [], images: [], audioUrl: "", status: "Submitting H3 job" });
    try {
      const final = await generateH3Advanced(request, setUpdate, controller.signal);
      setUpdate(final);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setRunning(false);
    }
  };

  const stop = async () => {
    controllerRef.current?.abort();
    try {
      const message = await cancelH3Advanced();
      setUpdate((current) => ({ ...current, status: message }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const applyResolution = (value: string) => {
    const size = catalog.resolutions.fast[value] || catalog.resolutions.draft[value] || catalog.resolutions.large[value];
    if (!size) return;
    setRequest((current) => current ? { ...current, width: size[0], height: size[1] } : current);
  };

  return (
    <div className="h3-create-shell">
      <div className="page-grid h3-create-grid">
        <section className="panel composer-panel h3-composer-panel">
          <div className="section-heading">
            <div><span className="eyebrow">MiniMax H3</span><h2>Create</h2></div>
            <span className="badge">Advanced API · same runtime</span>
          </div>

          <div className="h3-mode-grid">
            <SelectControl label="Conditioning" value={request.mode} options={choices.modes} onChange={(value) => {
              set("mode", value);
              if (value === "Reference media") set("semanticBridge", false);
            }} />
            <SelectControl label="Result" value={request.resultFormat} options={choices.result_formats} onChange={(value) => set("resultFormat", value)} />
            <SelectControl label="Base model" value={request.modelProfile} options={choices.model_profiles} onChange={(value) => set("modelProfile", value)} />
            <SelectControl label="Generation" value={request.generationMode} options={choices.generation_modes} onChange={(value) => set("generationMode", value)} />
          </div>

          <label className="field-label" htmlFor="h3-prompt">Prompt</label>
          <textarea
            id="h3-prompt"
            className="prompt-box h3-prompt-box"
            value={request.prompt}
            onChange={(event) => set("prompt", event.target.value)}
            placeholder="Describe shots, camera motion, dialogue, ambience, sound effects and music…"
          />

          {isFirstLast && (
            <div className="h3-media-section">
              <div className="h3-subheading"><strong>First / last frames</strong><span>One or both frames may be used.</span></div>
              <div className="h3-media-grid two">
                <MediaSlot label="First frame" accept="image/*" file={request.firstImage} onChange={(file) => set("firstImage", file)} imagePreview />
                <MediaSlot label="Last frame" accept="image/*" file={request.lastImage} onChange={(file) => set("lastImage", file)} imagePreview />
              </div>
              <details className="h3-details compact-details">
                <summary>Optional FL2VA voice references</summary>
                <div className="h3-media-grid three">
                  {request.fl2vaAudios.map((file, index) => (
                    <MediaSlot key={index} label={`Voice ${index + 1} · <Audio ${index + 1}>`} accept="audio/*" file={file} onChange={(next) => set("fl2vaAudios", replaceAt(request.fl2vaAudios, index, next))} />
                  ))}
                </div>
              </details>
            </div>
          )}

          {isReference && (
            <div className="h3-media-section">
              <div className="h3-subheading"><strong>Reference media</strong><span>Use &lt;Picture N&gt;, &lt;Video N&gt;, and &lt;Audio N&gt; tags in the prompt.</span></div>
              <details className="h3-details" open>
                <summary>Reference images · up to 9</summary>
                <div className="h3-media-grid three">
                  {request.referenceImages.map((file, index) => (
                    <MediaSlot key={index} label={`Picture ${index + 1}`} accept="image/*" file={file} onChange={(next) => set("referenceImages", replaceAt(request.referenceImages, index, next))} imagePreview />
                  ))}
                </div>
              </details>
              <details className="h3-details">
                <summary>Reference videos · up to 3</summary>
                <div className="h3-media-grid three">
                  {request.referenceVideos.map((file, index) => (
                    <MediaSlot key={index} label={`Video ${index + 1}`} accept="video/*" file={file} onChange={(next) => set("referenceVideos", replaceAt(request.referenceVideos, index, next))} />
                  ))}
                </div>
              </details>
              <details className="h3-details">
                <summary>Reference audio · up to 3</summary>
                <div className="h3-media-grid three">
                  {request.referenceAudios.map((file, index) => (
                    <MediaSlot key={index} label={`Audio ${index + 1}`} accept="audio/*" file={file} onChange={(next) => set("referenceAudios", replaceAt(request.referenceAudios, index, next))} />
                  ))}
                </div>
              </details>
            </div>
          )}

          <div className="h3-essentials">
            <div className="h3-subheading"><strong>Output essentials</strong><span>Common controls stay visible; everything else is below.</span></div>
            <div className="h3-control-grid">
              <NumberControl label="Seconds" value={request.duration} min={2} max={15} step={0.5} onChange={(value) => set("duration", value)} />
              {isImage && <NumberControl label="Image frames" value={request.imageFrames} min={1} max={20} onChange={(value) => set("imageFrames", value)} />}
              <NumberControl label="Steps" value={request.steps} min={4} max={30} onChange={(value) => set("steps", value)} />
              <NumberControl label="Seed" value={request.seed} onChange={(value) => set("seed", value)} />
              {isVideo && <NumberControl label="Videos" value={request.batchCount} min={1} max={4} onChange={(value) => set("batchCount", Math.min(4, Math.max(1, Math.round(value))))} />}
            </div>
            <div className="h3-resolution-row">
              <label className="h3-control resolution-preset-control">
                <span>Resolution preset</span>
                <select defaultValue="16:9 · 864×480" onChange={(event) => applyResolution(event.target.value)}>
                  <optgroup label="Fast">{Object.keys(catalog.resolutions.fast).map((name) => <option key={name}>{name}</option>)}</optgroup>
                  <optgroup label="Draft">{Object.keys(catalog.resolutions.draft).map((name) => <option key={name}>{name}</option>)}</optgroup>
                  <optgroup label="Large">{Object.keys(catalog.resolutions.large).map((name) => <option key={name}>{name}</option>)}</optgroup>
                </select>
              </label>
              <NumberControl label="Width" value={request.width} onChange={(value) => set("width", value)} />
              <NumberControl label="Height" value={request.height} onChange={(value) => set("height", value)} />
            </div>
          </div>

          <details className="h3-details h3-advanced-section">
            <summary>Model & memory</summary>
            <div className="h3-control-grid">
              <SelectControl label="Text encoder" value={request.textEncoder} options={choices.text_encoders} onChange={(value) => set("textEncoder", value)} />
              {isImage && <SelectControl label="Image VAE" value={request.imageVae} options={choices.image_vaes} onChange={(value) => set("imageVae", value)} />}
              <ToggleControl label="Stage model offload" checked={request.stageModelOffload} onChange={(value) => set("stageModelOffload", value)} />
              <ToggleControl label="Reuse unchanged prompt/media" checked={request.reuseUnchangedInputs} onChange={(value) => set("reuseUnchangedInputs", value)} />
              <ToggleControl label="TensorRT video VAE" checked={request.useTrtVae} onChange={(value) => set("useTrtVae", value)} />
              <ToggleControl label="INT8 ConvRot VAE" checked={request.useInt8Vae} onChange={(value) => set("useInt8Vae", value)} />
              {!isReference && <ToggleControl label="Semantic Bridge" checked={request.semanticBridge} onChange={(value) => set("semanticBridge", value)} />}
              {request.semanticBridge && !isReference && <NumberControl label="Bridge strength" value={request.semanticBridgeAlpha} min={0} max={1} step={0.01} onChange={(value) => set("semanticBridgeAlpha", value)} />}
              {isReference && <SelectControl label="Reference image size" value={request.refImageSize} options={choices.reference_sizes} onChange={(value) => set("refImageSize", value)} />}
            </div>
          </details>

          <details className="h3-details h3-advanced-section">
            <summary>Performance & sampling</summary>
            <div className="h3-control-grid">
              <SelectControl label="Turbo implementation" value={request.turboVariant} options={choices.turbo_variants} onChange={(value) => set("turboVariant", value)} />
              <SelectControl label="Scheduler" value={request.scheduler} options={choices.schedulers} onChange={(value) => set("scheduler", value)} />
              <SelectControl label="Attention" value={request.attentionMode} options={choices.attention_modes} onChange={(value) => set("attentionMode", value)} />
              {usesSla && <SelectControl label="SLA preset" value={request.slaPreset} options={choices.sla_presets} onChange={(value) => set("slaPreset", value)} />}
              {usesSol && <NumberControl label="Sol tau" value={request.solTau} min={0.5} max={1.5} step={0.1} onChange={(value) => set("solTau", value)} />}
              {usesSol && <SelectControl label="Sol threshold" value={request.solThreshType} options={choices.sol_thresholds} onChange={(value) => set("solThreshType", value)} />}
              {usesSol && <SelectControl label="Exact prefix" value={request.solExactMode} options={choices.sol_exact_modes} onChange={(value) => set("solExactMode", value)} />}
              {usesSol && <NumberControl label="Dense final blocks" value={request.solDenseSteps} min={0} max={4} onChange={(value) => set("solDenseSteps", value)} />}
              <SelectControl label="Acceleration" value={request.cacheMode} options={choices.cache_modes} onChange={(value) => set("cacheMode", value)} />
            </div>
            {usesFbCache && (
              <div className="h3-nested-settings">
                <SelectControl label="FirstBlockCache preset" value={request.fbcachePreset} options={choices.fbcache_presets} onChange={(value) => set("fbcachePreset", value)} />
                <NumberControl label="Threshold" value={request.fbcacheThreshold} min={0} max={0.25} step={0.005} onChange={(value) => set("fbcacheThreshold", value)} />
                <NumberControl label="Start" value={request.fbcacheStart} min={0} max={0.9} step={0.01} onChange={(value) => set("fbcacheStart", value)} />
                <NumberControl label="End" value={request.fbcacheEnd} min={0.1} max={1} step={0.01} onChange={(value) => set("fbcacheEnd", value)} />
                <NumberControl label="Max cache hits" value={request.fbcacheMaxHits} min={1} max={8} onChange={(value) => set("fbcacheMaxHits", value)} />
                <ToggleControl label="Temporal frame guard" checked={request.fbcacheTemporalGuard} onChange={(value) => set("fbcacheTemporalGuard", value)} />
              </div>
            )}
            {usesEasyCache && (
              <div className="h3-nested-settings">
                <NumberControl label="EasyCache threshold" value={request.easycacheThreshold} min={0} max={0.5} step={0.01} onChange={(value) => set("easycacheThreshold", value)} />
                <NumberControl label="Start" value={request.easycacheStart} min={0} max={0.9} step={0.01} onChange={(value) => set("easycacheStart", value)} />
                <NumberControl label="End" value={request.easycacheEnd} min={0.1} max={1} step={0.01} onChange={(value) => set("easycacheEnd", value)} />
                <ToggleControl label="Verbose logging" checked={request.easycacheVerbose} onChange={(value) => set("easycacheVerbose", value)} />
              </div>
            )}
          </details>

          <details className="h3-details h3-advanced-section">
            <summary>Upscaling & finishing</summary>
            <div className="h3-control-grid">
              <ToggleControl label="Native latent upscale 2×" checked={request.latentUpscale} onChange={(value) => set("latentUpscale", value)} />
              {request.latentUpscale && <SelectControl label="Latent model" value={request.latentUpscalerModel} options={choices.latent_upscalers} onChange={(value) => set("latentUpscalerModel", value)} />}
              {request.latentUpscale && <NumberControl label="Refine steps" value={request.latentUpscaleRefineSteps} min={1} max={6} onChange={(value) => set("latentUpscaleRefineSteps", value)} />}
              {request.latentUpscale && <SelectControl label="Refinement method" value={request.latentUpscaleMethod} options={choices.latent_upscale_methods} onChange={(value) => set("latentUpscaleMethod", value)} />}
              <SelectControl label="After generation" value={request.postprocess} options={choices.postprocess} onChange={(value) => set("postprocess", value)} />
            </div>

            {request.latentUpscale && splitLatent && (
              <div className="h3-nested-settings split-settings">
                <NumberControl label="Tile width" value={request.latentSplitTileWidth} min={256} max={2048} step={32} onChange={(value) => set("latentSplitTileWidth", value)} />
                <NumberControl label="Tile height" value={request.latentSplitTileHeight} min={256} max={2048} step={32} onChange={(value) => set("latentSplitTileHeight", value)} />
                <NumberControl label="Spatial overlap" value={request.latentSplitOverlapRatio} min={0} max={0.9} step={0.05} onChange={(value) => set("latentSplitOverlapRatio", value)} />
                <NumberControl label="Overlap fade" value={request.latentSplitFadeRatio} min={0} max={1} step={0.05} onChange={(value) => set("latentSplitFadeRatio", value)} />
                <NumberControl label="Chunk frames" value={request.latentSplitChunkFrames} min={5} max={1000} onChange={(value) => set("latentSplitChunkFrames", value)} />
                <NumberControl label="Temporal overlap" value={request.latentSplitTemporalOverlapFrames} min={0} max={240} onChange={(value) => set("latentSplitTemporalOverlapFrames", value)} />
                <NumberControl label="Seam denoise" value={request.latentSplitSeamDenoise} min={0.1} max={1} step={0.05} onChange={(value) => set("latentSplitSeamDenoise", value)} />
                <SelectControl label="Seam polish" value={request.latentSplitSeamPolish} options={choices.seam_polish} onChange={(value) => set("latentSplitSeamPolish", value)} />
              </div>
            )}

            {postprocessActive && (
              <div className="h3-nested-settings">
                <SelectControl label="Output resolution" value={request.upscaleResolution} options={choices.upscale_resolutions} onChange={(value) => set("upscaleResolution", value)} />
                {request.postprocess.toLowerCase().includes("seed") && <SelectControl label="SeedVR2 model" value={request.seedvr2Model} options={choices.seedvr2_models} onChange={(value) => set("seedvr2Model", value)} />}
                {ltxPostprocess && <SelectControl label="LTX model" value={request.ltx25Model} options={choices.ltx25_models} onChange={(value) => set("ltx25Model", value)} />}
                <ToggleControl label="Unload H3 before finishing" checked={request.upscaleForceOffload} onChange={(value) => set("upscaleForceOffload", value)} />
                {ltxPostprocess && <ToggleControl label="Split source into clips" checked={request.upscaleSplitEnabled} onChange={(value) => set("upscaleSplitEnabled", value)} />}
                {ltxPostprocess && request.upscaleSplitEnabled && <NumberControl label="Clip seconds" value={request.upscaleSplitSeconds} min={1} max={15} step={0.5} onChange={(value) => set("upscaleSplitSeconds", value)} />}
              </div>
            )}
          </details>

          <div className="h3-action-bar">
            <div>
              <strong>{request.mode} · {request.resultFormat}</strong>
              <span>{request.width}×{request.height} · {request.steps} steps · {request.generationMode}</span>
            </div>
            <div className="button-row h3-action-buttons">
              <button className="primary-button" onClick={generate} disabled={running || Boolean(validationError)}>{running ? "Generating…" : `Generate ${request.resultFormat.toLowerCase()}`}</button>
              <button className="secondary-button" onClick={stop} disabled={!running}>Stop</button>
            </div>
          </div>
          {validationError && <div className="error-text">{validationError}</div>}
          {error && !validationError && <div className="error-text">{error}</div>}
          <div className="notice compact">Prompt enhancement and pre-generation SeedVR2 input upscaling remain separate tools to migrate next; the generation controls above already call the existing full H3 advanced endpoint.</div>
        </section>

        <OutputWorkspace update={update} running={running} resultFormat={request.resultFormat} />
      </div>
    </div>
  );
}
