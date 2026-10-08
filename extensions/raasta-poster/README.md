# Raasta-AI Poster

A small Chrome / Edge / Brave extension that helps a recruiter post a Raasta-AI job on **Indeed** or **Rozee.pk** from their own signed-in browser.

## Why it exists

Indeed protects its employer pages with Cloudflare's bot check (a hidden automated browser is blocked outright), and Rozee.pk has no posting API. This extension needs no automation at all: the person does the posting in their normal browser, where they are signed in and any check passes as usual, and the extension puts the job's details beside the platform's own form. It has been verified on the real Indeed Post a job flow.

## What it does

1. In Raasta-AI, **Publish → Indeed (or Rozee.pk) → Copy and open** sends the job's fields (title, location, type, pay, the AI-written description, apply link) to the extension and opens the platform.
2. On the platform's page a small panel appears (bottom right) with:
   - **Copy** next to every field,
   - **Fill the form**, which finds boxes by their visible names and types the values in,
   - **Copy page report**, which copies a description of the page's form (what each box is called, how to point at it, what Fill would put where) for whoever tunes Fill. It never contains what you typed, passwords, links or the query part of the address,
   - **I posted it**, which tells Raasta-AI so it can mark the job as posted.
3. **You** check the fields and press the platform's own Post button.

It never presses the platform's buttons (Continue, Post and so on), never submits anything, never overwrites text you already typed, and never touches password fields. Besides typing, the one thing Fill does is tick an option that has the same name as the job type (for example the "Full-time" chip).

## Install (Chrome, Edge, Brave)

1. Open `chrome://extensions` (Edge: `edge://extensions`) and switch on **Developer mode**.
2. **Load unpacked** and choose this folder (`extensions/raasta-poster`).
3. **Reload the Raasta-AI tab.** The Publish panel then says the extension is connected.

Raasta-AI is expected at `http://localhost:8085`. If yours runs somewhere else, add its address to the first `matches` list in `manifest.json` and reload the extension on the extensions page.

## Using it

1. Raasta-AI: Recruiter, Jobs, **Publish** on the job. Write or edit the post for the platform, then **Copy and open Indeed**.
2. In the tab that opens, sign in to Indeed yourself (the extension never sees your credentials) and start **Post a job**.
3. In the panel: **Fill the form**, or **Copy** each field into the box you are on. Check everything.
4. Press the platform's own button to post. Then click **I posted it** in the panel. Raasta-AI records it the next time you look at its tab.

A kit expires after two hours and disappears once you click I posted it or Discard kit.

## Be aware

- **If Fill misses boxes, send a page report.** Click **Copy page report** on each step of the platform's form that it got wrong and paste it to the developer: it shows the names Fill could read and the selector for each box, which is what is needed to fix the patterns in `lib/fill.js`.
- **Fill is best effort.** It matches boxes by their labels (for example "Job title", "Job description"), because markup changes more often than wording does. The platforms' employer forms could not be checked from outside a sign-in when this was written, so some boxes may be missed. Whatever it cannot find is listed, and **Copy always works**.
- Chromium-based browsers only (no Firefox).
- Posting on Indeed or Rozee.pk is subject to their terms; this extension only helps a person fill in a form they are using themselves.

## What it stores and reads

- It stores the current kit (job text) and posts you confirmed, in the browser's extension storage, for up to two hours.
- It runs only on Raasta-AI's own address and these pages: `employers.indeed.com`, `hiring.rozee.pk`, `www.rozee.pk`, `www.rozeegpt.ai` (see `manifest.json`). It makes no network requests of its own.
- It has no access to cookies, passwords, your sign-in or any other site.

## Files

| File | Role |
|---|---|
| `manifest.json` | Manifest V3; which pages it runs on |
| `bridge.js` | On the Raasta-AI page: receives a kit, reports confirmations (`window.postMessage`, same window and origin only) |
| `panel.js` | On the platform page: the panel (Shadow DOM; kit text is written with `textContent`, never as HTML) |
| `lib/kit.js` | Checks a kit and decides which platform a page belongs to |
| `lib/fill.js` | Finds a field by name and fills it the way typing would |

The Raasta-AI side is `libs/poster-bridge.js` (browser) and `libs/hiring/posting-kit.js` (the kit). Tests: `tests/hiring/poster-extension.test.js` (runs the real extension in Chromium against stand-in pages) and `tests/hiring/posting-kit.test.js`.
