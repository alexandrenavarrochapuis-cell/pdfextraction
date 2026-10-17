import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Header, HeaderBar } from "@/components/Header";
import { Nav, NavBar } from "@/components/Nav";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atlas",
  description: "Atlas, your AI travel agent: plans family and work trips, finds flights, hotels and cars, and keeps every booking in one timeline.",
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
  themeColor: "#f3f5f9",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">
        <Suspense fallback={<HeaderBar path={null} />}>
          <Header />
        </Suspense>
        <main className="mx-auto max-w-2xl px-4 pb-28 pt-3">{children}</main>
        <Suspense fallback={<NavBar path={null} />}>
          <Nav />
        </Suspense>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
