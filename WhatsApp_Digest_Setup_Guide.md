# Getting Your Daily Digest on WhatsApp — Setup Guide

This is the checklist for connecting your daily CEO digest to WhatsApp. You do the steps below yourself (I can't create accounts or hold your API keys — same rule that applied to the Google sign-in setup). Once you've got the pieces marked **"give me this"**, I'll write the code that actually sends the messages.

Budget roughly 30–45 minutes for the account/number steps, then a 1–3 day wait for Meta to approve your business and your message template. None of this costs anything beyond a possible new SIM/number — the messages themselves will cost a fraction of a cent each at your volume (one message a day, to one person).

---

## Important first decision: your phone number

You mentioned you already have a WhatsApp **Business app** account (the regular app on your phone). That's not the same thing as what we need here, and there's a real trade-off:

- **Using your existing WhatsApp Business number directly** means deleting it from the Business app and re-registering it for the API. You'd lose your chat history on that number, and you could no longer use the normal WhatsApp Business app with it (only the automated system could send from it).
- **Using a fresh, separate number** avoids all of that. It can be a spare SIM, a second number from your carrier, or even a virtual number — it just needs to be able to receive one SMS or phone call for verification, once.

**My recommendation: use a fresh number**, purely for this bot. It keeps your existing WhatsApp Business app untouched and avoids losing anything if we ever need to reset or rebuild this integration.

---

## Part 1 — Meta Business Account

1. Go to **business.facebook.com** and sign in with (or create) a Facebook account for Unze Group if you don't already have one for business purposes.
2. If you don't already have a **Meta Business Manager** account for Unze Group, create one there. You'll be asked for the business name, your name, and a business email.
3. Meta may ask to verify your business (name, address, sometimes a registration document). This step can take anywhere from a few minutes to a couple of days.

---

## Part 2 — Create the app and connect WhatsApp

1. Go to **developers.facebook.com**, log in, and click **Create App**.
2. Give it a name (e.g. "Unze Dashboard") and your email.
3. When asked what you want to do, choose **"Connect with customers through WhatsApp"**.
4. It will ask you to link a business portfolio — pick the Unze Group one from Part 1.
5. Click through to **Create app**. It'll land you on a **WhatsApp > Quickstart / API Setup** page.
6. On that page, either pick an existing WhatsApp Business account or click **Create a WhatsApp Business account** — either is fine, this is just the container Meta uses internally.
7. Add your phone number (the fresh one from the decision above) as the sending number and follow the verification steps (usually an SMS or call with a code).

---

## Part 3 — Get a permanent access token

The token you get automatically on the Quickstart page expires quickly — it's only for testing. We need a permanent one. In Meta Business Settings:

1. Go to **business.facebook.com/settings**, then **System users** in the left sidebar.
2. Click **Add**, give it a name (e.g. "Dashboard Bot"), and create it.
3. Select the new system user, click **Assign Assets**.
4. Under your app, toggle on **Manage app** (Full control).
5. Under your WhatsApp account, toggle on **Manage WhatsApp Business accounts** (Full control).
6. Click **Assign assets** to save.
7. Still on that system user, click **Generate token**. Select your app, and tick these three permissions: `whatsapp_business_management`, `whatsapp_business_messaging`, and `business_management`.
8. Click **Generate token** — this is a long string of letters/numbers. **Copy it somewhere safe immediately** (a password manager, not a plain text file) — Meta won't show it to you again.

**→ Give me:** the permanent access token, your WhatsApp phone number ID, and your WhatsApp Business Account ID (both shown on the API Setup page from Part 2). I'll add these as private environment variables in Vercel — never in the code itself, same as your Supabase keys.

---

## Part 4 — Create the message template

Automated messages can't just be free text unless you've messaged the number yourself in the last 24 hours — the first message of the day has to use a pre-approved **template**. In Meta Business Manager, under **WhatsApp Manager > Message Templates**, create a new template with:

- **Category:** Utility (this is for transactional/recurring account notifications, not marketing — it's also the cheapest category)
- **Name:** something like `daily_digest_ready`
- **Body text**, something like:

  > Your daily summary is ready, {{1}}. {{2}} item(s) need your attention today. Tap below to see the full digest.

  (The `{{1}}` and `{{2}}` are placeholders — I'll fill those in each morning with your name and the actual count.)
- **Button:** add a **Quick Reply** button, e.g. labelled "Show me". When you tap it, WhatsApp notifies our system, and that's the trigger to send you the full digest as an ordinary free-form message right after.

Submit it for review. Meta typically approves straightforward utility templates within a day or two, occasionally longer.

**→ Give me:** confirmation once it's approved, and the exact template name.

---

## What happens once all of this is in place

Every morning, the system sends you that short template message. The moment you tap **"Show me"**, it immediately sends the complete digest — same content as your email, task by task, exactly as it is today — as a normal WhatsApp message. If you don't tap it, you still have the email as a fallback, so nothing is lost either way.

---

## If this starts to feel like a lot

Just like the Google sign-in setup, we can pause at any point and pick it back up later — the email digest keeps working the whole time regardless.
