"use client";

import { useRef, useState, type FormEvent } from "react";
import type { Banner } from "@/app/components/NotificationBanner";
import { useCredentialList } from "@/app/components/useCredentialList";
import {
  CREDENTIAL_FILE_TYPES,
  DISPLAY_STATUS_LABELS,
  displayStatus,
  fileSizeProblem,
  formatBytes,
  type CredentialList,
} from "@/lib/credential-rules";
import type { CredentialDto } from "@/lib/credentials";

type Props = { initial: CredentialList<CredentialDto>; onBanner: (banner: Banner) => void };

/**
 * A nurse's credentials and the upload form (plan.md, Part 4). A new upload
 * is pending until the admin approves it; the list polls every 10 s, so an
 * approval shows up without a reload.
 */
export function MyCredentials({ initial, onBanner }: Props) {
  const { credentials, today, upsert } = useCredentialList(initial);
  const fileInput = useRef<HTMLInputElement>(null);
  const [expiresOn, setExpiresOn] = useState("");
  const [uploading, setUploading] = useState(false);

  /**
   * The size is checked here, before sending: Vercel rejects request bodies
   * over 4.5 MB before the route runs, so the nurse would get no message.
   */
  function sizeIsFine(file: File): boolean {
    const problem = fileSizeProblem(file.size);
    if (problem) onBanner({ kind: "error", text: problem });
    return problem === null;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) {
      onBanner({ kind: "error", text: "Choose a file to upload" });
      return;
    }
    if (!sizeIsFine(file)) return;

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("expiresOn", expiresOn);
      const res = await fetch("/api/credentials", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as (CredentialDto & { error?: string }) | null;
      if (res.ok && body) {
        onBanner({ kind: "success", text: "Credential uploaded, pending admin review" });
        upsert(body);
        if (fileInput.current) fileInput.current.value = "";
        setExpiresOn("");
        return;
      }
      onBanner({ kind: "error", text: body?.error ?? "Could not upload the credential, please try again" });
    } catch {
      onBanner({ kind: "error", text: "Network error, please try again" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="section">
      <h2>My credentials</h2>
      <p className="muted hint">Only approved credentials let you claim shifts. A new upload waits for the admin&apos;s review.</p>
      {credentials.length === 0 ? (
        <p className="muted">You haven&apos;t added a credential yet.</p>
      ) : (
        <ul className="shift-list">
          {credentials.map((c) => {
            const status = displayStatus(c, today);
            return (
              <li key={c.id} className="card shift" data-credential-id={c.id}>
                <div>
                  <div>
                    <span className={`status status-${status}`}>{DISPLAY_STATUS_LABELS[status]}</span> Expires{" "}
                    {c.expiresOn}
                  </div>
                  <div className="muted hint">
                    {c.file ? `${c.file.fileName} · ${formatBytes(c.file.size)}` : "On file (no document uploaded)"}
                  </div>
                  {c.rejectionReason && <div className="hint">Reason: {c.rejectionReason}</div>}
                </div>
                {c.file && (
                  <a href={`/api/credentials/${encodeURIComponent(c.id)}/file`} target="_blank" rel="noopener noreferrer">
                    Open file
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form className="card form credential-form" onSubmit={onSubmit}>
        <label>
          Licence or credential document (PDF, PNG or JPEG, up to 4 MB)
          <input
            ref={fileInput}
            type="file"
            name="file"
            required
            accept={CREDENTIAL_FILE_TYPES.join(",")}
            data-testid="credential-upload-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) sizeIsFine(file);
            }}
          />
        </label>
        <label>
          Expiry date
          <input
            type="date"
            name="expiresOn"
            required
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
            data-testid="credential-expiry-date-input"
          />
        </label>
        <button type="submit" disabled={uploading}>
          {uploading ? "Uploading…" : "Upload credential"}
        </button>
      </form>
    </section>
  );
}
