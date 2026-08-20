# credit-card-offers

Zero-tap Chase/Amex "Add offer to card" clicking, run inside your own
already-signed-in Safari session on iPhone. No credentials are read,
stored, or transmitted anywhere — this only clicks buttons on a page your
browser already has open and authenticated.

Full design rationale and phased plan: see the plan this repo was built
from (ask the assistant that generated this repo if you need it again).

## Status: Phase 2 — Amex done, Chase paused (both surfaces)

- **Amex** (`amex-offers.user.js`): fully automated. Clicks every
  `[data-testid="merchantOfferListAddButton"]` on the page. Already-added
  offers don't render that button at all, so no extra skip logic was
  needed — confirmed from a real discovery dump.
- **Chase** (`chase-offers.user.js`): **clicks nothing right now, on
  either surface.** `processCarousel()` and `processGrid()` are both
  fully implemented but neither is called from `run()`. See below.

## Why Chase is fully paused

Clicking a grid tile was manually tested and turned out to **navigate
to a separate detail page** — one showing the offer's terms and an
"Added to card" state — not an inline add. That contradicts the
assumption `processCarousel()` was built on (that a tile labeled "Add
Offer" adds without leaving the page), and that assumption was never
actually live-verified, just inferred from label text. So it's no
longer trusted either — both surfaces are paused together rather than
leaving the carousel running on an unconfirmed guess.

What's missing to build this correctly:

1. Does clicking a **carousel** tile also navigate to a detail page, or
   does it genuinely add inline? Still unconfirmed.
2. The detail page's real "Add to Card" button selector, and its
   "Added to Card" confirmation-state selector — needed to know whether
   a click there is required, or landing on the page is enough.
3. A way back to the offers list from the detail page (a Back/X
   control, or `window.history.back()`), and that page's own route, so
   the route guard can recognize it.

**To finish this:** run discovery mode — `&ccoffers=debughtml` — on the
detail page itself (the one showing "Added to card"), and share that
dump back. Also worth a manual check: does tapping a *carousel* tile
navigate the same way, or stay on the offers page? Once the real flow
is known, `processCarousel()`/`processGrid()` need a second step added
— after the tile click navigates, find and click the actual Add button
(if not already added), then navigate back before the next tile —
rather than the current single-click-and-count logic, which assumes no
such step exists.

## One-time setup (do this first)

1. Install [**Userscripts**](https://apps.apple.com/us/app/userscripts/id1463298887)
   (free, open source, by quoid) from the App Store. Open it once.
2. **Settings → Safari → Extensions → Userscripts → Allow.** Under
   "Websites", set **All Websites → Allow** (needed for
   `secure.chase.com` and `global.americanexpress.com`).
3. Requires iOS 15.1+.

## Installing a script on iPhone

Userscripts has no on-device code editor on iOS, so scripts are installed
by URL, not pasted in:

1. In Safari, open the raw GitHub URL of the script, e.g.:
   `https://raw.githubusercontent.com/<you>/credit-card-offers/main/dist/amex-offers.user.js`
2. Tap the **aA** button in the address bar → **Userscripts** → an
   install prompt appears → confirm.
3. Repeat for `chase-offers.user.js`.

Future updates: push a new commit (the build step bumps `@version`
automatically), and the phone will pick it up on its own via
`@updateURL` — no reinstall needed.

## Running discovery mode

Both scripts click nothing when this is active — use it any time a
selector needs to be found or re-found (first setup, or after a bank
reskins its site):

- **Amex:** go to `https://global.americanexpress.com/offers`, switch to
  **Request Desktop Website** (aA button → Request Desktop Website),
  then append `#ccoffers=debug` to the end of the URL and reload.
- **Chase:** navigate to the merchant offers screen inside the Chase
  dashboard (desktop mode), then append `&ccoffers=debug` (if the URL
  already has a `#...` route) or `#ccoffers=debug` (if it doesn't) and
  reload.

Use `ccoffers=debughtml` instead of `ccoffers=debug` when a candidate's
*state* is conveyed by something other than text — an icon, a class, a
child element — since the plain dump only shows each candidate's own
text/aria-label/data-* attributes, not its markup. `debughtml` appends a
raw HTML snippet per candidate so that kind of thing becomes visible.

A text box will appear at the top of the page with every candidate
element found, grouped into:

- `add` — likely "Add to card" buttons
- `added-state` — likely already-added/expired indicators
- `pagination` — likely "load more" / "show more" controls
- `card-selector` — likely the card/account switcher
- `other` — everything else that was a button/role=button/select

**Copy that text and share it back** (long-press the text box → Select
All → Copy). That's what turns into the real click selectors in Phase 2.

If a bucket is empty or looks wrong, note the URL and route you were on
when the dump was empty — that's usually a sign the offers grid hadn't
finished loading yet (rare, since the script waits for the button count
to stabilize before dumping) or that the real controls don't match any
of the broad selectors in `discoverCandidates()` in `lib/core.js` (rare,
worth flagging).

## Repairing after a reskin

When a bank changes its site layout and the click logic in a later
phase stops working, the fix is the same discovery loop:

1. Re-run discovery mode on the broken page (see above).
2. Compare the new dump's `add` / `added-state` groups against what
   `src/chase.user.js` or `src/amex.user.js` currently match on.
3. Update the adapter's matching logic, then `node tools/build.mjs` and
   push.

## Development

```
lib/core.js       — shared helpers (single source of truth, edit here)
src/*.user.js      — issuer adapters, contain a `//= INLINE core` marker
tools/build.mjs    — inlines lib/core.js into src/*.user.js -> dist/*.user.js,
                     bumps @version automatically
dist/*.user.js     — generated, committed. This is what the phone installs
                     and updates from — never hand-edit these.
```

```
node tools/build.mjs
```

## Known limitations (v1, by design)

- Handles the currently-selected card only; switching cards on Chase
  re-triggers the script, but iterating every card on the account
  automatically is not implemented.
- Sessions still expire — you'll hit a login screen occasionally. That's
  expected; there's no unattended login.
- Not truly "scheduled" in the OS sense — pair with an iOS Shortcuts
  Personal Automation that opens both offer URLs on a timer, since
  Shortcuts' `Run JavaScript on Webpage` action can't run this itself
  (share-sheet only, and hard-times-out on multi-second loops).
