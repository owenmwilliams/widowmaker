# Build: Nexus Moves — Move Plan (print + web)

Implement the **customer-facing Move Plan** — the plan a customer uses to decide *how* to move, and hands to a partner, parent or mover. Sibling of the Mover Inventory document; same rules. Reference design: `Move Plan.dc.html`. It must render as a clean on-screen page **and** print/export to PDF on US Letter with no browser chrome.

Consume the existing Nexus Moves design system — link `styles.css` and use **semantic tokens only** (`--accent`, `--surface-card`, `--text-primary`, `--border`, `--shimmer`, `--beacon`, `--warning-*`). No hard-coded hex/px in feature code. Light theme (`[data-theme="light"]`).

**Two readers, one page.** The customer planning the move, and whoever they hand it to. Write for both: no internal jargon, every number labelled, handling notes a stranger could follow.

**Voice.** Honest numbers, first person plural is fine ("we recommend a 20-ft truck"). This document helps the customer **decide** — it never sells or guarantees. `~`/`≈` on estimates; every cost is a **range** and every range says "estimated". No fake certainty.

---

## 1. Data contract

The document is generated from one move-plan payload (the move record + estimate engine). Shape it as:

```ts
type MovePlan = {
  customerName: string;                 // "Owen" -> title "Owen's move"
  generatedAt: string;                  // ISO; display "Generated Jul 4, 2026"
  moveWindow: { start: string; end?: string } | null; // range -> "Aug 15–18, 2026"; single -> "Aug 16, 2026"; null -> "Aug 2026 · TBD"

  origin: Place;                        // always known
  destination: Place | null;            // null -> "Destination pending" empty state

  trip: {
    distanceMiles: number | null;       // null when destination pending
    driveDays: number;                  // 4
    overnights: number;                 // 3
    kind: 'road' | 'local';             // 'local' hides the leg list, shows the one-trip card
    legs: Leg[];                        // ordered; empty for local / pending
  };

  truck: {
    size: string;                       // "20-ft truck"
    capacityCuFt: number;               // 1000
    maxLoadLbs: number;                 // 6000
    cataloguedCuFt: number;             // 183  -> drives the fill bar
    reasoning: string;                  // buffer explanation, honest about partial catalogue
  };

  labor: { loadHrs: string; unloadHrs: string; crew: string; note: string }; // "~5 hrs" / "2–3"

  cost: {
    pending: boolean;                   // true when destination unknown -> cost empty state
    diy: CostPath;                      // truck rental, fuel, labor, lodging, equipment
    pro: CostPath;                      // dedicated movers / van line
    note: string;                       // assumptions + "not a bill"
  };

  special: SpecialItem[];               // oversized / heavy / fragile, from the inventory
  rollup: {
    items: number;                      // 484
    estWeightLbs: number;               // 1200
    volumeCuFt: number;                 // 183
    specialCount: number;               // 6
    boxesPacked: number;                // 34
    boxesToPack: string;                // "~90"
    note: string;                       // honest "partial pass" caveat + pointer to Inventory
  };
};

type Place = {
  city: string;                         // "San Francisco, CA"
  line: string;                         // "1669 Turk Street · 94115 · “SF APT”"
  access: string[];                     // ["3rd floor · no elevator", "Narrow interior stairwell", ...]
};                                       // stairs / elevator / parking / entry notes, as short chips

type Leg = {
  from: string; to: string;             // city labels
  miles: string;                        // "283 mi" (segment distance, from previous stop)
  overnight?: string;                   // "Night 1" -> renders the moon "overnight" pill on the destination city
  arrive?: boolean;                     // last leg -> beacon dot + "Arrive" pill
};

type CostPath = {
  name: string;                         // "Rent & drive it yourself" / "Hire a full-service mover"
  tag: string;                          // honest trade-off, not a verdict: "Usually lower cost" / "Least effort"
  range: string;                        // "$3,100–$4,500" — ALWAYS a range
  best: string;                         // "Best if …" one-liner
  lines: { label: string; detail: string; amt: string }[]; // amt is a range OR "Included"
};

type SpecialItem = {
  name: string; weightLbs: number;      // 250
  flag: 'oversized' | 'heavy' | 'fragile';
  note: string;                         // plain-language handling: "2 people + dolly. Keep upright, tape doors shut."
};
```

**Derived, not stored — compute in the view:**
- `truck.fillPct = round(cataloguedCuFt / capacityCuFt * 100)` for the capacity bar. Label the fill "N cu ft catalogued" and the remainder "buffer for uncatalogued rooms" — the buffer is the point, so never present the small fill as "over-sized."
- `special`: pull from the inventory where `flags` includes oversized/heavy/fragile OR `weightLbs >= 65`. Sort oversized → heavy → fragile, weight desc. Cap ~6.
- `boxesPct = round(boxesPacked / (boxesPacked + boxesToPack) * 100)`.
- Cost totals are **provided as ranges** by the estimate engine — the view never sums line items into a single confident number.

---

## 2. Page structure (top to bottom)

1. **Running header** (repeats every printed page): Nexus mark + "Nexus Moves" wordmark (Bricolage) left; mono eyebrow "MOVE PLAN · YOUR PLANNING COPY" right; hairline `--border` bottom.
2. **Title block:** mono eyebrow "MOVE PLAN"; H1 `{customerName}'s move`; sub "Generated {date} · A planning copy — every figure here is an estimate"; right-aligned "MOVE WINDOW / {window}".
3. **Trip summary card:** three columns — **Leaving from** (origin city + line + access chips) · **distance** (dashed arrow + `{distanceMiles} mi` + "DRIVING · N DAYS") · **Heading to** (destination, beacon dot, access chips). Access chips = short mono pills for stairs / elevator / parking / entry. If `destination === null`: muted "Destination pending" with beacon dot, "distance pending" in the middle, and a one-line prompt to set it.
4. **Honest promise banner** (`--warning-surface` cream card, `--warning-ink`): alert-triangle, "Every figure here is an estimate to help you decide", body making the no-quote/no-guarantee promise explicit. Always shown.
5. **What it might cost** — the heart. Two side-by-side cards, **DIY** (truck icon) vs **Professional** (crew icon). Each: icon + name + honest trade-off pill; big **range** (Bricolage); "ESTIMATED TOTAL"; line-item breakdown (label / mono detail / mono amount, amount may be "Included"); "Best if …" footer on a sunk `--surface-sunk` strip. Below both: a mono-dot note with assumptions + "treat them as a starting point, not a bill." When `cost.pending`: replace both cards with a single dashed empty-state card.
6. **Recommended truck + Labor & crew** — two cards side by side.
   - *Truck:* "WE RECOMMEND" eyebrow, big `{size}` + capacity, the two-segment shimmer capacity bar (catalogued vs buffer), honest buffer reasoning.
   - *Labor:* three figures (Loading / Unloading / Crew — crew in `--accent`), then the heavy-item + walk-up note.
7. **The drive** — road-trip: a card with a summary row (`{miles}` driving / `{days}` on the road / `{nights}` overnights) then the ordered leg list (dot · "From → To" + overnight pill + arrive pill · segment miles), closing with a beacon-dot pacing note. Local move: a single "one trip across the bay" card (origin dot → beacon dot, distance + same-day blurb) — **no leg list**. Pending: a dashed empty-state card. This section is empty for local/pending by design — those states are common; design them, don't hide the heading.
8. **Special handling** — 2-up cards: big weight + "LBS", item name + flag pill (Oversized = amber tint, Heavy = blue tint, Fragile = cyan tint), plain-language handling note. "Anyone loading the truck should read this first."
9. **What we're moving** — 4-up rollup tiles (Items / Est. weight / Volume / Special handling; tile 1 = shimmer top-bar, tile 4 = beacon, others `--accent`), then a **boxes packed vs to-go** shimmer bar, then the honest "partial pass" caveat pointing to the Mover Inventory.
10. **Running footer** (repeats): "Estimates only · not a quote or a guarantee" / "Nexus Moves".
11. **Closing line:** small mark + "Built with Nexus Moves to help you plan — not a quote."

---

## 3. Type, color, spacing

- **Bricolage Grotesque:** H1/H2, cost ranges, big numbers, wordmark. **System stack:** all body + line-item + card text (UI body floor 15px on native; this print doc runs body ~12.5px, which is acceptable for a printed page). **JetBrains Mono:** eyebrows, access chips, column/stat labels, distances, amounts, counts.
- Ink `--text-primary` (#16204A), secondary `--text-secondary` (#5A6379), tertiary `--text-tertiary` (#8A92A6). Accent `--accent` (#4F5BF0). **Shimmer** appears only on: the truck capacity bar, the boxes-packed bar, and the Items rollup tile top-bar (intelligence signal). **Beacon** (#F98D5B) only on: the destination dot, the "Arrive" node in the route, and the Special-handling rollup tile bar — one warm spark, never body UI. No other hues; flag pills reuse the system's amber / blue / cyan tints only.
- Cards: `--surface-card` white, 1px `--border` hairline, radius 14–18px, `--shadow-sm`. Sunk strips `--surface-sunk`. Empty states: 1px **dashed** `#C7D0E4` on `--surface-sunk`. No colored left-border accent cards.
- 4px spacing grid; section gaps ~26px.

---

## 4. Print / PDF requirements

- Target **US Letter, ~0.55in margins**. Inject `@page { size: letter; margin: 0 }` and put the inset on the sheet padding so the browser draws **no** date/URL/page-number chrome. (Reference uses the `doc-page` web component, which does exactly this — port that approach or use your own print CSS.)
- Header/footer repeat on every page (`position: fixed`, or a single-cell table with repeating `<thead>`/`<tfoot>` spacers).
- `break-inside: avoid` on: the trip card, honest banner, each cost card, truck/labor cards, the route card, special-handling cards, rollup tiles. `break-after: avoid` on section headings so a heading never orphans above a break. Cost/route line lists may break between rows.
- `orphans: 3; widows: 3;` on body text.

## 5. Options / config (props on the reference)

- `scenario: 'road-trip' | 'local' | 'destination-pending'` — drives which sections populate vs. show their empty state. **`road-trip`** = full (distance, legs, both cost paths). **`local`** = short distance, one-trip route card, local cost paths (day-rate truck / hourly crew, no lodging). **`destination-pending`** = no destination → trip distance, route and cost paths show designed empty states; truck, labor, special handling and rollup still render (they don't need a destination). Ship all three — the empty states are common, not edge cases.
- `costPath: 'both' | 'diy' | 'pro'` — show both cost cards or a single decided path.
- `showBreakdown: boolean` — expand/collapse the cost line-items (some readers just want the two totals).

## 6. Accessibility & correctness

- Decorative SVGs `aria-hidden`. AA contrast (the cream banner + warning-ink pair passes; the amber/blue/cyan flag pills pass on their tints).
- **Honest-numbers rule (enforce in review):** never present a single confident total — costs are ranges labelled "estimated". Never imply a guarantee. Keep the "not a quote" promise banner and footer. Pair every number with what it means. Be honest about the partial inventory wherever totals appear (truck sizing, weight, cost).

## 7. Definition of done

Renders on screen and prints to a clean multi-page Letter PDF with repeating header/footer and no browser chrome; all three `scenario` states render without layout breakage (verified: road-trip, local, destination-pending); both cost paths show as ranges labelled estimated, never a single total; special-handling notes are legible to a stranger; long inventory collapses to the rollup + a pointer to the Mover Inventory; all colors/fonts/radii resolve to design-system tokens; `costPath` and `showBreakdown` options work; matches `Move Plan.dc.html`.
