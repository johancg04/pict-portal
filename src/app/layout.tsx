import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pict-Portal — dibuja con una IA, en vivo",
  description:
    "Pictionary multijugador en tiempo real donde una IA juega contigo. Hecho con Portal.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {/* A plain <script> in a manual <head> gets dropped by the App
            Router when a `metadata` export is also present — next/script
            with beforeInteractive is the supported way to run this before
            first paint, so there's no flash of the wrong theme while React
            hydrates. Next.js injects it into the real <head> regardless of
            where it's declared here; declaring it as a direct child of
            <html> (outside <head>/<body>) is invalid HTML and was causing a
            hydration mismatch — it belongs inside <body>. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var s=localStorage.getItem("theme");var t=(s==="light"||s==="dark")?s:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`}
        </Script>
        {children}
      </body>
    </html>
  );
}
