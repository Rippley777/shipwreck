"use client";

import { useEffect } from "react";
import { houseEdge } from "@house-edge/analytics";

export function HouseEdgeAnalytics() {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_HOUSE_EDGE_KEY?.trim();
    const endpoint = process.env.NEXT_PUBLIC_HOUSE_EDGE_ENDPOINT?.trim();
    const enabled =
      process.env.NODE_ENV === "production" ||
      process.env.NEXT_PUBLIC_HOUSE_EDGE_TRACK_DEVELOPMENT === "true";
    if (!enabled || !key || !endpoint) return;
    try {
      const url = new URL(endpoint);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return;
    } catch {
      return;
    }

    // Deferring initialization avoids duplicate events during Strict Mode's effect replay.
    const timer = setTimeout(() => {
      houseEdge.init({
        projectKey: process.env.NEXT_PUBLIC_HOUSE_EDGE_PROJECT || "shipwreck",
        key,
        endpoint,
        version: process.env.NEXT_PUBLIC_APP_VERSION,
        respectDoNotTrack: true,
      });
    }, 0);
    return () => {
      clearTimeout(timer);
      houseEdge.destroy();
    };
  }, []);
  return null;
}
