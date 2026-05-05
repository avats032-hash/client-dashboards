# Client Dashboards

Static performance dashboards, one per client. Each pulls live data from a published Google Sheet CSV. No backend.

Hosted on GitHub Pages.

## Structure

- `index.html` — landing page listing all dashboards
- `<client-key>/` — each client's dashboard (HTML + CSS + JS)

## Adding a new client

1. Publish the client's Google Sheet as CSV (File → Share → Publish to web → select tab → CSV)
2. Copy `vyve-meta/` to `<new-client>/`
3. Update `CSV_URL` constant at the top of `app.js`
4. Update title and labels in `index.html`
5. Add a list entry to the root `index.html`
6. Commit and push — GitHub Pages auto-deploys

## Notes

- Data is fetched live on page load (and on Refresh click)
- Sheets must be **published** as CSV (not just shared) — Publish creates the public CSV URL
- All pages have `noindex,nofollow` meta tag so they aren't indexed by search engines
