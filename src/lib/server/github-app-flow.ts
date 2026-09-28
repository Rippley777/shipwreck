import { z } from "zod";
import { decrypt } from "./auth";
export const flowSchema = z.object({
  state: z.string().min(32),
  userId: z.string().min(1),
  purpose: z.enum(["install", "authorize"]),
  expiresAt: z.number(),
  verifier: z.string().optional(),
  installationId: z
    .string()
    .regex(/^[1-9]\d*$/)
    .optional(),
});
export type AppFlow = z.infer<typeof flowSchema>;
export function validateAppFlow(
  cookie: string | undefined,
  state: string | null,
  userId: string,
  purpose: AppFlow["purpose"],
): AppFlow {
  if (!cookie || !state)
    throw new Error("Missing GitHub App authorization state.");
  const flow = flowSchema.parse(JSON.parse(decrypt(cookie)));
  if (
    flow.state !== state ||
    flow.userId !== userId ||
    flow.purpose !== purpose ||
    flow.expiresAt <= Date.now()
  )
    throw new Error("Invalid or expired GitHub App authorization state.");
  if (purpose === "authorize" && !flow.verifier)
    throw new Error("Missing PKCE verifier.");
  return flow;
}
