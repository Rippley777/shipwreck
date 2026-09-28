import { randomUUID } from "node:crypto";
import { query } from "./db";
import { encrypt, decrypt } from "./auth";
import {
  exchangeAppToken,
  githubAppConfig,
  type AppOAuthToken,
} from "./github-app-config";
import { githubAppClient } from "./github-app-client";
export type AppConnection = {
  user_id: string;
  app_id: string;
  login: string;
  github_user_id: string;
  encrypted_token: string;
  encrypted_refresh_token: string | null;
  expires_at: string | null;
  refresh_expires_at: string | null;
  refresh_lock_token?: string | null;
  refresh_lock_until?: string | null;
};
export async function appConnection(userId: string) {
  return (
    (
      await query<AppConnection>(
        "SELECT * FROM github_app_connections WHERE user_id=$1",
        [userId],
      )
    )[0] ?? null
  );
}
export async function saveAppConnection(
  userId: string,
  profile: { id: number; login: string },
  token: AppOAuthToken,
) {
  const config = githubAppConfig();
  const linked = await query<{ id: string }>(
    "SELECT id FROM users WHERE github_id=$1 AND id<>$2",
    [String(profile.id), userId],
  );
  const owner = await query<{ github_id: string | null }>(
    "SELECT github_id FROM users WHERE id=$1",
    [userId],
  );
  if (
    linked.length ||
    (owner[0]?.github_id && owner[0].github_id !== String(profile.id))
  )
    throw new Error(
      "Connect the GitHub account already linked to your Shipwreck account.",
    );
  const updated = await query(
    "UPDATE users SET github_id=$1 WHERE id=$2 AND (github_id IS NULL OR github_id=$1) RETURNING id",
    [String(profile.id), userId],
  );
  if (!updated.length)
    throw new Error(
      "The GitHub account linked to this workspace changed. Try reconnecting.",
    );
  await query(
    `INSERT INTO github_app_connections(user_id,app_id,github_user_id,login,encrypted_token,encrypted_refresh_token,expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id) DO UPDATE SET app_id=$2,github_user_id=$3,login=$4,encrypted_token=$5,encrypted_refresh_token=$6,expires_at=$7,refresh_expires_at=$8,refresh_lock_token=NULL,refresh_lock_until=NULL,connected_at=NOW()`,
    [
      userId,
      config.id,
      String(profile.id),
      profile.login,
      encrypt(token.access_token),
      token.refresh_token ? encrypt(token.refresh_token) : null,
      token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      token.refresh_token_expires_in
        ? new Date(Date.now() + token.refresh_token_expires_in * 1000)
        : null,
    ],
  );
}
export type ConnectionStore = {
  get: (userId: string) => Promise<AppConnection | null>;
  claim: (userId: string, lock: string) => Promise<boolean>;
  finish: (
    userId: string,
    lock: string,
    token: AppOAuthToken,
  ) => Promise<boolean>;
  release: (userId: string, lock: string) => Promise<void>;
};
const databaseStore: ConnectionStore = {
  get: appConnection,
  async claim(userId, lock) {
    return (
      (
        await query(
          `UPDATE github_app_connections SET refresh_lock_token=$2,refresh_lock_until=NOW()+INTERVAL '45 seconds' WHERE user_id=$1 AND (refresh_lock_until IS NULL OR refresh_lock_until<NOW()) RETURNING user_id`,
          [userId, lock],
        )
      ).length > 0
    );
  },
  async finish(userId, lock, token) {
    return (
      (
        await query(
          `UPDATE github_app_connections SET encrypted_token=$3,encrypted_refresh_token=$4,expires_at=$5,refresh_expires_at=$6,refresh_lock_token=NULL,refresh_lock_until=NULL WHERE user_id=$1 AND refresh_lock_token=$2 RETURNING user_id`,
          [
            userId,
            lock,
            encrypt(token.access_token),
            token.refresh_token ? encrypt(token.refresh_token) : null,
            token.expires_in
              ? new Date(Date.now() + token.expires_in * 1000)
              : null,
            token.refresh_token_expires_in
              ? new Date(Date.now() + token.refresh_token_expires_in * 1000)
              : null,
          ],
        )
      ).length > 0
    );
  },
  async release(userId, lock) {
    await query(
      "UPDATE github_app_connections SET refresh_lock_token=NULL,refresh_lock_until=NULL WHERE user_id=$1 AND refresh_lock_token=$2",
      [userId, lock],
    );
  },
};
export async function appUserToken(
  userId: string,
  store: ConnectionStore = databaseStore,
  exchange: typeof exchangeAppToken = exchangeAppToken,
): Promise<string> {
  const current = await store.get(userId);
  if (!current || current.app_id !== githubAppConfig().id)
    throw new Error(
      "Connect the GitHub App in workspace settings to access private repositories.",
    );
  if (
    !current.expires_at ||
    Date.parse(current.expires_at) > Date.now() + 60_000
  )
    return decrypt(current.encrypted_token);
  if (
    !current.encrypted_refresh_token ||
    (current.refresh_expires_at &&
      Date.parse(current.refresh_expires_at) <= Date.now())
  )
    throw new Error(
      "GitHub App authorization expired. Reconnect in workspace settings.",
    );
  const lock = randomUUID();
  if (!(await store.claim(userId, lock)))
    throw new Error(
      "GitHub authorization is being refreshed. Please retry in a moment.",
    );
  try {
    const latest = await store.get(userId);
    if (!latest) throw new Error("GitHub App was disconnected.");
    if (
      !latest.expires_at ||
      Date.parse(latest.expires_at) > Date.now() + 60_000
    )
      return decrypt(latest.encrypted_token);
    if (!latest.encrypted_refresh_token)
      throw new Error(
        "GitHub App authorization expired. Reconnect in workspace settings.",
      );
    const token = await exchange({
      grant_type: "refresh_token",
      refresh_token: decrypt(latest.encrypted_refresh_token),
    });
    if (!(await store.finish(userId, lock, token)))
      throw new Error(
        "GitHub connection changed during renewal. Please reconnect.",
      );
    return token.access_token;
  } finally {
    await store.release(userId, lock);
  }
}
export async function withAppRepository<T>(
  userId: string,
  repository: string,
  installationId: string,
  operation: (token: string) => Promise<T>,
) {
  return githubAppClient.withRepository(
    await appUserToken(userId),
    repository,
    installationId,
    operation,
  );
}
