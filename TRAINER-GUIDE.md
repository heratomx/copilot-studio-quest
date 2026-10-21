# Trainer guide – Copilot Studio Quest (60 minutes)

## The idea in one sentence

You teach and demo each topic for a few minutes, then participants play that level on their phone or laptop. You control the pace with a code per level, and everyone ends with a certificate.

**Rhythm for every level:** 🎤 explain/demo (2–3 min) → 🔑 show the code → 🎮 participants play (4–6 min) → 💬 discuss 1–2 answers → next level.

---

## Before the workshop

**One week before**
- [ ] Replace the placeholder screenshots (`SCREENSHOTS.md`) and fix the hotspot positions on `/trainer.html`.
- [ ] Check levels 2 (harnesses) and 5 (costs) against Microsoft Learn. These change most often.
- [ ] Change the unlock codes in `content/workshop.json` if you've used them with another group.
- [ ] Optional: create a Microsoft Forms survey and paste its link into `feedbackFormUrl`.
- [ ] Optional: for a customer-specific version, copy `workshop.json` to `content/<customer>.json` and share `…/?workshop=<customer>`.

**On the day**
- [ ] Open the participant link in an **incognito window** and play the first two steps. This is exactly what participants will see.
- [ ] Open `/trainer.html` in a second tab and keep it ready to show codes full screen.
- [ ] Put a **QR code** of the link on your first slide. Bing, Edge or PowerPoint can make one.
- [ ] If people will do the hands-on missions: prepare a Copilot Studio environment they can use, and make sure they have access.
- [ ] Live results: start a session on `/dashboard.html` and use its live link for the QR code.
- [ ] Turn the room sound down. The app plays short sounds; participants can mute them with 🔊.

---

## Run of show

| Time | Level | What you do | Code to show after |
|---|---|---|---|
| 0–5 | **Start** – Welcome | Show the QR code. "Pick a nickname, not your real name." Explain XP, badges, hints. Let everyone play the Start level. | `ROAST` |
| 5–13 | **1** – How Copilot Studio works | Demo: open an agent, point at instructions, knowledge, tools, the test pane and Publish. | `BLEND` |
| 13–20 | **2** – Standard vs GitHub Copilot harness | Explain the three harnesses with one example each. Ask the room: "Which would you use for…?" | `LATTE` |
| 20–30 | **3** – Writing great instructions | Show a weak and a strong instruction live. Introduce **G-C-S-E-G**. After the prompt challenge, ask 1–2 people to read theirs aloud. | `MOCHA` |
| 30–38 | **4** – Knowledge, skills & automations | Demo adding a knowledge source and a tool. Stress "one official source". | `CREMA` |
| 38–46 | **5** – Staying in control | Talk about approvals, permissions, sharing and credits. Show an agent's Monitor page if you can. | `GRIND` |
| 46–54 | **6** – Break the bot 👾 | "Your job: find the bugs." Afterwards, ask who found all three. | `CHEERS` |
| 54–60 | **7** – Wrap up | Speed round, idea card, feedback. "Show me your certificate!" Ask 2–3 people to share their agent idea. | – |

The **Start** level is open from the beginning. Every other level unlocks when the player finishes the one before it **or** enters its code. The codes are what keep the room together: people who are fast can't jump ahead, and people who fall behind can catch up by entering the current code.

> 💡 Tip: show the code on screen **after** your demo, not before. Otherwise people play instead of listening.

### Phrases that work
- Opening: *"This isn't a test. Wrong answers explain why, and that's where you learn the most."*
- Before each level: *"You have 5 minutes. When you see the badge, look up."*
- Waiting for the group: *"Finished early? Try the bonus mission or replay for 3 stars."*
- Closing: *"Take a screenshot of your certificate and your idea card. That's your homework."*

---

## Live results (optional)

- **Before:** open `/dashboard.html`, enter your trainer key, check the switch is **ON**, and **start a session**. Put the **live link** from the purple box on your QR slide instead of the normal link.
- **During:** keep the dashboard open on your laptop, not on the projector, because it shows names. Look at it after each level:
  - 🔴 **Revisit** topics: re-explain with the whole room before showing the next code.
  - 🟡 **Shaky** topics: do a 1-minute recap of the most-missed question.
  - **May need support:** walk over to those people during the next hands-on part.
- **Wrap-up:** ask everyone to open **📊 My learning report**. It tells each person what to focus on next, with Learn links. Show the group's focus list from the dashboard as your closing recommendation.
- **After:** **Export CSV** if you want to keep the results (for example for the customer follow-up), then **Delete** the session and turn the switch **OFF**.

---

## Language

- The app is available in **English, German, Spanish and Simplified Chinese**. Each participant picks their language at the top of the welcome screen, or in the top bar at any time.
- For a single-language group, add `?lang=de`, `?lang=es` or `?lang=zh` to the link so everyone starts in that language. With live results, combine both: `…/index.html?lang=es&live=CODE`.
- The dashboard is in English, but it collects results from every language into the same room report.
- Codes and mission words are the same in both languages, so a mixed room works fine.

---

## Handling common situations

| Situation | What to do |
|---|---|
| Someone arrives late | They scan the QR code and enter the **current** code. That unlocks everything up to there. |
| Someone switches device | Progress stays on the old device. They start again on the new one and enter the current code. |
| Someone is stuck on a question | Point to 💡 **Hint** (costs 5 XP) or ✂️ **50/50**. Each can be used once per level. |
| You need to skip ahead or run out of time | Show the code of a later level, or **`OPENALL`** to unlock everything. |
| A shared or training PC still has someone else's progress | Open the link with `?reset=1` at the end, or click **Reset my progress** on the map. |
| "Is my name stored somewhere?" | No. Everything stays in their browser, and nothing is sent to a server. |
| Hands-on missions | Optional bonus XP. Only use them if participants have Copilot Studio access. The code words are on `/trainer.html`. In level 6, participants show you a weak answer from their own agent, and you tell them the word (`CRUMBS`). |
| The app won't load | Ask them to refresh, or try another browser. Corporate browsers sometimes block sites; then use a phone. |

---

## Shorter or longer formats

- **30 minutes:** set `"unlockMode": "open"` and play Start, 2, 3 and 6. Skip the demos.
- **Self-paced (no trainer):** set `"unlockMode": "open"` and share the link after the workshop.
- **Half day:** add a 20-minute hands-on build in Copilot Studio after level 3, and use the missions.

## After the workshop
- Collect feedback through your Forms link, or ask participants to screenshot their feedback screen.
- Suggest a next step: *"Build the agent from your idea card and test it with the 5 tests from Break the bot."*
- Change the codes before you run the quest for another group.
