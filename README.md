# credit-card-offers

Zero-tap Chase/Amex "Add offer to card" clicking, run inside your own
already-signed-in Safari session on iPhone. No credentials are read,
stored, or transmitted anywhere — this only clicks buttons on a page your
browser already has open and authenticated.

Full design rationale and phased plan: see the plan this repo was built
from (ask the assistant that generated this repo if you need it again).

## Status: Phase 2 — Amex done, Chase carousel done, Chase grid paused

- **Amex** (`amex-offers.user.js`): fully automated. Clicks every
  `[data-testid="merchantOfferListAddButton"]` on the page. Already-added
  offers don't render that button at all, so no extra skip logic was
  needed — confirmed from a real discovery dump.
- **Chase carousel** (~18 personalized offers): fully automated.
  Confirmed via manual test that a tile click both adds the offer AND
  navigates to a detail page in one action (not two separate steps) —
  the script clicks the tile, waits to land back on the offers list via
  plain `history.back()` (confirmed working, same as Safari's own back
  gesture), then continues to the next tile.
- **Chase "All Offers" grid** (~107 offers): **still paused.** The
  click-and-return mechanics are identical to the carousel's and
  already implemented in `processGrid()` — it's just not called from
  `run()` yet. See below for why.

## Why the Chase grid is still paused

The click mechanism itself is no longer in question — confirmed by
manual test that a grid tile click adds the offer and lands on the
same kind of detail page as the carousel. What's still unresolved:
**telling an already-added grid tile apart from an addable one.**
Chase marks that state with a plain green checkmark icon and no text
change, confirmed by looking at one — unlike the carousel, where the
tile's own "Add Offer" label is a reasonable (if not yet directly
observed) signal that disappears once used, the same way Amex's Add
button disappears. There's no equivalent signal on the grid tile's
text or aria-label to key off of.

Re-clicking an already-added tile is *probably* harmless — Chase's
overall pattern for "already added" looks like a read-only
confirmation rather than a toggle, and there's no evidence anywhere of
a remove/undo action — but that's an inference, not a confirmed
observation, and the same standard applied to the click mechanism
itself before enabling it applies here too.

**To finish this**, one of:
- Confirm whether tapping an already-checkmarked grid tile's detail
  page offers any way to remove/undo the offer (if not, it's safe to
  enable and accept the minor inefficiency of occasionally re-clicking
  an already-added tile), or
- Run discovery mode with `&ccoffers=debughtml` on the grid list view
  while a checkmarked tile is visible, to find the checkmark's actual
  markup and add a real detection check to `isGridAddableTile()`.

Either way, once resolved, add `var gridResult = await processGrid(guard, t);`
in `run()` in place of the paused stub.

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
