# Telegram → Tasks — setup guide

Unlike WhatsApp, there is **no business registration** — you create a bot in
two minutes inside Telegram itself, copy one token, and you're done.

## How it works once set up

Message the bot directly on Telegram:

```
@Sundas Prepare board pack, due Friday
task for Ali: chase HBL statement by 5 Sep
```

The app looks up who sent it, finds the assignee, creates the task through
the same pipeline as the New Task form (normal notification + My Tasks), and
replies with a confirmation. If no due date is given it asks for one and waits.
Send `help` to the bot to see the full usage guide.

---

## Step 1 — Create the bot (2 minutes, free)

1. Open Telegram and search for **@BotFather** (the official bot; blue tick).
2. Send: `/newbot`
3. BotFather asks for a name — call it something like `Unze Dashboard`.
4. BotFather asks for a username — must end in `bot`, e.g. `unze_dashboard_bot`.
5. BotFather replies with your **bot token** — a string like
   `7412345678:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxx`
   **Copy this — you'll need it in Step 2.**

That's all. No phone number, no business account, no waiting.

---

## Step 2 — Add the token to Vercel

Go to **Vercel → your project → Settings → Environment Variables** and add
these two (select **Production** for both, then redeploy):

| Name | Value |
|------|-------|
| `TELEGRAM_BOT_TOKEN` | the token from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | make up any random string, e.g. `unze-tg-8k4p` — you'll use it in Step 3 |

Then **redeploy**: Deployments → ⋯ on the latest → Redeploy.
Wait for it to go green before Step 3.

---

## Step 3 — Register the webhook (one terminal command)

Open Terminal (Mac) or Command Prompt (Windows) and run:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://pulse.unze.co.uk/api/telegram/webhook&secret_token=<YOUR_SECRET>"
```

Replace `<TOKEN>` with your bot token and `<YOUR_SECRET>` with your chosen
`TELEGRAM_WEBHOOK_SECRET` value.

You should see:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

That's it — Telegram will now POST every bot message to the app.

---

## Step 4 — Link the members

Each person who wants to use the bot does this **once**:

1. Open Telegram, search for your bot by its username (e.g. `@unze_dashboard_bot`).
2. Send `/link` to the bot.
3. The bot replies: *"Your Telegram ID is: 123456789"*
4. Send that number to the admin.

The admin goes to **/settings/telegram** in the dashboard:
- Pastes each person's Telegram ID into the **Telegram ID** column and clicks Save.
- Flips **Can issue tasks** on for anyone who should be able to create tasks
  (everyone mapped can be an assignee regardless).

---

## Step 5 — Test

From your Telegram, send the bot:

```
@<a colleague's first name> Test task from Telegram, due tomorrow
```

You should get "✓ Task created …" back and the task appears in their My Tasks
with the normal notification. Also try `help`, a message with no due date
(it should ask), and `cancel`.

---

## Troubleshooting

- **Bot doesn't reply at all:** the webhook isn't registered, or the
  `TELEGRAM_BOT_TOKEN` is wrong / wasn't deployed. Re-run Step 3 and check
  Vercel env vars.
- **"Your account isn't linked":** the member hasn't done /link yet, or the
  admin hasn't pasted their Telegram ID into Settings → Telegram.
- **"You don't have permission":** the member is linked but Can issue tasks is
  off — admin toggles it at /settings/telegram.
- **Date not understood:** use `tomorrow`, `Friday`, `5 Sep`, or `05/09`.
  The bot asks again if it can't parse the date.
- Every inbound message is logged in the `telegram_inbound_log` table
  (outcome column) — useful when something seems to be ignored.

---

## Sending format

| Format | Example |
|--------|---------|
| `@Name task, due date` | `@Ali Prepare June VAT return, due Friday` |
| `task for Name: task, by date` | `task for Sundas: chase HBL by 5 Sep` |
| No due date | Bot asks, then you reply with just the date |
| `help` | Shows usage |
| `cancel` | Cancels a pending date-request |

Dates understood: `today`, `tomorrow`, `tmrw`, weekday names (`mon`–`sun`,
full or 3-letter), `5 Sep`, `Sep 5`, `05/09`, `2026-09-05`.
