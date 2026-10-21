# Copilot Studio Quest 🚀

A gamified, 60-minute Copilot Studio lesson for end users. It's a static website: **no sign-in, no backend, no database**. Participants open a link, pick a nickname and an avatar, and play through 8 levels. Their progress is saved in their own browser.

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
   - Build preset: **Custom**, App location `/`, Api location empty, Output location empty.
3. This repo uses `.github/workflows/azure-static-web-apps-witty-field-0f2b7fb0f.yml` and the GitHub secret `AZURE_STATIC_WEB_APPS_API_TOKEN_WITTY_FIELD_0F2B7FB0F` created by Azure. Keep only one deployment workflow. The app is plain HTML, CSS and JavaScript, so the workflow sets `skip_app_build: true`; no npm install or build step is needed.
4. Every push to `main` redeploys. Share the `https://<name>.azurestaticapps.net` link, for example as a QR code on your first slide.

The workflow also supplies a short-lived GitHub identity token for Azure's GitHub deployment authorization policy. It uses the built-in client in `actions/github-script`, so it does not install npm packages into the app.

The site is public by default. Don't add authentication, or participants will have to sign in.

Azure hosting and GitHub Actions have separate billing. Standard GitHub-hosted Actions runners are free for public repositories; private repositories have a limited free allowance.

`staticwebapp.config.json` sets security headers and keeps lesson JSON from being cached, so content changes show up immediately.

## Running a workshop

- **Trainer page:** `/trainer.html` shows every level's unlock code, timing and mission code word. It also has a big-screen code display and a hotspot picker. It isn't linked from the app.
- **Pacing:** levels unlock one after another. After each section, show the next code. Late joiners enter the current code on the map, which unlocks that level and every level before it.
- **Unlock everything:** `OPENALL` (change it in `content/workshop.json`). To start with all levels open, set `"unlockMode": "open"`.
- **Codes control pacing, not security.** Anyone who reads the page source can find them. That's fine for a workshop.
- **Separate groups:** `?workshop=customer-a` loads `content/customer-a.json` (or falls back to `workshop.json`) and stores progress separately.
- **Fresh start on a shared device:** add `&reset=1` to the link.
- **Feedback:** stars and comments stay on each device. To collect them, put a Microsoft Forms link in `feedbackFormUrl`.

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

- No sign-in, no cookies, no analytics, and no data sent to any server.
- Nickname, progress, idea card and feedback are stored only in the participant's browser (`localStorage`), and they can reset it on the map.
- If you add a leaderboard later, store nicknames only and delete the data after each workshop.

## Keep the content current

Copilot Studio changes often. Before each workshop, check level 2 (harnesses) and level 5 (costs) against Microsoft Learn:
- [Harnesses in Copilot Studio](https://learn.microsoft.com/en-us/microsoft-copilot-studio/harnesses-overview)
- [Compare Copilot Studio agent harnesses](https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/choose-harness)
- [Usage-based billing (GitHub Copilot harness)](https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/billing-credit-overview)
