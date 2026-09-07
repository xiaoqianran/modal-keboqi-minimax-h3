import { useQuery } from "@tanstack/react-query";

import { backendSource, systemStatus } from "../api/h3Client";

export function SystemView() {
  const statusQuery = useQuery({
    queryKey: ["system-status"],
    queryFn: systemStatus,
    refetchInterval: 10_000,
  });

  const data = statusQuery.data;
  const backend = backendSource();

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
          <a href={backend} target="_blank" rel="noreferrer">Open fallback Gradio</a>
          <a href={data?.comfyui_url || "/comfyui/"} target="_blank" rel="noreferrer">Open ComfyUI</a>
          <a href={data?.api_schema_url || "/gradio_api/openapi.json"} target="_blank" rel="noreferrer">API schema</a>
        </div>
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
