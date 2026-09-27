# Getting a Groq API key

Groq is WoordWise's automatic fallback provider. If Gemini is busy, slow, or
returns an error, the app retries the request against Groq with a different
model (currently the `gpt-oss` family). One key is enough; two keys makes the
app noticeably more resilient.

Getting a Groq key is free and takes about a minute.

---

## Step by step

### 1. Go to the Groq Console

Open **[console.groq.com](https://console.groq.com)** in your browser.

### 2. Sign up

Sign in with Google, GitHub, or an email address. No credit card required.

### 3. Create an API key

Once you're on the dashboard, open the **API Keys** section from the left
sidebar.

Click **Create API Key**. Give it a name like `WoordWise` so you can find it
later.

Groq will show you the key exactly once. It looks like this:
`gsk_... (a long string starting with "gsk_")`


### 4. Copy it immediately

**The key is only displayed once.** Click the copy button before closing the
dialog. If you lose it, you'll need to create a new one.

### 5. Paste it into WoordWise

1. Open WoordWise.
2. Tap the **✦ AI** button (top-right of the home screen).
3. Paste the key into the **Groq** row.
4. Tap **Test** to verify. You should see *"Key works."*
5. Tap **Save**. The green dot on the AI button confirms at least one key is
   stored.

That's it. WoordWise now uses Groq as a fallback whenever Gemini is
unavailable.

---

## How WoordWise uses Groq

Groq is not used for every request. The logic is:

1. Read the last successful provider from local storage.
2. Try that provider first.
3. If it fails, fall back to the other provider.
4. On success, remember whichever provider worked.

So on a typical day, you'll see Gemini handling everything. On days when
Gemini is rate-limited or busy, WoordWise silently switches to Groq. You
won't need to do anything.

---

## Free tier at a glance

Groq's free tier includes rate-limited access to a set of fast open-weight
models, including the `gpt-oss` family. Limits are generous enough for
personal use.

Full details: [console.groq.com/docs/rate-limits](https://console.groq.com/docs/rate-limits)

---

## Troubleshooting

**"Groq error 404: model does not exist or you do not have access."**
Groq occasionally retires older model IDs. WoordWise uses
`openai/gpt-oss-20b` and `openai/gpt-oss-120b` by default. If the whole
family retires, update the `models` array in `scripts/online.js`.

**"Key rejected (HTTP 401/403)."**
The key is wrong or has been deleted. Create a new one.

**"Rate limit exceeded."**
You're hitting Groq's free tier ceiling. Wait a bit — or just rely on
Gemini, since WoordWise tries Gemini first.

---

## Removing your key

Open the **✦ AI** settings modal and tap **Remove** next to the Groq row.
The key is wiped from your browser's local storage immediately.

You can also revoke the key from the Groq Console at any time.