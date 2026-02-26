# Moving Estimates Implementation Specification
## Guardrails, Warnings, and Service Selection Logic

---

## 0. Goals (for your developer)

Update the move estimation system so that it:

1. **Blocks or clearly handles non-continental US moves**
2. **Flags likely storage needs** when move-out and move-in are far apart
3. **Uses a timing flexibility flag** to influence which services are shown (especially van lines)
4. **Uses external calculators** (like MoveBuddha) only as offline calibration, not as hard anchors
5. **Adds DIY / alternative options** (PODS, U-Haul links)
6. **Surfaces clear warnings and caveats** in the UI

**Note:** No concrete code needed; everything below is logic / pseudocode.

---

## 1. Request & Response Shape (Conceptual)

### 1.1 Input fields the backend should rely on

For each estimate request, the backend should have at least:

**Origin:**
- Postal code
- Country code (e.g., "US")
- State/region code (e.g., "CA", "AK")

**Destination:**
- Postal code
- Country code
- State/region code

**Dates:**
- Move-out date (old home)
- Move-in date (new home)

**Timing flexibility (NEW):**
One of:
- "exact dates only"
- "flexible ±3 days"
- "flexible ±7 days"

**Existing fields like:**
- Inventory estimate (weight or volume)
- Bedrooms or home size
- Any other fields you already use for estimates

### 1.2 What the backend should return (conceptually)

For each request, the backend should return:

- **Dedicated service estimate** (may be missing)
- **Van line estimate** (may be missing)
- **A list of warnings / messages** (for caveats, guardrails, etc.)
- **A list of DIY / alternative options** (e.g., U-Haul, PODS cards for the UI)

Think of it as:

```typescript
{
  dedicated: {
    low: number,
    high: number,
    // ... any meta
  },
  vanLine: {
    low: number,
    high: number,
    // ... any meta
  },
  warnings: [
    {
      severity: "error" | "warning" | "info",
      message: string
    }
  ],
  diyOptions: [
    {
      provider: string,
      label: string,
      url: string,
      description: string
    }
  ]
}
```

The exact structure/naming is up to the dev; this is conceptual.

---

## 2. Guardrail: Non-Continental US

### 2.1 Logic to determine if a location is in the continental US

Define **"continental US"** as:
- Country code is "US"
- State/region is NOT:
  - Alaska (AK)
  - Hawaii (HI)
  - Any US territories (e.g. Puerto Rico, Guam, USVI, etc.)

**Logic (pseudocode):**

```
If country != "US" → not continental.
If state is in {AK, HI} → not continental.
If state is in list of territories (PR, GU, VI, AS, MP, etc.) → not continental.
If state is unknown or missing → treat as not continental (conservative).
```

Apply this check to **both origin and destination**.

### 2.2 Behavior when either end is non-continental

**If origin OR destination is not in continental US:**

1. Do not calculate dedicated or van line estimates
2. Return no prices and a single **error-level warning**, with content equivalent to:

> We currently support estimates only within the continental United States (lower 48 states). For Alaska, Hawaii, territories, or international moves, please contact movers directly.

**Frontend behavior:**

When this error exists:
- Hide or disable the normal price estimate cards
- Show a prominent banner with that message instead

---

## 3. Storage Gap Detection

We want to flag (not necessarily price in) likely storage needs.

### 3.1 Calculate the gap

1. Convert move-out and move-in dates into date objects
2. Compute `gapDays = moveIn - moveOut` in calendar days (rounded)

### 3.2 Threshold

Use a **configurable threshold**, e.g. **7 days**.

**If `gapDays` is greater than this threshold:**

Add a **warning-level message**, e.g.:

> Your move-out and move-in dates are X days apart. Our estimate does not include storage costs, which may be required if belongings need to be held between homes.

**Notes:**
- This does not change the price for now
- It just warns the user and gives context

---

## 4. Timing Flexibility Flag

We want a simple flag for how flexible dates are, and use that to decide when van lines are appropriate.

### 4.1 UI input (frontend concept)

On the move form:

**Ask:** "How flexible are your move dates?"

**Possible options (radio buttons):**
- "I need these exact dates"
- "I'm flexible within ±3 days"
- "I'm flexible within ±7 days"

**Map these to internal values**, e.g.:
- `exact`
- `flexible_3days`
- `flexible_7days`

### 4.2 How the backend should use this

Define a boolean internally:

```
isFlexible = true if timing is flexible_3days or flexible_7days
isFlexible = false if timing is exact
```

Use this in decision logic, especially for van lines.

**Rule of thumb:**

If `distance >= 500 miles` AND `isFlexible is false` (exact dates only):
- Do not show van line estimates
- Return only dedicated estimate (if available)
- Add an **info-level note**:

> Van line services usually require flexible delivery windows. Based on your exact dates, we're showing dedicated options only.

This aligns more closely with real-world van line behavior.

---

## 5. Move Estimate Approach (Refactor Overview)

Separate the logic clearly for each service type.

### 5.1 Common pre-computation

Before pricing:

1. Compute **distance** between origin and destination (in miles)
2. Compute or retrieve **estimated weight**
3. Optionally compute or estimate **cubic feet**
4. Determine **cost-of-living tiers** for origin and destination (if you use them)
5. Determine whether the move:
   - Is **local** (<100 miles)
   - **Regional** (100–500 miles)
   - **Long-distance** (>500 miles)

Bundle these into a simple internal structure that both pricing functions can use.

### 5.2 Two separate pricing "engines"

Have two separate functions or logical modules:

1. **One for dedicated movers**
2. **One for van lines**

Each should:
- Take the original request + derived parameters
- Output:
  - A low estimate
  - A high estimate
  - Any internal breakdowns you need (linehaul, labor, fuel, etc.)

The exact math will come from your research doc (per-pound, per-mile, etc.), but the important structural idea is:

**Don't mix dedicated and van line formulas. Keep their formulas independent and configurable.**

### 5.3 External calculators (e.g., MoveBuddha)

**Important principle:**

Use external calculators ONLY to **calibrate your constants offline** (e.g. when updating config or building your spreadsheet).

**Do not:**
- Call them live as part of user pricing
- Try to match them 1:1, especially since you've seen big discrepancies (e.g. $8.3k vs $12k actual)

If you want to use them for sanity checks in logs, fine, but **the live customer estimate should be based on your own constants**.

---

## 6. Make Van Lines Cheaper Where They Should Be

We want to avoid situations where a long-distance van line estimate is more expensive than a dedicated mover, when all else suggests it should be cheaper.

### 6.1 Define scenarios where van lines "should" be cheaper

**Reasonable conditions:**
- **Distance:** ≥ 500 miles
- **Weight:** above a minimum viable van line threshold (e.g. ≥ 2000 lbs)
- **Timing flexibility:** user is flexible (`isFlexible = true`)

In these cases, real-world behavior usually has van lines cheaper than dedicated.

### 6.2 Simple post-processing guardrail

After you've computed both raw estimates:

1. Compute a midpoint for each:
   ```
   dedicatedMid = (dedicatedLow + dedicatedHigh) / 2
   vanMid = (vanLow + vanHigh) / 2
   ```

2. Compute `ratio = vanMid / dedicatedMid`

3. In the scenario described above (long distance, enough weight, flexible timing):
   - If `ratio` is **greater than or equal to 1** (van line more expensive or equal), adjust van line down a bit

**Example rule (conceptual, not code):**

Define a **maximum acceptable ratio** for these scenarios, e.g. **0.95**.

If `ratio > 0.95`, multiply both `vanLow` and `vanHigh` by a factor that brings the ratio down to 0.95.

**This is a safety valve, not your main pricing logic:**
- It keeps obviously wrong relationships from surfacing (van line being clearly more expensive than dedicated where it should not be)
- It doesn't try to enforce a perfect 20–40% gap at all times

---

## 7. DIY / Alternative Options (PODS, U-Haul, etc.)

You want to show DIY options as alternatives and add referral links.

### 7.1 When to suggest what (logic)

You can base this primarily on **distance**, and optionally on **weight**:

**For shorter moves (e.g. ≤ 300 miles):**
- Suggest **truck-rental options** (e.g., U-Haul):
  - "DIY truck rental"
  - Good if user is price-sensitive and willing to drive

**For medium-long moves (e.g. > 300 and ≤ 1500 miles):**
- Suggest **container options** (e.g., PODS):
  - Good when the user may need storage or flexible drop-off / pick-up

You can always show at least one DIY option if you want a "cheap alternative" module to always be present.

### 7.2 What the backend should output

For each DIY option, backend can provide:

- **Provider name** (e.g. "U-Haul", "PODS")
- **Display label** (short human-readable title)
- **URL** (where you can later plug referral links)
- **1–2 sentence description** explaining when it's a good fit

The frontend can render a small section after the main estimates:

**Title:** "Looking to save more? DIY options"

**Cards** for each provider, with a small disclosure:

> We may earn a referral fee if you book through these links. This doesn't change your price.

---

## 8. Webpage Caveats & Warning Behavior

You want better communication of limits and "gotchas".

### 8.1 Static disclaimer under estimates

**Always show a block like this under the price cards:**

> **Important:** These prices are estimates for standard residential moves within the continental U.S. Final quotes may differ based on your exact inventory, building access (stairs, elevators, long walks), parking/permits, specialty items (pianos, safes, etc.), and any storage needed between homes.

This is static and does not depend on warnings.

### 8.2 Dynamic warnings driven by backend

For each warning, the frontend should:

**Display a small banner or card, styled according to severity:**
- **error** → red / blocking
- **warning** → amber / caution
- **info** → blue / neutral note

**Examples:**

#### Non-continental
- **Error-level banner** across the top
- Hide estimates

#### Storage gap
- **Warning-level card** near the date info or below estimates
- **Content:**
  > Your move-out and move-in dates are X days apart. Our estimate does not include storage in between. Many customers in this situation use temporary storage or a container service (like PODS).

#### Timing flexibility limiting van lines
- **Info-level note** near the service cards
- **Content:**
  > Van line services usually require flexible delivery windows. Based on your exact dates, we're showing dedicated options only.

---

## 9. Implementation Checklist (Logic-Only)

You can give this to your dev as the "do these things" section:

### Inputs

✅ Ensure requests include:
- Origin/destination country and state
- Move-out and move-in dates
- Timing flexibility selection (exact / ±3 / ±7 days)

### Guardrails

✅ **Implement "is this in continental US?" logic:**
- If either end is not in continental US:
  - Do not run price calculations
  - Return a single error message and no estimates

✅ **Storage gap:**
- Compute days between move-out and move-in
- If above a threshold (e.g. 7 days), attach a warning about storage not being included

✅ **Timing flexibility:**
- Convert user's radio selection into a simple `isFlexible` flag
- For long-distance moves (e.g., ≥ 500 miles), if `isFlexible` is false:
  - Do not provide van line estimate
  - Add a message explaining van lines require flexible windows

### Pricing engine

✅ **Keep dedicated and van line formulas separated:**
- Derive shared parameters once (distance, volume, weight, CoL)
- Use your own configured constants, not external calculators, for the formulas
- Optionally log comparisons with external calculators for internal monitoring only

✅ **Van line vs dedicated relationship:**
- For long-distance, heavier, flexible moves, apply a guardrail:
  - Prevent van line midpoint from being higher than dedicated midpoint beyond a small margin (e.g., van line not more expensive than dedicated in these cases)

### DIY suggestions

✅ **Based on distance, select 0–2 DIY options** (e.g., U-Haul for short, PODS for medium-long)
- Return these as part of the response (provider name, label, URL, notes)

### Frontend

✅ **Add the timing flexibility radio group** on the form

✅ **Render:**
- Static disclaimer under estimates
- Warning cards based on backend warnings
- DIY options section with referral links
- Handle the non-continental error state by showing only the error message instead of prices

---

## Summary

This specification provides clear logical guardrails for:

1. **Geographic restrictions** (continental US only)
2. **Storage needs detection** (gap between move dates)
3. **Service availability logic** (van lines require flexibility)
4. **Pricing relationship validation** (van lines should be cheaper in appropriate scenarios)
5. **Alternative options** (DIY suggestions with referral links)
6. **User communication** (warnings, disclaimers, context)

The goal is to make estimates more realistic, communicate limitations clearly, and guide users toward the right service type for their specific situation.

---

## Related Documents

- [research-moving-cost-estimation.md](../research/research-moving-cost-estimation.md) - Research brief for pricing formula validation
- Current implementation: [DesktopMovePlanning.vue](../../movetrack-app/src/components/desktop/DesktopMovePlanning.vue)
