import { NextResponse, type NextRequest } from "next/server";

import { getEffectiveLiveAvatarContextId } from "@/lib/liveavatar-context";

export const runtime = "nodejs";

type LiveAvatarTokenPayload = {
  mode: "FULL";
  avatar_id: string;
  avatar_persona: {
    language: "en";
    voice_id?: string;
    context_id?: string;
  };
  interactivity_type: "CONVERSATIONAL";
  video_settings: {
    quality: "low";
    encoding: "H264";
  };
  dynamic_variables?: Record<string, string>;
};

type LiveAvatarTokenResponse = {
  data?: {
    session_token?: string;
    session_id?: string;
  };
  error?: string;
  message?: string;
};

export async function POST(req: NextRequest) {
  const apiKey = process.env.LIVEAVATAR_API_KEY ?? "";
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Missing LIVEAVATAR_API_KEY",
        hint: "LiveAvatar API keys are not compatible with HeyGen Streaming Avatar keys.",
        url: "https://app.liveavatar.com/developers",
      },
      { status: 500 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const memberName = typeof body?.memberName === "string" ? body.memberName : undefined;
  const memberRole = typeof body?.memberRole === "string" ? body.memberRole : undefined;

  const avatarId = (process.env.AVATAR_ID ?? "").trim();
  if (!avatarId) {
    return NextResponse.json({ error: "Missing AVATAR_ID (LiveAvatar avatar_id)" }, { status: 500 });
  }

  const voiceId = (process.env.VOICE_ID ?? "").trim();
  const contextId = (await getEffectiveLiveAvatarContextId()).trim();

  const dynamicVariables: Record<string, string> = {};
  if (memberName) dynamicVariables.memberName = memberName;
  if (memberRole) dynamicVariables.memberRole = memberRole;

  const payload: LiveAvatarTokenPayload = {
    mode: "FULL",
    avatar_id: avatarId,
    avatar_persona: {
      language: "en",
      ...(voiceId ? { voice_id: voiceId } : {}),
      ...(contextId ? { context_id: contextId } : {}),
    },
    interactivity_type: "CONVERSATIONAL",
    video_settings: {
      quality: "low",
      encoding: "H264",
    },
    ...(Object.keys(dynamicVariables).length ? { dynamic_variables: dynamicVariables } : {}),
  };

  const res = await fetch("https://api.liveavatar.com/v1/sessions/token", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => ({}))) as LiveAvatarTokenResponse;
  if (!res.ok) {
    return NextResponse.json(
      { error: "LiveAvatar session token request failed", details: json },
      { status: res.status },
    );
  }

  const sessionToken = json?.data?.session_token;
  const sessionId = json?.data?.session_id;
  if (!sessionToken) {
    return NextResponse.json(
      { error: "LiveAvatar token response missing session_token", details: json },
      { status: 500 },
    );
  }

  // Keep a stable shape for the frontend that previously expected { data: { token } }
  return NextResponse.json({
    data: {
      token: sessionToken,
      sessionId,
    },
    raw: json,
  });
}
