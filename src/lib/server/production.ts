import { lookup } from "node:dns/promises";
import https from "node:https";
import http from "node:http";
import ipaddr from "ipaddr.js";
import type { Observation } from "../scanner/types";
export function isPublicIP(address: string) {
  try {
    const ip = ipaddr.process(address);
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
export async function inspectURL(input: string): Promise<Observation> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { url: input, headers: {}, cookies: [], error: "Invalid URL." };
  }
  try {
    for (let redirect = 0; redirect < 4; redirect++) {
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        (url.port && !["443", "80"].includes(url.port))
      )
        throw new Error(
          "Only public HTTP(S) URLs on standard ports are supported.",
        );
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const addresses = await Promise.race([
        lookup(hostname, { all: true }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("DNS lookup timed out.")),
            5000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (!addresses.length || addresses.some((a) => !isPublicIP(a.address)))
        throw new Error(
          "Private, local and reserved network targets are blocked.",
        );
      const address = addresses[0];
      const response = await new Promise<{
        status: number;
        headers: http.IncomingHttpHeaders;
      }>((resolve, reject) => {
        const request = (url.protocol === "https:" ? https : http).request(
          url,
          {
            method: "GET",
            family: address.family,
            headers: {
              "User-Agent": "Shipwreck/0.1 readiness-check",
              Accept: "text/html,application/json",
            },
            lookup: (_host, _opts, cb) =>
              cb(null, address.address, address.family),
            timeout: 8000,
          },
          (res) => {
            resolve({ status: res.statusCode ?? 0, headers: res.headers });
            res.destroy();
          },
        );
        request.on("timeout", () =>
          request.destroy(new Error("Request timed out.")),
        );
        request.on("error", reject);
        request.end();
      });
      if (
        [301, 302, 303, 307, 308].includes(response.status) &&
        response.headers.location
      ) {
        url = new URL(response.headers.location, url);
        continue;
      }
      const headers: Record<string, string> = {};
      for (const key of [
        "strict-transport-security",
        "x-content-type-options",
        "content-security-policy",
        "x-frame-options",
      ])
        if (response.headers[key]) headers[key] = String(response.headers[key]);
      return {
        url: url.origin + url.pathname,
        status: response.status,
        headers,
        cookies: (response.headers["set-cookie"] ?? []).map((v) =>
          v.replace(/^[^;]+/, "[redacted]"),
        ),
      };
    }
    throw new Error("Redirect limit reached.");
  } catch (e) {
    return {
      url: url.origin + url.pathname,
      headers: {},
      cookies: [],
      error: e instanceof Error ? e.message : "External inspection failed.",
    };
  }
}
