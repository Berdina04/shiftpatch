import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShiftPatch",
  description: "Nursing agencies post shifts, nurses claim them.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
