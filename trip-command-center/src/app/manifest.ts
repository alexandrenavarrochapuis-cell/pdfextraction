import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Atlas",
    short_name: "Atlas",
    description: "Atlas, your AI travel agent: trips, bookings, briefs and boarding passes in one place.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3f5f9",
    theme_color: "#f3f5f9",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
