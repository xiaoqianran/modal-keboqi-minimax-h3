import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { importGalleryVideo } from "../api/utilityClient";

export function GalleryImportPanel() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");

  const mutation = useMutation({
    mutationFn: importGalleryVideo,
    onSuccess: (snapshot) => {
      queryClient.setQueryData(["gallery"], snapshot);
      setMessage(snapshot.message || "Video imported into the managed Gallery.");
      setFile(null);
    },
  });

  return (
    <section className="panel gallery-import-panel">
      <div className="section-heading">
        <div><span className="eyebrow">Import</span><h2>Add local video to Gallery</h2></div>
        <span className="badge muted">Same managed store</span>
      </div>
      <div className="gallery-import-row">
        <label className="gallery-import-file">
          <span>{file?.name || "Choose a local video"}</span>
          <input type="file" accept="video/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <button className="secondary-button" disabled={!file || mutation.isPending} onClick={() => file && mutation.mutate(file)}>
          {mutation.isPending ? "Importing…" : "Import video"}
        </button>
      </div>
      {message && <div className="notice compact">{message}</div>}
      {mutation.error && <div className="error-text">{mutation.error instanceof Error ? mutation.error.message : String(mutation.error)}</div>}
    </section>
  );
}
