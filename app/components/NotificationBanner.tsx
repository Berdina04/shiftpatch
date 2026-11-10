export type Banner = { kind: "success" | "error"; text: string };

/** One test ID for success and error alike; the text tells them apart (spec). */
export function NotificationBanner({ banner }: { banner: Banner | null }) {
  if (!banner) return null;
  return (
    <div
      data-testid="notification-banner"
      role={banner.kind === "error" ? "alert" : "status"}
      className={`banner banner-${banner.kind}`}
    >
      {banner.text}
    </div>
  );
}
