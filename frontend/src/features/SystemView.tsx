import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { backendSource, backendUrl, systemStatus } from "../api/h3Client";
import { compileStudioTrtVae, unloadStudioModels } from "../api/utilityClient";

export function SystemView() {
  const queryClient = useQueryClient();
  const [actionMessage, setActionMessage] = useState("");
  const statusQuery = useQuery({
    queryKey: ["system-status"],
    queryFn: systemStatus,
    refetchInterval: 10_000,
  });

  const unloadMutation = useMutation({
    mutationFn: unloadStudioModels,
    onSuccess: (result) => {
      setActionMessage(result.message);
      queryClient.setQueryData(["system-status"], (current: unknown) => {
        const value = current as { comfyui_url?: string; api_schema_url?: string } | undefined;
        return {
          detail: result.detail,
          comfyui_url: value?.comfyui_url || "/comfyui/",
          api_schema_url: value?.api_schema_url || "/gradio_api/openapi.json",
        };
      });
    },
  });

  const compileMutation = useMutation({
    mutationFn: compileStudioTrtVae,
    onSuccess: (result) => {
      setActionMessage(result.message);
      void statusQuery.refetch();
    },
  });

  const data = statusQuery.data;
  const actionError = unloadMutation.error || compileMutation.error;
  const actionBusy = unloadMutation.isPending || compileMutation.isPending;

  return (
    <div className="stack-page">
      <section className="panel system-hero-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Runtime</span>
            <h2>System</h2>
          </div>
          <span className={`connection-pill ${statusQuery.isError ? "offline" : ""}`}>
            {statusQuery.isLoading ? "Connecting" : statusQuery.isError ? "Unavailable" : "Connected"}
          </span>
        </div>
        <div className="system-links">
          <a href={backendSource()} target="_blank" rel="noreferrer">Open fallback Gradio</a>
          <a href={backendUrl(data?.comfyui_url || "/comfyui/")} target="_blank" rel="noreferrer">Open ComfyUI</a>
          <a href={backendUrl(data?.api_schema_url || "/gradio_api/openapi.json")} target="_blank" rel="noreferrer">API schema</a>
        </div>
      </section>

      <section className="panel system-hero-panel">
        <div className="section-heading">
          <div><span className="eyebrow">Maintenance</span><h2>GPU & decoder tools</h2></div>
          {actionBusy && <span className="badge muted">Working</span>}
        </div>
        <div className="button-row system-maintenance-actions">
          <button className="secondary-button" disabled={actionBusy} onClick={() => unloadMutation.mutate()}>
            {unloadMutation.isPending ? "Unloading…" : "Unload all models / free VRAM"}
          </button>
          <button className="secondary-button" disabled={actionBusy} onClick={() => compileMutation.mutate()}>
            {compileMutation.isPending ? "Compiling…" : "Compile TensorRT VAE"}
          </button>
          <button className="secondary-button" disabled={statusQuery.isFetching} onClick={() => statusQuery.refetch()}>Refresh status</button>
        </div>
        {actionMessage && <div className="notice compact">{actionMessage}</div>}
        {actionError && <div className="error-text">{actionError instanceof Error ? actionError.message : String(actionError)}</div>}
      </section>

      <section className="panel diagnostics-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Backend diagnostics</span>
            <h2>Status detail</h2>
          </div>
          {statusQuery.isFetching && <span className="badge muted">Refreshing</span>}
        </div>
        <pre className="diagnostics-output">
          {statusQuery.isError
            ? statusQuery.error instanceof Error
              ? statusQuery.error.message
              : String(statusQuery.error)
            : data?.detail || "Waiting for backend status…"}
        </pre>
      </section>
    </div>
  );
}
