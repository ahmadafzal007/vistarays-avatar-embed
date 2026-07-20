import { connectDB, hasMongo } from "./mongodb";
import { SiteSetting } from "./models";

export const LIVEAVATAR_CONTEXT_SETTING_KEY = "liveavatar_context_id";

export function getEnvLiveAvatarContextId(): string {
  return (process.env.CONTEXT_ID ?? "").trim();
}

/** Value saved from the main site's admin panel (empty / missing / no MongoDB means fall back to env). */
export async function getStoredLiveAvatarContextId(): Promise<string | null> {
  if (!hasMongo()) return null;
  try {
    await connectDB();
    const doc = await SiteSetting.findOne({ key: LIVEAVATAR_CONTEXT_SETTING_KEY }).lean();
    const v = doc?.value;
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t || null;
  } catch {
    return null;
  }
}

/** Used for LiveAvatar token: dashboard override wins, then `CONTEXT_ID` env. */
export async function getEffectiveLiveAvatarContextId(): Promise<string> {
  const stored = await getStoredLiveAvatarContextId();
  if (stored) return stored;
  return getEnvLiveAvatarContextId();
}
