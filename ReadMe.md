# WoordWise

> Dutch practice, powered by you.

A free, offline-first web app for practising Dutch at A2 level. No accounts,
no servers, no tracking. Bring your own AI key for the games that need one;
the rest run entirely in your browser.

---

## Overview

WoordWise is a small collection of mini-games that target different parts
of Dutch grammar and vocabulary. Each session is short (10 rounds), with a
progress bar, live score, and gentle feedback. AI-powered games generate
fresh sentences on every playthrough, so you never run out of material.

### What's inside

| Game | What it does | Needs AI? |
|------|--------------|-----------|
| **De / Het** | Swipe a Dutch noun left for `de`, right for `het` | No |
| **Spell It** | Type the Dutch word for a shown English word | No |
| **Match** | Pair English and Dutch words by dragging | No |
| **Conjugate** | Type all forms of a Dutch verb | No |
| **Niet / Geen** | Fill in the blank with `niet` or `geen` in AI-generated sentences | Yes |
| **Re-Order** | Unscramble words to form the correct Dutch sentence | Yes |
| **Sentence** | Read English, type the Dutch translation | Yes |

### What to expect

- **Short sessions.** 10 rounds per game. Play a quick round in a coffee
  break or run several in a row.
- **Instant feedback.** Every answer is checked in the browser; AI games
  fetch a session's worth of material up front.
- **No account, no sign-up.** Open the page and play.
- **Your data stays on your device.** Progress, preferences, and API keys
  live in your browser's local storage. Nothing is uploaded anywhere.

---

## Where to use it

> 🔗 **Live version:** _https://krupani.github.io/woordwise/_

Once GitHub Pages is configured, WoordWise will be usable/installable directly
from the link above — no app store, no account, no build step.

---

### Install it as an app (PWA)

WoordWise is a **Progressive Web App**. That means it runs in the browser
but installs to your home screen like a native app, and keeps working
offline once loaded.

**On Android (Chrome):**
1. Open the live URL in Chrome.
2. Tap the ⋮ menu → **Install app** (or **Add to Home screen**).
3. Confirm. WoordWise appears on your home screen with its own icon.

**On iOS (Safari):**
1. Open the live URL in **Safari** (must be Safari, not Chrome).
2. Tap the **Share** button.
3. Tap **Add to Home Screen**.
4. Confirm. WoordWise appears on your home screen.

**On desktop (Chrome / Edge / Safari):**
1. Open the live URL.
2. Click the **install icon** (⊕) in the address bar.
3. Confirm. WoordWise installs as a standalone window.

## AI integration

Three of the seven games use an AI model to generate fresh Dutch exercises.
The app talks directly to the model provider from your browser using **your
own API key**. There is no intermediary server, no shared key, and no
cost to anyone but you (and the free tiers are more than enough for
personal practice).

### Two providers supported

1. **Google Gemini** — primary provider. Generous free tier.
2. **Groq** — automatic fallback if Gemini is busy or unavailable.

You only need to add **one key**. The app will use whichever is saved and
fall back to the other if the first is unavailable.

### How to get a key

- 📄 **[How to get a Gemini API key →](./gemini.md)**
- 📄 **[How to get a Groq API key →](./groq.md)**

### How to add it

1. Open WoordWise.
2. Tap the **✦ AI** button (top-right of the home screen).
3. Paste your key into the matching provider row.
4. Tap **Test** to verify it works, then **Save**.

That's it. The green dot on the AI button confirms a key is saved. When
you land on an AI game, it just works.

---

## Your keys are safe

This is the most important section in this document. Here is exactly what
happens with your API key.

### Where your key lives

Your key is stored in your browser's **`localStorage`** — a private,
per-origin storage box that belongs to the app's address. On Android, when
the app is wrapped as an APK, that storage is sandboxed by the operating
system, so other apps cannot read it.

### Where your key *never* goes

- ❌ Not to any WoordWise server. There is no WoordWise server.
- ❌ Not to any analytics service. There is no analytics.
- ❌ Not to other websites. Cross-origin reads of `localStorage` are blocked
  by every modern browser.
- ❌ Not into the console. The code never logs the key.
- ❌ Not into the HTML. The key is only held in memory while a request is in
  flight, then discarded.

### Where your key *does* go

Only to the provider you saved it for:

- Gemini keys → `generativelanguage.googleapis.com`
- Groq keys → `api.groq.com`

That's it. Those are the only domains your key is ever sent to, and only
when an AI game makes a request.

### Verify it yourself

The project is open source. You can read every line that touches an API
key:

- `scripts/online.js` — key storage, request signing, provider dispatch.

Search for `localStorage`, `fetch`, and `x-goog-api-key` / `Authorization`
in that file to see exactly what happens.

### Good hygiene

- **Never share your key.** Treat it like a password.
- **Revoke it any time.** If you ever suspect it leaked, delete it from the
  provider's dashboard and generate a new one.
- **Restrict it if you can.** In Google Cloud Console you can restrict a key
  to only the Generative Language API, and to specific referrers. This
  limits the blast radius if it ever leaks.
- **Remove it from the app.** The AI settings modal has a **Remove** button
  that wipes the key from `localStorage`.

---

## Tech stack

- **Vanilla HTML, CSS, and JavaScript.** No build step, no framework, no
  bundler. What you see in the repo is what runs in the browser.
- **No dependencies.** Zero npm packages. Fonts come from Google Fonts via a
  single `<link>`.
- **Capacitor-ready.** The same files can be wrapped into an Android APK
  with a couple of commands (build script coming).
- **ES2017-ish syntax.** Modern enough for any device from 2019 onwards,
  conservative enough to run in Android WebViews.

---

## Troubleshooting


---

## Reporting a bug

Open an issue with:  
- What you did — the exact steps to reproduce.  
- What happened — including the full text of any error message.   
- What you expected.  
- The browser and version (Chrome 121, Safari 17, etc.).  
- A console screenshot if there's a red error.   
- If the bug involves AI, mention which provider was in use. Never paste your. API key — even partially.


---

## Licence

By contributing, you agree that your contribution is licensed under the same MIT licence that covers the rest of the project.

--- 

## Credits

- Fonts: **Fredoka** and **Nunito** via [Google Fonts](https://fonts.google.com/)
- Icons and illustrations: none — the app is pure CSS and Canvas
- Built with ☕ and a healthy respect for `de` / `het`.

---

*WoordWise is an independent project and is not affiliated with Google or
Groq. All trademarks belong to their respective owners.*
