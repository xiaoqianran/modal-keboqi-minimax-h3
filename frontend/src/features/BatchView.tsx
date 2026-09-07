import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  backendUrl,
  batchSnapshot,
  cancelBatch,
  enqueueBatch,
} from "../api/h3Client";

export function BatchView() {
  const queryClient = useQueryClient();
  const [prompts, setPrompts] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  const snapshotQuery = useQuery({
    queryKey: ["batch-snapshot", selectedBatchId],
    queryFn: () => batchSnapshot(selectedBatchId),
    refetchInterval: 1000,
  });

  useEffect(() => {
    const selected = snapshotQuery.data?.selected_batch_id;
    if (selected && selected !== selectedBatchId) {
      setSelectedBatchId(selected);
    }
  }, [snapshotQuery.data?.selected_batch_id, selectedBatchId]);

  const enqueueMutation = useMutation({
    mutationFn: enqueueBatch,
    onSuccess: (data) => {
      setPrompts("");
      setSelectedBatchId(data.selected_batch_id);
      queryClient.setQueryData(["batch-snapshot", data.selected_batch_id], data);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelBatch,
    onSuccess: (data) => {
      setSelectedBatchId(data.selected_batch_id);
      queryClient.setQueryData(["batch-snapshot", data.selected_batch_id], data);
    },
  });

  const promptCount = useMemo(
    () => prompts.split("\n").map((line) => line.trim()).filter(Boolean).length,
    [prompts],
  );

  const data = snapshotQuery.data;
  const mutationError = enqueueMutation.error || cancelMutation.error;

  return (
    <div className="stack-page">
      <div className="page-grid batch-compose-grid">
        <section className="panel composer-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Persistent queue</span>
              <h2>Add a batch</h2>
            </div>
            <span className="badge">{promptCount} prompt{promptCount === 1 ? "" : "s"}</span>
          </div>

          <textarea
            className="prompt-box batch-prompt-box"
            value={prompts}
            onChange={(event) => setPrompts(event.target.value)}
            placeholder={
              "One prompt per line…\nA train arrives at a station at sunset…\nA girl turns toward the platform lights…"
            }
          />
          <div className="button-row">
            <button
              className="primary-button"
              disabled={!promptCount || enqueueMutation.isPending}
              onClick={() => enqueueMutation.mutate(prompts)}
            >
              {enqueueMutation.isPending ? "Adding…" : "Add batch to queue"}
            </button>
          </div>
        </section>

        <section className="panel queue-control-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">GPU lane</span>
              <h2>Queue control</h2>
            </div>
          </div>
          <div className="queue-status-copy">{data?.status || "Connecting to queue…"}</div>
          <label className="field-label" htmlFor="batch-select">Selected batch</label>
          <select
            id="batch-select"
            className="select-control"
            value={selectedBatchId || ""}
            onChange={(event) => setSelectedBatchId(event.target.value || null)}
          >
            <option value="">No batch selected</option>
            {data?.batches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.id} · {batch.status}
              </option>
            ))}
          </select>
          <button
            className="danger-button"
            disabled={!selectedBatchId || cancelMutation.isPending}
            onClick={() => selectedBatchId && cancelMutation.mutate(selectedBatchId)}
          >
            Cancel selected batch
          </button>
          {mutationError && (
            <div className="error-text">
              {mutationError instanceof Error ? mutationError.message : String(mutationError)}
            </div>
          )}
        </section>
      </div>

      <section className="panel table-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">All batches</span>
            <h2>Queue</h2>
          </div>
          {snapshotQuery.isFetching && <span className="badge muted">Refreshing</span>}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Current prompt</th>
              </tr>
            </thead>
            <tbody>
              {data?.batches.length ? data.batches.map((batch) => (
                <tr
                  key={batch.id}
                  className={batch.id === selectedBatchId ? "selected-row" : ""}
                  onClick={() => setSelectedBatchId(batch.id)}
                >
                  <td><code>{batch.id}</code></td>
                  <td><span className={`state-chip state-${batch.status.toLowerCase().replace(/\s+/g, "-")}`}>{batch.status}</span></td>
                  <td>{batch.progress}</td>
                  <td className="truncate-cell">{batch.current_prompt || "—"}</td>
                </tr>
              )) : (
                <tr><td colSpan={4} className="empty-table">No batches yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel table-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Selected batch</span>
            <h2>{selectedBatchId || "Details"}</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Prompt</th>
                <th>Status</th>
                <th>Output</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.length ? data.items.map((item) => (
                <tr key={item.index}>
                  <td>{item.index}</td>
                  <td>{item.prompt}</td>
                  <td>{item.status}</td>
                  <td>
                    {item.output_url ? (
                      <a href={backendUrl(item.output_url)} target="_blank" rel="noreferrer">Open</a>
                    ) : "—"}
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={4} className="empty-table">Select a batch to inspect its prompts.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
