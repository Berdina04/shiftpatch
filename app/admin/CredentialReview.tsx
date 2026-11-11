"use client";

import { useState } from "react";
import type { Banner } from "@/app/components/NotificationBanner";
import { usePolled } from "@/app/components/useLiveShifts";
import { formatBytes, REJECTION_REASON_MAX } from "@/lib/credential-rules";
import type { CredentialDto } from "@/lib/credentials";

const QUEUE_URL = "/api/credentials?status=pending";
const selectCredentials = (body: unknown) => (body as { credentials: CredentialDto[] }).credentials;

type Decision = "approved" | "rejected";

type Props = {
  initial: CredentialDto[];
  onBanner: (banner: Banner) => void;
  /** After a review is saved: the dashboard refreshes, so the audit log shows it. */
  onReviewed: () => void;
};

/**
 * The admin's review queue (plan.md, Part 4): pending uploads, oldest first,
 * polled every 10 s. The admin opens the file, then approves it or rejects it
 * with a reason.
 */
export function CredentialReview({ initial, onBanner, onReviewed }: Props) {
  const { data: queue, refresh, update } = usePolled(QUEUE_URL, initial, selectCredentials);
  const [busy, setBusy] = useState<string | null>(null);

  async function review(credential: CredentialDto, decision: Decision, reason?: string) {
    setBusy(credential.id);
    try {
      const res = await fetch(`/api/credentials/${encodeURIComponent(credential.id)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.ok) {
        onBanner({ kind: "success", text: decision === "approved" ? "Credential approved" : "Credential rejected" });
        update((current) => current.filter((c) => c.id !== credential.id));
        onReviewed();
        return;
      }
      onBanner({ kind: "error", text: body?.error ?? "Could not save the review, please try again" });
      // 409/404: the queue is out of date (another review got there first).
      if (res.status === 409 || res.status === 404) await refresh();
    } catch {
      onBanner({ kind: "error", text: "Network error, please try again" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="section">
      <h2>Credential review</h2>
      <p className="muted hint">Pending uploads, oldest first. Open the file before approving. Times are UTC.</p>
      <div className="table-wrap">
        <table className="table" data-credential-queue>
          <thead>
            <tr>
              <th>Nurse</th>
              <th>Expires</th>
              <th>File</th>
              <th>Uploaded</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {queue.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No credentials waiting for review.
                </td>
              </tr>
            ) : (
              queue.map((c) => (
                <QueueRow key={c.id} credential={c} busy={busy === c.id} disabled={busy !== null} onReview={review} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type RowProps = {
  credential: CredentialDto;
  busy: boolean;
  disabled: boolean;
  onReview: (credential: CredentialDto, decision: Decision, reason?: string) => void;
};

function QueueRow({ credential: c, busy, disabled, onReview }: RowProps) {
  const [reason, setReason] = useState("");
  return (
    <tr data-credential-id={c.id}>
      <td>
        {c.nurseName} ({c.nurseId})
      </td>
      <td className="nowrap">{c.expiresOn}</td>
      <td>
        {c.file ? (
          <a href={`/api/credentials/${encodeURIComponent(c.id)}/file`} target="_blank" rel="noopener noreferrer">
            Open file
          </a>
        ) : (
          "—"
        )}
        {c.file && (
          <div className="muted hint">
            {c.file.fileName} · {formatBytes(c.file.size)}
          </div>
        )}
      </td>
      <td className="nowrap">{c.createdAt.slice(0, 19).replace("T", " ")}</td>
      <td>
        <div className="review-actions">
          <button type="button" disabled={disabled} onClick={() => onReview(c, "approved")}>
            {busy ? "Saving…" : "Approve"}
          </button>
          <input
            aria-label="Rejection reason"
            placeholder="Reason for rejecting"
            maxLength={REJECTION_REASON_MAX}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            type="button"
            className="secondary"
            disabled={disabled || reason.trim() === ""}
            onClick={() => onReview(c, "rejected", reason)}
          >
            Reject
          </button>
        </div>
      </td>
    </tr>
  );
}
