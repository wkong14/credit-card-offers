# credit-card-offers

Zero-tap Chase/Amex "Add offer to card" clicking, run inside your own
already-signed-in Safari session on iPhone. No credentials are read,
stored, or transmitted anywhere — this only clicks buttons on a page your
browser already has open and authenticated.

Full design rationale and phased plan: see the plan this repo was built
from (ask the assistant that generated this repo if you need it again).

## Status: Phase 2 — live, partially

- **Amex** (`amex-offers.user.js`): fully automated. Clicks every
  `[data-testid="merchantOfferListAddButton"]` on the page. Already-added
  offers don't render that button at all, so no extra skip logic was
  needed — confirmed from a real discovery dump.
- **Chase** (`chase-offers.user.js`): automates the personalized
  carousel only (~18 offers, tiles whose label ends in "Add Offer").
  The big "All Offers" grid (~107 offers) is **not automated** — those
  tiles have no separate Add button anywhere in the DOM, and it's not
  yet known whether clicking one adds inline or navigates to a detail
  page with a different button. Automating that blindly risks clicking
  the wrong thing on a live bank account, so it's deliberately left
  alone until confirmed. See "Resolving the Chase grid" below.

The carousel automation is written to be resumable (progress tracked in
`sessionStorage`) specifically because that navigate-vs-inline question
was still open when it was built — so it degrades safely either way
rather than assuming one behavior.

## Resolving the Chase grid

To finish Chase, one manual observation is needed: on the merchant
offers screen, tap **one** "All Offers" grid tile that has no "Add
Offer" text (e.g. one showing just `"N of 107 <merchant> X% cash
back"`) — a normal tap, not through the script — and note:

- Does a separate page or modal open with its own distinct "Add to
  card" button, or does the tile itself just update in place to show
  it's been added?
- If a new page/modal opens: what does its URL hash become, and can you
  run discovery mode there too (`&ccoffers=debug` appended) to dump its
  Add button's selector?

Report that back and the grid can be automated the same way as the
carousel.

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

Both scripts are inert by default. To make them dump candidates:

- **Amex:** go to `https://global.americanexpress.com/offers`, switch to
  **Request Desktop Website** (aA button → Request Desktop Website),
  then append `#ccoffers=debug` to the end of the URL and reload.
- **Chase:** navigate to the merchant offers screen inside the Chase
  dashboard (desktop mode), then append `&ccoffers=debug` (if the URL
  already has a `#...` route) or `#ccoffers=debug` (if it doesn't) and
  reload.

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
