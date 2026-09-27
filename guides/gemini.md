
---

## `gemini.md`

```markdown
# Getting a Gemini API key

WoordWise uses Google's Gemini models as its primary AI provider. Getting a
key is free, takes about two minutes, and doesn't require a credit card.

The free tier is generous enough for personal practice. You'll only hit a
limit if you play hundreds of AI rounds per day.

---

## Step by step

### 1. Go to Google AI Studio

Open **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)** in
your browser. Sign in with any Google account.

### 2. Create an API key

Click **Create API key**. If prompted to choose a Google Cloud project:

- If you don't have one, choose **Create new project**. Name it something
  like `WoordWise`.
- If you have one already, you can use it, but see the tip below.

Google will generate the key. It looks like this:

`AIzaSyD... (a long string starting with "AIza")`

### 3. Copy it

Click the copy icon next to the key. **This is the only time the full key is
shown** — if you navigate away, you'll need to create a new one.

### 4. Paste it into WoordWise

1. Open WoordWise.
2. Tap the **✦ AI** button (top-right of the home screen).
3. Paste the key into the **Gemini** row.
4. Tap **Test** to verify. You should see *"Key works."*
5. Tap **Save**. The green dot on the AI button confirms it's stored.

That's it. AI games will now use your Gemini key.

---

## Optional: restrict your key

If you want to be extra careful, you can restrict the key in Google Cloud
Console so it can only be used for the Generative Language API:

1. Open [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials).
2. Find your WoordWise key.
3. Under **API restrictions**, choose **Restrict key** and select
   **Generative Language API** only.
4. Save.

This limits the blast radius if the key ever leaks.

---

## Free tier at a glance

Gemini's free tier is subject to change, but as of early 2026 it includes:

- A generous daily request allowance
- Per-minute rate limits that are fine for interactive apps
- No credit card required

Full details: [ai.google.dev/pricing](https://ai.google.dev/pricing)

---

## Troubleshooting

**"Key rejected (HTTP 400/403)."**
The key was pasted incorrectly, or it was revoked. Generate a fresh key and
paste it again.

**"No usable model available for this key."**
You're on a paid Google Cloud project that doesn't have the Gemini API
enabled. Either enable the API in Cloud Console, or create a new key under
a fresh AI Studio project.

**"The AI took too long to respond."**
Gemini is having a busy moment. WoordWise will automatically fall back to
Groq if you've added a Groq key. Otherwise, wait a minute and try again.

**"Quota exceeded."**
You've hit the daily free limit. Either wait until tomorrow, or add a Groq
key as a second provider.

---

## Removing your key

Open the **✦ AI** settings modal and tap **Remove** next to the Gemini row.
The key is wiped from your browser's local storage immediately.

You can also revoke the key from the Google AI Studio dashboard at any time.