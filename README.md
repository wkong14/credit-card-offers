# credit-card-offers

Zero-tap Chase/Amex "Add offer to card" clicking, run inside your own
already-signed-in Safari session on iPhone. No credentials are read,
stored, or transmitted anywhere — this only clicks buttons on a page your
browser already has open and authenticated.

Full design rationale and phased plan: see the plan this repo was built
from (ask the assistant that generated this repo if you need it again).

## Status: Phase 2 — both issuers fully automated

- **Amex** (`amex-offers.user.js`): clicks every
  `[data-testid="merchantOfferListAddButton"]` on the page. Already-added
  offers don't render that button at all, so no extra skip logic was
  needed — confirmed from a real discovery dump.
- **Chase** (`chase-offers.user.js`): automates both surfaces — the
  personalized carousel (~18 offers) and the full "All Offers" grid
  (~107 offers). Confirmed via manual test that a tile click both adds
  the offer AND navigates to a detail page in one action (not a
  separate Add button to hunt for). The script clicks the tile, waits
  to land back on the offers list via plain `history.back()` (confirmed
  working, same as Safari's own back gesture), then continues to the
  next tile.

## Known imprecision: Chase grid already-added detection

Chase marks an already-added *grid* tile with a plain green checkmark
icon and no text change (confirmed by looking at one) — unlike the
carousel, where the tile's own "Add Offer" label is a reasonable (if
not directly observed) signal that disappears once used, the same way
Amex's Add button disappears. There's no equivalent text signal on the
grid tile to key off of, so `isGridAddableTile()` can occasionally
re-click an already-added tile.

This is accepted as-is rather than fixed further: confirmed via manual
check that an already-added tile's detail page offers no remove/undo
option, so the worst case is a harmless redundant round-trip (an extra
navigate + click + back cycle) and a slightly inflated "added" count —
not a real risk to anything already on the card. If a real detection
check is ever wanted, run discovery mode with `&ccoffers=debughtml` on
the grid list view while a checkmarked tile is visible to find its
actual markup, and add a matching check to `isGridAddableTile()` in
`src/chase.user.js`.

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
