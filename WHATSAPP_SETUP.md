# WhatsApp → Tasks — one-time setup (plain-language guide)

The code is fully deployed; this guide covers the ONE part only you can do:
connecting a WhatsApp Business number through Meta and giving Vercel the keys.
Takes about 20–30 minutes.

## How the feature works once connected

Staff message the company's WhatsApp Business number:

```
@Ali Prepare the June VAT return, due Friday
task for Sania: chase HBL statement by 5 Sep
```

The app checks the sender's phone is mapped to a member with "Can issue
tasks" enabled (Settings → WhatsApp, at /settings/whatsapp), finds the
assignee, creates the task through the same pipeline as the New Task form
(normal notification + My Tasks), and replies with a confirmation. If no due
date is given it asks for one and waits. Send `help` to the number to see
usage. Unknown numbers get told to ask an admin.

## Step 1 — Create the Meta app (free)

1. Go to https://developers.facebook.com → My Apps → Create App.
2. Choose type **Business**, name it e.g. "Unze Dashboard WhatsApp".
3. In the app dashboard, click **Add product** → **WhatsApp** → Set up.
4. Link (or create) your Meta Business account when prompted.

## Step 2 — Get a phone number

- Meta gives you a FREE test number instantly (fine for trying it out —
  limited to 5 recipient numbers you verify by OTP).
- For production, add a real phone number under WhatsApp → API Setup →
  "Add phone number". It must be a number NOT currently registered on the
  WhatsApp app (a spare SIM or landline works — verification is by
  call/SMS).

Note down from **WhatsApp → API Setup**:
- **Phone number ID** (a long number under the phone dropdown)

## Step 3 — Get the keys

1. **Access token (permanent):** Business Settings
   (business.facebook.com/settings) → Users → **System users** → Add →
   name it "unze-dashboard", role Admin → **Add assets** → your app, full
   control → **Generate new token** → select the app, tick
   `whatsapp_business_messaging` + `whatsapp_business_management`,
   expiry **never** → copy the token.
2. **App secret:** App dashboard → App settings → Basic → **App secret**.
3. **Verify token:** invent any random phrase yourself, e.g.
   `unze-wa-verify-8k2m` — you'll paste the same value in two places.

## Step 4 — Put the keys in Vercel

Vercel → the dashboard project → Settings → Environment Variables → add
these four (Production):

| Name | Value |
|------|-------|
| `WHATSAPP_ACCESS_TOKEN` | the permanent system-user token |
| `WHATSAPP_APP_SECRET` | the app secret |
| `WHATSAPP_VERIFY_TOKEN` | your invented phrase |
| `WHATSAPP_PHONE_NUMBER_ID` | the phone number ID |

Then **redeploy** (Deployments → ⋯ on the latest → Redeploy) so the
variables take effect.

## Step 5 — Point Meta at the app

App dashboard → WhatsApp → **Configuration** → Webhook → Edit:

- Callback URL: `https://pulse.unze.co.uk/api/whatsapp/webhook`
- Verify token: your invented phrase (same as `WHATSAPP_VERIFY_TOKEN`)
- Click **Verify and save** (this only succeeds after Step 4's redeploy).
- Under Webhook fields, **Subscribe** to `messages`.

## Step 6 — Map the users

In the dashboard go to **/settings/whatsapp** (admin only):
- enter each person's WhatsApp number in international format
  (`+923001234567`, `+447700900123`),
- switch **Can issue tasks** on for yourself, your PA, and any managers who
  should be able to create tasks. Everyone mapped can be an assignee.

## Step 7 — Test

From your own WhatsApp, message the business number:

```
@<a colleague's first name> Test task from WhatsApp, due tomorrow
```

You should get "✓ Task created …" back, and the task appears in their
My Tasks with the normal notification. Also try `help`, a message with no
due date (it should ask), and `cancel`.

## Troubleshooting

- **Webhook verify fails:** the env vars weren't deployed yet, or the
  verify token differs between Vercel and Meta.
- **No reply comes back:** ACCESS_TOKEN / PHONE_NUMBER_ID missing or wrong;
  with the free test number, the recipient must be one of the 5 verified
  numbers.
- **"This number isn't linked":** sender's number isn't in
  Settings → WhatsApp, or is saved in a different format (the match ignores
  spaces/+, so any international format works).
- Every inbound message is logged in the `whatsapp_inbound_log` table with
  an outcome — useful when something seems ignored.
