# Browser checks for Sales

End-to-end checks that drive the real screens of a production build and verify the database after each step.
They are not part of `npm test` (they need a running app and Playwright's Chromium).

1. Start the local database (`npm run db:start`) and migrate a database for the app, e.g. `daybook_ui`.
2. Build and start the app on port 3100 with `ADMIN_PASSWORD=pw`, `CRON_SECRET=testcron` and that database.
3. Run each file with Node: `node scripts/e2e/1-settings.cjs` ... `node scripts/e2e/7-tick.cjs`.

They change data in that database (offers, blocklist, test deals): never point them at production.

| File | What it proves |
|---|---|
| 1-settings | Targets, booking link, targeting mode, after-sale timing save and reload correctly |
| 2-offers | Offer catalogue with packages; a quote starts from a package with its items, scope and currency |
| 3-dnc | Do-not-contact drops leads and stops outreach; known contacts are tagged and attached to their deal |
| 4-library | Objections group and keep your answer; case studies draft, refuse approval when empty, approve and delete |
| 5-send | Sending from a move records purpose and edits; Today's outreach card counts it |
| 6-numbers | Insights, Stats and Radar Plan figures match independent SQL |
| 7-tick | The background tick groups objections once a day, drafts case studies, picks the focus, makes after-sale moves |
