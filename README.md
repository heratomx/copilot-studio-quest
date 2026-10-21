# Copilot Studio Quest 🚀

A gamified, 60-minute Copilot Studio lesson for end users. It's a static website with **no sign-in**; the core workshop needs **no backend or database**, and live trainer reports use an optional API. Participants open a link, pick a nickname and an avatar, and play through 8 levels. Their progress is saved in their own browser.

| Level | Topic | Interactions |
|---|---|---|
| Start | Welcome to Contoso Coffee | Copilot-or-agent sorting, "agent-worthy?" swipe cards |
| 1 | How Copilot Studio works | Screenshot tour with callouts, "find the button" hotspot, ordering |
| 2 | Standard vs GitHub Copilot harness | Scenario sorting, boss question |
| 3 | Writing great instructions | Prompt score meter (G-C-S-E-G), hands-on mission |
| 4 | Knowledge, skills & automations | Sorting, "spot the bad source" |
| 5 | Staying in control (approvals, data, costs) | "Safe or risky?" swipe, approve-or-block |
| 6 | Break the bot (boss level) | Simulated agent chat: judge answers, find the bugs |
| 7 | Wrap up | Timed speed round, "my agent idea" card, feedback, certificate |

Game mechanics: XP, ranks, badges, cheat cards, 🔥 combos, boss challenges (double XP), hints (cost XP), 50/50, speed bonus, sound (with mute), confetti and a printable certificate.

---

## Run it locally

The app loads its content as JSON, so it needs a web server. Opening `index.html` straight from disk won't work.

```bash
cd copilot-studio-quest
python -m http.server 8080      # or: npx serve .
```

Open http://localhost:8080 for participants, and http://localhost:8080/trainer.html for the trainer page.

## Deploy to Azure Static Web Apps (free, public, no sign-in)

1. Push this folder to a GitHub repository.
2. In the Azure portal, create a **Static Web App** with plan **Free**. For **Source**, pick GitHub and select your repo and the `main` branch.
   - Build preset: **Custom**, App location `/`, Api location `api`, Output location empty.
3. This repo uses `.github/workflows/azure-static-web-apps-witty-field-0f2b7fb0f.yml` and the GitHub secret `AZURE_STATIC_WEB_APPS_API_TOKEN_WITTY_FIELD_0F2B7FB0F` created by Azure. Keep only one deployment workflow. The front end is plain HTML, CSS and JavaScript, so the workflow sets `skip_app_build: true`; no npm install or front-end build step is needed. The `api` folder is deployed as managed Azure Functions for optional live results.
4. Every push to `main` redeploys. Share the `https://<name>.azurestaticapps.net` link, for example as a QR code on your first slide.

The workflow also supplies a short-lived GitHub identity token for Azure's GitHub deployment authorization policy. It uses the built-in client in `actions/github-script`, so it does not install npm packages into the app.

The site is public by default. Don't add authentication, or participants will have to sign in.

Azure hosting and GitHub Actions have separate billing. Standard GitHub-hosted Actions runners are free for public repositories; private repositories have a limited free allowance.

`staticwebapp.config.json` sets security headers and keeps lesson JSON from being cached, so content changes show up immediately.

## Running a workshop

Full run of show, scripts and troubleshooting: see **TRAINER-GUIDE.md**.


- **Trainer page:** `/trainer.html` shows every level's unlock code, timing and mission code word. It also has a big-screen code display and a hotspot picker. It isn't linked from the app.
- **Pacing:** levels unlock one after another. After each section, show the next code. Late joiners enter the current code on the map, which unlocks that level and every level before it.
- **Swipe questions:** each answer explanation stays visible for 6 seconds, with a countdown showing when the next card will appear. Use **Next question** (or **See results** on the last card) to move on sooner.
- **Unlock everything:** `OPENALL` (change it in `content/workshop.json`). To start with all levels open, set `"unlockMode": "open"`.
- **Codes control pacing, not security.** Anyone who reads the page source can find them. That's fine for a workshop.
- **Separate groups:** `?workshop=customer-a` loads `content/customer-a.json` (or falls back to `workshop.json`) and stores progress separately.
- **Fresh start on a shared device:** add `&reset=1` to the link.
- **Feedback:** stars and comments stay on each device. To collect them, put a Microsoft Forms link in `feedbackFormUrl`.

## Languages (English · Deutsch · Español · 中文)

- Participants switch language with the picker on the welcome screen or in the top bar. The choice is remembered, and switching mid-level keeps their place.
- The first visit uses the browser language if it's supported, otherwise `defaultLanguage`.
- Supported: **English (`en`), German (`de`), Spanish (`es`), Simplified Chinese (`zh`)**. These are the only languages in the picker.
- Force a language with a link: `…/?lang=de`, `?lang=es` or `?lang=zh` (good for a single-language workshop). It combines with a live link: `…/?lang=es&live=CODE`.
- **Where the text lives**
  - Buttons and messages: `js/i18n.js` (one block per language)
  - Story, title, disclaimer: `content/workshop.json` (`{ "en": "…", "de": "…" }`)
  - Lessons: English in `content/lessons/`, and the translations in `content/lessons/de/`, `content/lessons/es/` and `content/lessons/zh/` (same file names)
  - "Focus next" recommendations: in each lesson's `focus` block, with Microsoft Learn links in the matching language (`en-us`, `de-de`, `es-es`, `zh-cn`)
- **When you edit a lesson, edit all four languages.** Keep the same steps, answers and order, and change only the text. A missing translated file falls back to English.
- **Add a language** (for example French): copy the `en` block in `js/i18n.js` to `fr`, add `{ "code": "fr", "label": "Français", "flag": "🇫🇷" }` to `languages`, add `"fr"` text to `workshop.json`, and add `content/lessons/fr/`.

## Live results & learning reports (optional)

There are two parts:

- **Personal learning report (always on, no backend).** At any time, each participant can open **📊 My learning report**. It shows their understanding per topic (based on their *first* answer to each question), their strengths, the questions to revisit, and what to focus on next, with Microsoft Learn links in their language. A summary also appears on the certificate.
- **Trainer room report (optional, needs Azure Table Storage).** `/dashboard.html` shows, live: understanding per topic for the whole room (🟢 / 🟡 / 🔴), what the group should focus on, the most-missed questions, where people are, who may need support, agent ideas and feedback. You can export everything as CSV.

Participants still **never sign in**. Only players who open your **live link** (`…/index.html?live=CODE`) send results. They see a notice explaining that the trainer sees their nickname, avatar and answers. The plain link stays 100% offline.

### What is stored

One row per player per session: nickname, avatar, language, XP, levels done, per-topic scores, the IDs of missed questions, and (if filled in) the idea card and feedback. No real names, emails, IP addresses or device data. The API cleans and size-limits everything it receives.

### One-time setup in Azure (about 10 minutes)

1. **Create a storage account.** In the Azure portal, search for **Storage accounts** and click **+ Create**.
   - Same resource group as the Static Web App, region **Germany West Central** (keeps the data in Germany; if Azure refuses the region, pick another EU region such as *Sweden Central*), **Performance: Standard**, **Redundancy: LRS** (cheapest).
   - Review + create.
2. **Copy its connection string.** Open the storage account, then **Security + networking → Access keys**, then **Show** next to *Connection string* (key1), and copy it.
3. **Add two settings to the Static Web App.** Open your Static Web App, then **Settings → Environment variables**, then **Production**, then **+ Add**:
   | Name | Value |
   |---|---|
   | `RESULTS_STORAGE` | the connection string from step 2 |
   | `TRAINER_KEY` | a password of your choice, **at least 10 characters**. You type it on the dashboard. |
   Click **Apply**.
4. **Confirm API deployment is enabled.** The included Azure workflow already sets `api_location: "api"`; keep that setting when updating the workflow.
5. After the deployment turns green, open `https://<your-site>/dashboard.html`, enter your trainer key, and start a session.

The API runs on the managed Functions that come with the Free Static Web Apps plan (Node 20, configured in `staticwebapp.config.json`). It has **no npm dependencies**: it talks to Table Storage directly with the storage key.

### Running a live session

1. On the dashboard, type a workshop name, pick a duration (default 4 hours) and click **▶ Start session**.
2. Share the **live link** shown in the purple box, ideally as a QR code on your slide.
3. Watch the room report. It refreshes every 10 seconds.
4. When you're done: **Close** stops accepting results but keeps them, so you can still export the CSV. **Delete** closes the session and deletes its results.

### Turning it off

| Switch | Where | Effect |
|---|---|---|
| **Live results ON/OFF** | Dashboard toggle | OFF: the API rejects all new results, participants see "paused" and keep playing offline. Instant, reversible. |
| **Close / Delete session** | Dashboard, per session | Stops one session, or stops it and deletes its data. |
| **Delete all data** | Dashboard | Deletes every session and result. |
| **Automatic clean-up** | Built in | Expired sessions and their results are deleted the next time you open the dashboard. |
| **`LIVE_RESULTS` = `off`** | Static Web App → Environment variables | Hard off: the API stops touching storage completely, with no reads or writes. Remove the setting to switch back on. |
| **`"liveResults": false`** | `content/workshop.json` | The participant app never calls the API at all, even with a live link. |
| **Delete the storage account** | Azure portal | Everything is gone, with zero cost. The quest keeps working offline, and the dashboard says storage isn't configured. |

### Costs

The Free Static Web Apps plan has no bandwidth overage charges. Table Storage costs fractions of a cent per 10,000 operations, so one 60-minute workshop with 30 people uses about 1,200 writes plus the dashboard refreshes, which comes to roughly **1 cent**. Writes are only accepted while a session you started is open, limited to one per player every 1.5 seconds, and capped in size. As a safety net, set a monthly **budget alert** (for example €5) on the resource group. Alerts notify you but don't stop spending.

### Test it locally (no Azure needed)

```bash
node tools/dev-server.js
```
Open http://localhost:4280/dashboard.html (trainer key `trainer-demo-key`). The dev server runs the real API code against an in-memory Table Storage simulator (`tools/table-sim.js`), so data is lost when you stop it. The `tools/` folder isn't served on Azure.

## Editing the content (no coding)

- `content/workshop.json` holds the title, story, disclaimer, level order, unlock codes and minutes.
- `content/lessons/*.json` holds one file per level. Each has a badge, a cheat card and a list of `steps`.

Step types:

| type | What it is | Key fields |
|---|---|---|
| `info` | Lesson text, optional screenshot with numbered callouts | `title`, `text` (supports `**bold**` and `- bullets`), `image`, `callouts[{x,y,label}]` |
| `mcq` | Single choice | `question`, `options`, `answer` (index), `explain`, `hint`, `timed` (seconds), `boss` |
| `multi` | Pick all that apply | `options`, `answers` (indices) |
| `sort` | Put items into categories | `buckets`, `items[{text,bucket}]` |
| `order` | Put steps in order | `items` (in the correct order; the app shuffles them) |
| `swipe` | Left/right decision cards | `left`, `right`, `cards[{text,answer:"left"/"right",why}]` |
| `hotspot` | Click the right spot on a screenshot | `image`, `target{x,y,w,h}` (percent) |
| `prompt` | Write instructions, scored live by the G-C-S-E-G meter | `scenario`, `minScore`, `example` |
| `breakbot` | Simulated agent chat to find bugs | `agent{name,description,knowledge}`, `tests[{q,a,fails,why}]` |
| `mission` | Optional hands-on task in Copilot Studio with a code word | `text`, `codeWord`, `bonusXp` |
| `idea` | "My next agent" card | `fields[{key,label,placeholder}]` |
| `feedback` | Star rating and comment | `question` |

After editing, check the JSON (for example with `python -m json.tool file.json`) and reload the page.

## Screenshots

The two images in `assets/screens/` are **placeholders**. See `SCREENSHOTS.md` for exactly which Copilot Studio screens to capture. After replacing a hotspot image, use the picker on `trainer.html` to get new `target` coordinates.

## Privacy

- No sign-in, no cookies, no analytics. Nothing is sent to any server unless a participant opens a **live link** from the trainer (see *Live results*).
- Nickname, progress, idea card and feedback are stored only in the participant's browser (`localStorage`), and they can reset it on the map.
- If you add a leaderboard later, store nicknames only and delete the data after each workshop.

## Keep the content current

Copilot Studio changes often. Before each workshop, check level 2 (harnesses) and level 5 (costs) against Microsoft Learn:
- [Harnesses in Copilot Studio](https://learn.microsoft.com/en-us/microsoft-copilot-studio/harnesses-overview)
- [Compare Copilot Studio agent harnesses](https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/choose-harness)
- [Usage-based billing (GitHub Copilot harness)](https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/billing-credit-overview)
