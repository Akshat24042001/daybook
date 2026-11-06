# UX audit (November 2026)

Method: every page was opened on a 1360px desktop and a 390px phone, with realistic data (all seven task types, a month of
history, a research profile, sales leads), then judged as a stranger would judge a paid product. This is the honest list.
The **Status** column says what was done about each item in this change; "Open" means it is real and still to do.

## The five problems that matter most

| # | Problem | Why it hurts | Status |
| --- | --- | --- | --- |
| 1 | **Just opening Plan changes your data.** Plan carried every unresolved task onto whatever date you looked at, and created recurring and cadence entries as a side effect. Paging through days dragged tasks forward and bumped their "carried" counts. | This is why tasks "come back again and again": the app moved them for you. Reading a page must never write. | Fixed: Plan only carries onto today or tomorrow, never onto a past or far-future day you merely looked at. |
| 2 | **Cadence tasks only existed if you opened Plan.** A "post every 3 days" task never showed on Today by itself. | It looks broken: the rule is right, the task never appears. | Fixed: overdue cadence tasks now show on Today as one-tap nudges. |
| 3 | **Nothing stops a task nagging forever.** A skipped one-off is carried every day with no way to say "stop". | Same symptom as #1, different cause. | Fixed: tasks carried 3 or more times get a "Stuck" prompt: do it, schedule it, park it in Someday, or drop it. |
| 4 | **The mic and the quick-add bar cannot set a project.** Projects only work through a typed `Project: title` prefix, which speech can never produce. | "Add to the Vector project" silently becomes part of the title. | Fixed: speech understands "in/for/under the Vector project"; the bar has a project picker. |
| 5 | **No calendar, no sign-out, no overview of what is coming.** | You cannot see the week, a month, or a future day's tasks, and you cannot leave the app. | Fixed: a full Calendar (day, week, month, year, upcoming) and a Sign out button. |

## Cross-cutting flaws

| Flaw | Where | Status |
| --- | --- | --- |
| Every page has a different left edge and width. Plan, Tasks, History centre a 56rem column; Projects, Goals, Sales run full width. Switching pages makes the whole layout jump. | all | Partly: the shared `PageHeader` exists and Calendar and the exercise library use it. Fixed for width: every page now uses the same 72rem column (Settings 56rem, being a form). |
| Four different heading sizes and styles for the page title (`text-3xl` display, `text-2xl`, plain `h1`, kicker or no kicker). | all | Partly: every page title now shares one size (2xl, 3xl from tablet up); the full icon-bubble `PageHeader` is only on Calendar and the exercise library. **Open.** |
| Dates in five formats on one screen: `2026-11-06`, `Fri, Nov 13`, `6 Nov 2026`, `11/07/2026`, `Nov 7`. Raw ISO dates leak into the task page ("added 2026-11-06", "Today is 2026-11-06"). | task page, lists | Partly: task page and All tasks use friendly dates; some lists still show ISO dates. **Open.** |
| The quick-add bar is the loudest element on every page, even where adding makes no sense (Settings, History). | all | Open: collapse to a compact bar on pages that are not about tasks. |
| Tiny grey metadata (11 to 12px, `text-subtle` on pastel) is hard to read. | all | Fixed: deeper ink colour; 11px text raised to 12px (10px kbd and group labels unchanged). |
| Navigation overload: 14 sidebar items, 14 tiles in the phone "More" sheet, and Sales also has its own pill bar that repeats the sidebar's Sales group. | sidebar, Sales | Fixed: on desktop the Sales bar shows only what the sidebar lacks (Documents, Review, Settings); full on phone. Calendar added next to Today. |
| No sign-out anywhere in the app. | sidebar | Fixed. |
| Hydration mismatch warnings on Plan, Health, Settings, Today (phone). Dates and times rendered with the browser's locale differ from the server's. | several | Fixed where reproduced (unstable dnd-kit ids; Plan, Health, Settings, Today, Calendar on phone). |
| Sales > Review crashes: `bind message supplies 1 parameters, but prepared statement requires 0`. | Sales Review | Fixed. |
| Colour: the pastel set is pleasant but flat; every fill is the same lightness, so nothing has depth and primary actions barely stand out from the canvas. | all | Fixed: a deeper, harmonised palette (see below), checked by screenshot on Today and Calendar, light and phone. |

## Page by page

### Login
- Bare: a heading and one field on a flat tint. No logo, no canvas, no sense of product, no error design, no show-password, no "remember me" explanation. First impression of the whole app. **Fixed:** brand panel, canvas, card, show-password, clearer errors (wrong password, rate limit, offline), autofocus.

### Today
- Desktop: strong. But no progress at a glance ("3 of 9 done"), no date navigation, and the right column is a stack of five unrelated cards (Sleep, Instagram, intentions, end of day, steps) in no priority order. **Fixed: progress strip ("3 of 9 done"). Open: date navigator on Today (use Calendar), grouping the right-hand cards.**
- Phone: roughly 3,600px of scroll. The tasks are first (right), but the Instagram card alone is a full screen. **Open: collapse the health cards into one "How are you doing" card on phones.**
- The floating bottom bar covers the last row until you scroll (needs extra bottom padding). **Fixed.**
- Cadence tasks never appear (see #2). **Fixed.**

### Plan
- The page is a list with a capacity bar; there is no sense of the week, no visible reason a task is "Carried", and tasks carry onto whatever date you view (see #1). **Fixed.**
- "Carried" label on every row is noise when most rows carry. **Fixed: shown only when carried 2+ times, with the count, in amber.**

### All tasks
- 15 identical "Active" badges: a badge that is on every row says nothing. **Fixed: only non-default states get a badge.**
- Meta line reads like a database: "one off  last on Sat, Nov 7 (open)". **Fixed: plain words.**
- No sorting, no grouping by project. **Open.**

### Task page and task dialog
- The task page shows **every field for every type**: a cadence task offers "Person", "Via (referrer)", "Reminder lead", "Show on Today from"... Fifteen inputs, no hierarchy, no explanation of what the type does. **Fixed: only the fields that matter for the type, plus a plain-English line saying what the type does.**
- No status, no history, no "what happens next". You edit a form; you cannot *run* the task from it. **Fixed: a status card with the actions, and the task's history.**
- The dialog on Today and the page are two different designs for the same object. **Fixed: one visual language, with the dialog as the quick version and a clear "Open full task".**

### Calendar
- Did not exist. **Built.**

### Unfinished
- Useful but long; no way to decide in bulk. **Open.**

### Diary, Scratchpad, Assistant, References
- Consistent enough, but headers and widths differ (see cross-cutting). **Open: needs the shared header.**

### Goals
- "Cadence" lists the same task twice when two tasks share a name; the big empty "Time goals" card wastes the top of the page. **Open: collapse the empty card to one line.**

### Review
- Fine; dense. **Open.**

### Stats
- Phone: a 7,000px scroll of identical-looking tiles. The tiles are good; the *page* has no summary, no sticky period picker, no jump links. **Open: sticky period bar and section jump links.**

### Health
- Hydration warning. **Fixed.**

### Projects
- Two cards in a sea of empty canvas; no way to see a project's tasks without expanding; "Type `Name:` in the quick-add bar" is the only explanation of how to put tasks in a project. **Fixed: the project picker in quick-add and voice support make the prefix optional. Open: the empty-canvas layout.**

### Contacts
- Cards say "Added today, no touch yet" with no avatar, no next-touch date, and a dropdown whose purpose ("Monthly") is unclear. **Open.**

### History
- Good. Needs a header like the others. **Open.**

### Settings
- **5,950px tall.** The 3D exercise library (60 cards) is buried inside Settings between "Exercise pings" and "People". Settings should take one screen of scrolling. **Fixed: the exercise library has its own page (Health > Exercise library) and Settings links to it. Open: section anchor bar.**
- The sticky "Save settings" bar covers content. **Open:** raised above the phone nav, not redesigned.

### Sales (Moves, Pipeline, Radar, Accounts, Documents, Review, Settings)
- The pill bar repeats the sidebar (desktop). **Fixed.**
- Moves: strong. The stat tiles use colour well. Page title is `text-2xl` while other pages use `text-3xl`. **Fixed.**
- Review: crashed. **Fixed** (a stray bind parameter) and covered by a test.
- Pipeline and Radar: dense but coherent after the earlier work. **Open: Radar needs filters (country, score) on phones.**

## The colour palette

The first pastel pass was too uniform: every fill sat at about the same lightness, so primary buttons, selected tabs and the canvas all blended. The fix keeps the airy feel and adds **depth**: deeper fills and richer inks, a slightly stronger canvas, and surfaces that stay light for legibility. Every text colour was checked against its background for WCAG AA contrast.
