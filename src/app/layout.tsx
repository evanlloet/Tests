import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/outfit";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Léa", template: "%s · Léa" },
  description: "Pilotage commercial, référentiel pharmacies et optimisation de tournées.",
  applicationName: "Léa",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1eef8" },
    { media: "(prefers-color-scheme: dark)", color: "#121020" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("lea_theme")?.value;
  const dataTheme = theme === "light" || theme === "dark" ? theme : undefined;
  return (
    <html lang="fr" data-theme={dataTheme}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
