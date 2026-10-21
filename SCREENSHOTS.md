# Screenshot checklist

Take these in your **demo/dev tenant** with demo data only: no customer names, real people or internal URLs. Save them as PNG, about 1600 px wide, into `assets/screens/`. Then update the `image` path in the lesson JSON.

## Required (replace the placeholders)

| File | Lesson | What to capture | Then update |
|---|---|---|---|
| `01-agent-overview.png` | Level 1, steps 1 and 4 | An agent's overview page with Instructions, Knowledge, Tools, the test pane and the Publish button all visible. An HR-style demo agent works best. | The `callouts` x/y in step 1 and the hotspot `target` in step 4. Use the hotspot picker on `trainer.html`. |
| `04-knowledge-sources.png` | Level 4, step 3 | The Knowledge list of a demo agent with 4–5 sources. Add an "old" and a "Copy of…" file on purpose so participants can spot them. | Match the `options` text to the file names shown. |

## Nice to have (add as `image` on info or mcq steps)

| Idea | Where |
|---|---|
| The harness choice when you create an agent (Standard vs GitHub Copilot) | Level 2, step 1 |
| The Instructions box with a strong G-C-S-E-G prompt | Level 3, step 1 |
| Before/after: weak prompt → weak answer, strong prompt → strong answer | Level 3, step 2 |
| Adding a tool or connector, and a workflow | Level 4, step 1 |
| A trigger configuration | Level 4, step 4 |
| An approval step (human in the loop) in a workflow | Level 5, step 3 |
| The agent's Monitor page showing credit usage | Level 5, step 5 |
| Test pane showing a citation in an answer | Level 1, step 6 |
| Test pane with an "I don't know" guardrail answer | Level 6, step 3 |

Tip: add a step-by-step tour with several `info` steps in a row, each with one screenshot and 2–4 `callouts`.
