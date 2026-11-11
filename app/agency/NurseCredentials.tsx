"use client";

import { usePolled } from "@/app/components/useLiveShifts";
import { DISPLAY_STATUS_LABELS, displayStatus } from "@/lib/credential-rules";
import type { CredentialStatusDto } from "@/lib/credentials";

const selectCredentials = (body: unknown) => (body as { credentials: CredentialStatusDto[] }).credentials;

/**
 * Every nurse's credential status for an agency (plan.md, Part 4): status
 * and expiry only. Agencies can't open the files.
 */
export function NurseCredentials({ initial, today }: { initial: CredentialStatusDto[]; today: string }) {
  const { data: credentials } = usePolled("/api/credentials", initial, selectCredentials);
  return (
    <section className="section">
      <h2>Nurse credentials</h2>
      <p className="muted hint">Only approved, unexpired credentials let a nurse claim shifts.</p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Nurse</th>
              <th>Expires</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {credentials.map((c) => {
              const status = displayStatus(c, today);
              return (
                <tr key={c.id} data-credential-id={c.id}>
                  <td>
                    {c.nurseName} ({c.nurseId})
                  </td>
                  <td className="nowrap">{c.expiresOn}</td>
                  <td>
                    <span className={`status status-${status}`}>{DISPLAY_STATUS_LABELS[status]}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
