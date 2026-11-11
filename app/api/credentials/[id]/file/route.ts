import { withAuth } from "@/lib/auth";
import { readCredentialFile } from "@/lib/credentials";

// The credential's file, for the owning nurse and the admin only (agencies
// see the status only). It opens in the browser, with the type detected at
// upload; `nosniff` and the sandbox policy keep the browser from running
// anything in it, and it is never cached.
export const GET = withAuth<RouteContext<"/api/credentials/[id]/file">>(async (_req, user, ctx) => {
  const { id } = await ctx.params;
  const file = await readCredentialFile(user, id);
  const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, "_");
  return new Response(new Blob([new Uint8Array(file.bytes)]), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.size),
      "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
