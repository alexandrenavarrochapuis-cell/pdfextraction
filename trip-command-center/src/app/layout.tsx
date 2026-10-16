import type { Metadata, Viewport } from "next";
import { Nav } from "@/components/Nav";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atlas",
  description: "Travel confirmations turned into one trip timeline, with a brief the evening before.",
  applicationName: "Atlas",
  appleWebApp: { capable: true, title: "Atlas", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/logo.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">
        <div className="h-1 bg-accent" aria-hidden="true" />
        <main className="mx-auto max-w-2xl px-4 pb-28 pt-[max(1rem,env(safe-area-inset-top))]">{children}</main>
        <Nav />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
