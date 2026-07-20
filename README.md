# Vistarays Avatar — Embeddable Call Card

A stripped-down, embed-only version of the [vistarays.de-avatars](https://github.com/ahmadafzal007/vistarays.de-avatars) site. The page **is** the avatar call card — the exact same popup from the main site (live video, voice + text chat, Calendly "Book meeting" tab) shown directly, with no screens before it. The call starts automatically when the page loads. Built to be embedded in a Wix site via an iframe.

## Deploy on Vercel

1. Import this repo in [Vercel](https://vercel.com/new).
2. Framework preset: **Next.js** (auto-detected). No build settings needed.
3. Add the environment variables (Project → Settings → Environment Variables). They are **the same variables the main vistarays.de-avatars site uses** — copy the values from that Vercel project's Settings → Environment Variables (there is no `.env` file in the repo; the values live only in Vercel):

| Variable | Required | Description |
| --- | --- | --- |
| `LIVEAVATAR_API_KEY` | ✅ | LiveAvatar API key (<https://app.liveavatar.com/developers>) |
| `AVATAR_ID` | ✅ | LiveAvatar avatar id to call |
| `VOICE_ID` | — | Optional voice override |
| `CONTEXT_ID` | — | Optional LiveAvatar context (persona/knowledge) id |
| `MONGODB_URL` | — | Optional. When set to the **same MongoDB as the main site**, conversation transcripts are saved to the same collection the main site's admin panel reads, and the admin-panel context override is honored. Leave unset and the card still works — transcript saving is simply skipped. |
| `NEXT_PUBLIC_MEMBER_NAME` | — | Name shown on the card (default: `Michael Shlomo Hamelleh`) |
| `NEXT_PUBLIC_MEMBER_ROLE` | — | Role shown on the card (default: `Founder — CEO & Inventor`) |

4. Deploy. Your card now lives at `https://<your-project>.vercel.app`.

## Embed in Wix

In the Wix editor: **Add Elements → Embed Code → Embed HTML** (custom code element) and paste this snippet — the `allow` attribute is required so the microphone and auto-started audio work inside the iframe:

```html
<iframe
  src="https://YOUR-PROJECT.vercel.app"
  style="width:100%;height:100%;border:0;"
  allow="microphone; camera; autoplay; fullscreen; clipboard-write"
  allowfullscreen
></iframe>
```

**Important notes for Wix:**

- **Microphone / audio:** without `allow="microphone; autoplay; …"` the browser blocks the mic and auto-played sound inside the iframe. Wix's simpler "Embed a Site" element does not always pass these permissions — if mic or sound fails, use the "Embed HTML" code element with the snippet above.
- **Size:** the card fills the iframe, so give the element a generous size — at least **≈ 900 × 600 px** on desktop (full-width works great). On mobile Wix typically makes it full-width automatically.
- **Popup flow:** to reproduce the "user clicks, card pops up" experience, put the embed inside a **Wix Lightbox** and open it from any button on your page. The call starts as soon as the lightbox loads the iframe.
- The page sends `Content-Security-Policy: frame-ancestors *`, so Wix (or any site) may frame it.
- **Cost note:** every page load starts a LiveAvatar session (auto-call). If you embed it inline on a busy page rather than in a lightbox, consider `?autostart=0` so a session only starts when the visitor taps the call button.

## URL options (query params)

Append these to the iframe `src`:

| Param | Example | Effect |
| --- | --- | --- |
| `autostart` | `?autostart=0` | Don't auto-start the call — show the card idle with a green "tap to call" button |
| `name` | `?name=Michael` | Override the displayed member name |
| `role` | `?role=Founder` | Override the displayed member role |

Example: `https://YOUR-PROJECT.vercel.app/?autostart=0`

## Local development

```bash
npm install
cp .env.example .env.local   # fill in your keys
npm run dev
```

Open <http://localhost:3000>.

## What was removed vs. the main site

- Admin dashboard, login, and content editing
- Team/"Collective" page, hero, and all marketing sections
- MongoDB requirement (now optional, used only for transcript logging + context override)

The call card itself (video, chat, mic handling, ringtone, Calendly tab) is visually and functionally identical to the main site's `TeamMemberAvatar` popup — `team-avatar.css` is copied verbatim.
