"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveAvatarSession,
  SessionEvent,
  SessionState,
  AgentEventsEnum,
  VoiceChatEvent,
  VoiceChatState,
  SessionDisconnectReason,
} from "@heygen/liveavatar-web-sdk";

interface Props {
  memberName: string;
  memberRole: string;
  autostart?: boolean;
}

type SessionStoppedPayload = {
  stop_reason?: string;
  end_reason?: string;
};

const LIVEAVATAR_API_URL = "https://api.liveavatar.com";

// European ringing tone (400Hz + 450Hz modulation, 0.4s on, 0.2s off, 0.4s on, 2.0s off)
function startRingingAudio(ctx: AudioContext): () => void {
  let timerId: number;

  const scheduleRing = (time: number) => {
    // 1st burst
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain1 = ctx.createGain();

    osc1.frequency.value = 400;
    osc2.frequency.value = 450;

    osc1.connect(gain1);
    osc2.connect(gain1);
    gain1.connect(ctx.destination);

    // Envelope for 1st burst (0 to 0.4s)
    gain1.gain.setValueAtTime(0, time);
    gain1.gain.linearRampToValueAtTime(0.3, time + 0.05);
    gain1.gain.setValueAtTime(0.3, time + 0.35);
    gain1.gain.linearRampToValueAtTime(0, time + 0.4);

    // 2nd burst (0.6s to 1.0s)
    const osc3 = ctx.createOscillator();
    const osc4 = ctx.createOscillator();
    const gain2 = ctx.createGain();

    osc3.frequency.value = 400;
    osc4.frequency.value = 450;

    osc3.connect(gain2);
    osc4.connect(gain2);
    gain2.connect(ctx.destination);

    // Envelope for 2nd burst (0.6s to 1.0s)
    gain2.gain.setValueAtTime(0, time + 0.6);
    gain2.gain.linearRampToValueAtTime(0.3, time + 0.65);
    gain2.gain.setValueAtTime(0.3, time + 0.95);
    gain2.gain.linearRampToValueAtTime(0, time + 1.0);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + 0.4);
    osc2.stop(time + 0.4);

    osc3.start(time + 0.6);
    osc4.start(time + 0.6);
    osc3.stop(time + 1.0);
    osc4.stop(time + 1.0);

    return time + 3.0; // Repeat every 3s
  };

  let nextRingTime = ctx.currentTime + 0.1;

  const playLoop = () => {
    while (nextRingTime < ctx.currentTime + 1.0) {
      nextRingTime = scheduleRing(nextRingTime);
    }
    timerId = window.setTimeout(playLoop, 500);
  };

  playLoop();

  return () => {
    window.clearTimeout(timerId);
  };
}

const useRingtone = (isPlaying: boolean) => {
  useEffect(() => {
    if (!isPlaying) return;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const stopRinging = startRingingAudio(ctx);

    return () => {
      stopRinging();
      ctx.close().catch(() => {});
    };
  }, [isPlaying]);
};

async function stopLiveAvatarSessionByToken(sessionToken: string) {
  if (!sessionToken) return;
  try {
    await fetch(`${LIVEAVATAR_API_URL}/v1/sessions/stop`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/json",
      },
    });
  } catch {
    // Best-effort cleanup.
  }
}

export default function AvatarCallCard({ memberName, memberRole, autostart = true }: Props) {
  const [isCallActive, setIsCallActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [voiceChatState, setVoiceChatState] = useState<VoiceChatState>(VoiceChatState.INACTIVE);
  const [isMicMuted, setIsMicMuted] = useState(true);
  const [isTextEnabled, setIsTextEnabled] = useState(true);
  const [activeTab, setActiveTab] = useState<"talk" | "meeting">("talk");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "avatar"; text: string }[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const avatarRef = useRef<LiveAvatarSession | null>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const startAbortRef = useRef<AbortController | null>(null);
  const startAttemptIdRef = useRef(0);
  const isCallActiveRef = useRef(false);
  const keepAliveIntervalRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<{ role: "user" | "avatar"; text: string }[]>([]);
  const autostartDoneRef = useRef(false);

  useEffect(() => {
    isCallActiveRef.current = isCallActive;
  }, [isCallActive]);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Keep ref in sync so saveConversation can read latest messages without being a dependency
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Handle ringing effect while connecting
  useRingtone(isCallActive && isLoading);

  // Handle saving conversation when closing
  const saveConversation = useCallback(async () => {
    if (messagesRef.current.length === 0) return;
    try {
      await fetch("/api/heygen/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberName,
          messages: messagesRef.current,
        }),
      });
    } catch (e) {
      console.error("Failed to save conversation:", e);
    }
  }, [memberName]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      saveConversation();
      // Best-effort session cleanup without spamming console warnings.
      const session = avatarRef.current;
      const sessionToken = sessionTokenRef.current;

      // Invalidate any in-flight start.
      startAttemptIdRef.current += 1;
      startAbortRef.current?.abort();
      startAbortRef.current = null;

      if (keepAliveIntervalRef.current) {
        window.clearInterval(keepAliveIntervalRef.current);
        keepAliveIntervalRef.current = null;
      }

      avatarRef.current = null;
      sessionTokenRef.current = null;

      if (session) {
        try {
          session.removeAllListeners();
          session.voiceChat.removeAllListeners();
        } catch {}

        // Only call SDK stop when connected; otherwise it warns "Session is not connected".
        if (session.state === SessionState.CONNECTED) {
          session.stop().catch(() => {});
        } else if (sessionToken) {
          stopLiveAvatarSessionByToken(sessionToken);
        }
      } else if (sessionToken) {
        stopLiveAvatarSessionByToken(sessionToken);
      }
    };
  }, [saveConversation]);

  const startAvatar = useCallback(async () => {
    // Cancel any previous start attempt.
    startAttemptIdRef.current += 1;
    const attemptId = startAttemptIdRef.current;
    startAbortRef.current?.abort();
    const abortController = new AbortController();
    startAbortRef.current = abortController;

    setIsLoading(true);
    setIsConnected(false);
    setSessionError(null);
    setVoiceChatState(VoiceChatState.INACTIVE);
    setIsMicMuted(true);
    try {
      const tokenRes = await fetch("/api/heygen/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberName, memberRole }),
        signal: abortController.signal,
      });

      const tokenJson = await tokenRes.json().catch(() => ({}));
      const token = tokenJson?.data?.token ?? "";
      if (!tokenRes.ok || !token) {
        throw new Error(
          tokenJson?.error ||
            tokenJson?.message ||
            `Failed to create LiveAvatar session token (status ${tokenRes.status})`,
        );
      }

      // Session-scoped access token (expected to be used client-side).
      sessionTokenRef.current = token;

      if (abortController.signal.aborted || attemptId !== startAttemptIdRef.current) {
        // We were cancelled before creating the session.
        stopLiveAvatarSessionByToken(token);
        return;
      }

      // Voice chat is started explicitly after connect so the mic is on by default.
      const session = new LiveAvatarSession(token, { voiceChat: false });
      avatarRef.current = session;

      const isStale = () => attemptId !== startAttemptIdRef.current;

      session.on(SessionEvent.SESSION_STATE_CHANGED, (state) => {
        if (isStale()) return;
        if (state === SessionState.CONNECTED) {
          setIsConnected(true);
          setIsLoading(false);

          // Keep-alive to reduce server-side idle reaping during longer chats.
          if (keepAliveIntervalRef.current) {
            window.clearInterval(keepAliveIntervalRef.current);
          }
          keepAliveIntervalRef.current = window.setInterval(() => {
            try {
              if (avatarRef.current?.state === SessionState.CONNECTED) {
                avatarRef.current.keepAlive();
              }
            } catch {}
          }, 20_000);
        }
      });

      session.on(SessionEvent.SESSION_STREAM_READY, () => {
        if (isStale()) return;
        if (videoRef.current) {
          session.attach(videoRef.current);
          const video = videoRef.current;
          video.play().catch(() => {
            // Autoplay with sound can be blocked when the page was never
            // interacted with (e.g. auto-started inside an iframe). Fall back
            // to muted playback and unmute on the first user interaction.
            video.muted = true;
            video.play().catch(() => {});
            const unmute = () => {
              video.muted = false;
              video.play().catch(() => {});
              window.removeEventListener("pointerdown", unmute);
              window.removeEventListener("keydown", unmute);
            };
            window.addEventListener("pointerdown", unmute);
            window.addEventListener("keydown", unmute);
          });
        }
      });

      session.on(SessionEvent.SESSION_DISCONNECTED, (reason) => {
        if (isStale()) return;
        setIsConnected(false);
        setIsLoading(false);
        setVoiceChatState(VoiceChatState.INACTIVE);
        setIsMicMuted(true);

        if (reason && reason !== SessionDisconnectReason.CLIENT_INITIATED) {
          setSessionError(`Session disconnected: ${reason}`);
        }

        if (keepAliveIntervalRef.current) {
          window.clearInterval(keepAliveIntervalRef.current);
          keepAliveIntervalRef.current = null;
        }
      });

      // Transcriptions (chunk events let us append smoothly)
      session.on(AgentEventsEnum.USER_TRANSCRIPTION_CHUNK, (event) => {
        if (isStale()) return;
        const text = event?.text ?? "";
        if (!text) return;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "user") return [...prev.slice(0, -1), { role: "user", text: last.text + text }];
          return [...prev, { role: "user", text }];
        });
      });

      session.on(AgentEventsEnum.AVATAR_TRANSCRIPTION_CHUNK, (event) => {
        if (isStale()) return;
        const text = event?.text ?? "";
        if (!text) return;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "avatar") return [...prev.slice(0, -1), { role: "avatar", text: last.text + text }];
          return [...prev, { role: "avatar", text }];
        });
      });

      session.on(AgentEventsEnum.SESSION_STOPPED, (event) => {
        if (isStale()) return;
        const payload = event as SessionStoppedPayload;
        const stopReason = payload?.stop_reason ?? payload?.end_reason ?? "UNKNOWN";
        setSessionError(`Session ended: ${String(stopReason)}`);
      });

      session.voiceChat.on(VoiceChatEvent.STATE_CHANGED, (state) => {
        if (isStale()) return;
        setVoiceChatState(state);
        if (state === VoiceChatState.INACTIVE) {
          setIsMicMuted(true);
        }
      });

      session.voiceChat.on(VoiceChatEvent.MUTED, () => {
        if (isStale()) return;
        setIsMicMuted(true);
      });
      session.voiceChat.on(VoiceChatEvent.UNMUTED, () => {
        if (isStale()) return;
        setIsMicMuted(false);
      });

      await session.start();

      // Enable the microphone by default once the session is up.
      if (isCallActiveRef.current && !isStale()) {
        try {
          if (session.voiceChat.state === VoiceChatState.INACTIVE) {
            await session.voiceChat.start({ defaultMuted: false });
            try {
              session.startListening();
            } catch {}
          }
        } catch (e) {
          console.warn("Microphone auto-start failed:", e);
        }
      }

      // If the call was ended while starting, clean up immediately.
      if (!isCallActiveRef.current || isStale()) {
        try {
          session.removeAllListeners();
          session.voiceChat.removeAllListeners();
        } catch {}
        if (session.state === SessionState.CONNECTED) {
          await session.stop();
        } else {
          stopLiveAvatarSessionByToken(token);
        }
        return;
      }
    } catch (err) {
      if (abortController.signal.aborted) {
        return;
      }
      console.error("HeyGen avatar error:", err);
      setSessionError(err instanceof Error ? err.message : "Failed to start avatar session");
      setIsLoading(false);
    }
  }, [memberName, memberRole]);

  const stopAvatar = useCallback(async () => {
    // Cancel any in-flight start.
    startAttemptIdRef.current += 1;
    startAbortRef.current?.abort();
    startAbortRef.current = null;

    const session = avatarRef.current;
    const sessionToken = sessionTokenRef.current;

    if (keepAliveIntervalRef.current) {
      window.clearInterval(keepAliveIntervalRef.current);
      keepAliveIntervalRef.current = null;
    }

    avatarRef.current = null;
    sessionTokenRef.current = null;

    if (session) {
      try {
        session.removeAllListeners();
        session.voiceChat.removeAllListeners();
      } catch {}

      // Avoid SDK warning spam when not connected.
      if (session.state === SessionState.CONNECTED) {
        try {
          await session.stop();
        } catch {}
      } else if (sessionToken) {
        await stopLiveAvatarSessionByToken(sessionToken);
      }
    } else if (sessionToken) {
      await stopLiveAvatarSessionByToken(sessionToken);
    }

    if (videoRef.current) {
      // LiveKit attaches tracks to the element; clearing srcObject helps ensure it visually resets.
      videoRef.current.srcObject = null;
      videoRef.current.load?.();
    }
    setIsConnected(false);
    setVoiceChatState(VoiceChatState.INACTIVE);
    setIsMicMuted(true);
    setSessionError(null);
    setMessages([]);
    setInputText("");
    setActiveTab("talk");
  }, []);

  const handleStartCall = useCallback(() => {
    setIsCallActive(true);
    setActiveTab("talk");
    setIsTextEnabled(true);
    startAvatar();
  }, [startAvatar]);

  const handleEndCall = useCallback(() => {
    saveConversation();
    setIsCallActive(false);
    stopAvatar();
  }, [saveConversation, stopAvatar]);

  // Start the call automatically on load (disable with ?autostart=0).
  useEffect(() => {
    if (!autostart || autostartDoneRef.current) return;
    autostartDoneRef.current = true;
    handleStartCall();
  }, [autostart, handleStartCall]);

  useEffect(() => {
    if (!isCallActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleEndCall();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isCallActive, handleEndCall]);

  const sendMessage = useCallback(async () => {
    if (!inputText.trim() || !avatarRef.current) return;
    const text = inputText.trim();
    setInputText("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    try {
      avatarRef.current.message(text);
    } catch (err) {
      console.error("speak error:", err);
    }
  }, [inputText]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const toggleMicrophone = useCallback(() => {
    const session = avatarRef.current;
    if (!session) return;
    if (session.state !== SessionState.CONNECTED) return;

    (async () => {
      try {
        if (session.voiceChat.state === VoiceChatState.INACTIVE) {
          await session.voiceChat.start({ defaultMuted: false });
          try {
            session.startListening();
          } catch {}
        } else {
          session.voiceChat.stop();
          setIsMicMuted(true);
          try {
            session.stopListening();
          } catch {}
        }
      } catch (e) {
        console.warn("Microphone start/stop failed:", e);
      }
    })();
  }, []);

  const toggleTextInput = useCallback(() => {
    setIsTextEnabled((v) => {
      const next = !v;
      if (!next) setInputText("");
      return next;
    });
  }, []);

  const firstName = memberName.split(" ")[0];
  const isIdle = !isLoading && !isConnected;

  return (
    <div className="TeamAvatar-overlay TeamAvatar-overlay--embed" aria-label={`Talk to ${memberName}`}>
      <div className="TeamAvatar-modal">
        <div className="TeamAvatar-header">
          <div className="TeamAvatar-headerInfo">
            <div
              className="TeamAvatar-statusDot"
              style={{
                background: isConnected ? "#22c55e" : isLoading ? "#f59e0b" : "#d1d5db",
              }}
            />
            <div className="TeamAvatar-headerText">
              <div className="TeamAvatar-name">{memberName}</div>
              <div className="TeamAvatar-status">
                {isConnected ? "Live" : isLoading ? "Connecting…" : "AI Avatar"}
              </div>
            </div>
          </div>

          <div className="TeamAvatar-headerActions">
            <button
              type="button"
              onClick={toggleTextInput}
              title={isTextEnabled ? "Hide text input" : "Show text input"}
              className="TeamAvatar-iconBtn"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                <path d="M8 8h8" />
                <path d="M8 12h6" />
              </svg>
            </button>

            <button
              type="button"
              onClick={toggleMicrophone}
              title={voiceChatState === VoiceChatState.INACTIVE ? "Enable microphone" : "Disable microphone"}
              className="TeamAvatar-iconBtn"
              disabled={!isConnected}
              aria-disabled={!isConnected}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {voiceChatState === VoiceChatState.INACTIVE || isMicMuted ? (
                  <>
                    <line x1="1" y1="1" x2="23" y2="23" />
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                  </>
                ) : (
                  <>
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  </>
                )}
              </svg>
            </button>

            <button
              type="button"
              onClick={handleEndCall}
              title="End call"
              className="TeamAvatar-iconBtn"
              disabled={isIdle}
              aria-disabled={isIdle}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="TeamAvatar-grid">
          <div className="TeamAvatar-videoWrap">
            <video ref={videoRef} autoPlay playsInline muted={false} className="TeamAvatar-video" />

            {/* Calling / idle overlay — hidden once the stream is live */}
            <div className={`TeamAvatar-callOverlay ${isConnected ? "is-hidden" : ""}`}>
              <div className="TeamAvatar-ring-container">
                {isLoading && (
                  <>
                    <div className="TeamAvatar-ring"></div>
                    <div className="TeamAvatar-ring"></div>
                  </>
                )}
                {isIdle ? (
                  <button
                    type="button"
                    onClick={handleStartCall}
                    className="TeamAvatar-callAvatar TeamAvatar-callAvatar--btn"
                    aria-label={`Call ${firstName}`}
                  >
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                  </button>
                ) : (
                  <div className="TeamAvatar-callAvatar">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="TeamAvatar-callName">{firstName}</div>
              <div className="TeamAvatar-callStatus">{isLoading ? "Calling" : "Tap to call"}</div>
            </div>
          </div>

          <div className="TeamAvatar-chat">
            <div className="TeamAvatar-tabs" role="tablist" aria-label="Talk or book a meeting">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "talk"}
                className={`TeamAvatar-tabBtn ${activeTab === "talk" ? "is-active" : ""}`}
                onClick={() => setActiveTab("talk")}
              >
                Talk
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "meeting"}
                className={`TeamAvatar-tabBtn ${activeTab === "meeting" ? "is-active" : ""}`}
                onClick={() => setActiveTab("meeting")}
              >
                Book meeting
              </button>
            </div>

            {activeTab === "talk" ? (
              <>
                <div className="TeamAvatar-messages">
                  {sessionError && <div className="TeamAvatar-errorBanner">{sessionError}</div>}

                  {messages.length === 0 ? (
                    <div className="TeamAvatar-emptyHint">
                      {isConnected
                        ? "Use the mic button to speak, or enable text input to type."
                        : isLoading
                          ? "Connecting…"
                          : "Tap the call button to start."}
                    </div>
                  ) : (
                    messages.map((m, i) => (
                      <div key={i} className={`TeamAvatar-msg TeamAvatar-msg--${m.role}`}>
                        {m.text}
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div className="TeamAvatar-inputRow">
                  {isTextEnabled ? (
                    <>
                      <input
                        type="text"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={isConnected ? "Ask a question…" : isLoading ? "Connecting…" : "Start the call first…"}
                        disabled={!isConnected}
                        className="TeamAvatar-input"
                      />
                      <button
                        type="button"
                        onClick={sendMessage}
                        disabled={!isConnected || !inputText.trim()}
                        className="TeamAvatar-sendBtn"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="22" y1="2" x2="11" y2="13" />
                          <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <div className="TeamAvatar-inputHint">
                      Text input is off. Use the chat bubble button to enable it.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="TeamAvatar-meeting">
                <div className="TeamAvatar-meetingHeader">
                  <div className="TeamAvatar-meetingTitle">Book a meeting</div>
                  <a
                    className="TeamAvatar-meetingLink"
                    href="https://calendly.com/michaels-ugfv/meeting-vistarays"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in new tab
                  </a>
                </div>
                <iframe
                  title="Calendly — Meeting with Vistarays"
                  src="https://calendly.com/michaels-ugfv/meeting-vistarays?embed_type=Inline&hide_gdpr_banner=1"
                  className="TeamAvatar-calendlyFrame"
                  frameBorder={0}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
