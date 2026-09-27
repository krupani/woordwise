
---

## `TROUBLESHOOTING.md`

```markdown
# Troubleshooting

Common problems and how to fix them. If your issue isn't here, open a
GitHub issue with the details listed at the bottom of this file.

---

## AI games

These affect **Niet / Geen**, **Re-Order**, and **Sentence** — anything that
talks to Gemini or Groq.

### "The AI took too long to respond."

Both providers are slow, rate-limited, or briefly unavailable.

**What to do:**

1. Wait a minute and tap **Retry**.
2. If it happens often, add a second provider key (see `gemini.md` and
   `groq.md`). WoordWise tries one, then the other, then gives up — two
   keys make it much more resilient.
3. If it's persistent, check your internet connection. Both APIs require
   the network.

### "Key rejected (HTTP 400/403)."

The key is invalid, expired, or revoked.

**What to do:**

1. Open the **✦ AI** settings modal.
2. Tap **Test** on the provider row — the error confirms which key is bad.
3. Generate a fresh key in the provider's dashboard.
4. Paste it, tap **Test**, then **Save**.

### "No usable model available for this key."

The key is valid but lacks access to the models WoordWise expects.

- **Gemini:** you're on a Google Cloud project without the Generative
  Language API enabled. Create a fresh key from
  [aistudio.google.com/apikey](https://aistudio.google.com/apikey) under a
  new project.
- **Groq:** Groq retired the model IDs. Update the `models` array in
  `scripts/online.js` — see the Groq console for current model names.

### "Groq error 404: model does not exist or you do not have access."

Groq occasionally retires older model IDs.

**What to do:** open `scripts/online.js`, find the Groq provider's `models`
array, and update it with a currently-listed model. The `gpt-oss` family
(`openai/gpt-oss-20b`, `openai/gpt-oss-120b`) is a safe default as of early
2026.

### "Quota exceeded."

You've hit the free daily limit on that provider.

**What to do:**

- Wait until the quota resets (usually at midnight Pacific time for Gemini).
- Or add a key for the other provider and let the fallback take over.

### The settings modal won't open.

The AI button lives at the top-right, labelled **✦ AI**.

- **If it's missing entirely**, `online.js` didn't load. Check the browser
  console for a red error and confirm the script tag is present.
- **If it appears but doesn't respond**, there's a JavaScript error earlier
  in the page. Open the console and look for the first red error — fix that
  and the button will work.

### The green dot on the AI button isn't showing.

The dot means **at least one provider key is saved**.

- Open the settings modal and confirm a key is present in one of the rows.
- If a key is present but the dot is grey, the key was saved but never
  tested. Tap **Test** to confirm it works, then **Save** again.

### Sentences are repetitive or use the same rule over and over.

The AI sometimes ignores the "spread across N rules" instruction.

**What to do:**

1. In the warm-up modal, unselect rules you don't want.
2. Play again — a fresh session is requested each time.
3. If a session feels stuck, tap **Play again** to regenerate.

Sessions that fail validation are retried once automatically. If both
attempts fail, you'll see an error and can retry.

---

## Sounds

### No sound plays at all.

Check that the following files exist:
`media/sounds/correct.wav`
`media/sounds/incorrect.wav`
`media/sounds/failure.mp3`
`media/sounds/well_tried.mp3`
`media/sounds/success.mp3`


Missing files fail silently — nothing appears in the console.

---

## Still stuck?

Open a GitHub issue with:

1. What you did (exact steps).
2. What happened (full error message if any).
3. What you expected.
4. Your browser and version.
5. A screenshot of the browser console if there's a red error.

For AI issues, mention which provider was in use. **Never paste your API
key** — even partially.