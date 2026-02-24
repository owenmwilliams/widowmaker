# Moving Cost Estimation Research Brief

## Objective
Develop accurate pricing algorithms for two distinct moving service types:
1. **Dedicated Movers** (dedicated truck and crew)
2. **Van Lines** (consolidated/shared truck service)

## Current Problem
Our van lines estimates are showing **higher** costs than dedicated movers, which is incorrect. Van lines should typically be 20-40% cheaper for long-distance moves, though with trade-offs (longer delivery windows, less control over timing).

### Example Issue
**Current Output (500mi, 3,018 lbs):**
- Dedicated: $4,668 - $6,737
- Van Lines: $7,326 - $9,158

**Expected Output:**
- Dedicated: $5,000 - $7,500
- Van Lines: $3,500 - $5,500

---

## Research Tasks

### 1. Dedicated Movers Pricing Structure

#### Questions to Answer:
- **Local moves (<100 miles):**
  - What is the standard hourly rate structure? (crew size + truck)
  - Typical hourly rates by region (low/medium/high CoL)
  - Minimum hours charged?
  - Travel time charges?
  - Fuel surcharges for local moves?

- **Long-distance moves (100-500 miles):**
  - Pricing model: hourly, flat rate, weight-based, or hybrid?
  - Typical per-mile rates?
  - Weight-based pricing thresholds?
  - How do they calculate "cubic feet" vs actual weight?
  - Overnight/multi-day premiums?

- **Very long distance (>500 miles):**
  - Industry standard: weight-based or volume-based?
  - Typical rate per pound or per cubic foot?
  - Distance multipliers?
  - Do they use different models than 100-500 mile moves?

#### Additional Factors:
- Packing services: separate line item or bundled?
- Materials markup: what % over retail?
- Access difficulty surcharges (stairs, long carry, elevator out)
- Multi-stop premiums
- Expedited/guaranteed delivery premiums
- Insurance/valuation coverage (basic vs full)

#### Data Sources:
- [ ] moving.com cost calculator analysis
- [ ] MoveBudda.com cost guides
- [ ] Consumer Affairs reviews with pricing data
- [ ] BBB complaint data (actual prices vs estimates)
- [ ] Reddit r/moving recent price reports
- [ ] Angi/HomeAdvisor cost guides (if accessible)
- [ ] Moving company websites (Allied, Atlas, North American, United)

---

### 2. Van Lines Pricing Structure

#### Questions to Answer:
- **Distance thresholds:**
  - Minimum distance for van line service? (250mi, 500mi, 1000mi?)
  - Do they serve <500 mile moves at all?
  - Regional vs long-haul pricing differences?

- **Chargeable weight calculation:**
  - Industry standard: actual weight vs volumetric weight (X lbs/cu ft)?
  - What is the standard lbs/cu ft conversion? (we use 7, is this correct?)
  - How do they measure cubic feet? (professional vs customer estimate)
  - Minimum weight charges?

- **Tariff structure:**
  - Base linehaul rate per pound by distance tier
  - Typical rates: <1000mi, 1000-2000mi, >2000mi
  - Fuel surcharge: percentage of linehaul or flat rate?
  - Current industry fuel surcharge % (we use 12%, is this accurate?)

- **Mandatory fees:**
  - Origin services (pickup, loading): how priced?
  - Destination services (delivery, unloading): flat rate or per-lb?
  - Shuttle fees: when charged and typical amounts?
  - Long carry fees: distance thresholds and rates?
  - Elevator/stair fees: different from dedicated movers?
  - Storage-in-transit (SIT): how priced?

- **Delivery windows:**
  - Industry standard spread by distance (e.g., 500mi, 1000mi, 2000mi)
  - Expedited/guaranteed delivery: cost premium?
  - Peak season adjustments (May-September)?

#### Additional Factors:
- Packing services: do van lines offer, or separate service?
- Third-party packing: common practice?
- Binding vs non-binding estimates: pricing differences?
- Valuation coverage: included or add-on?
- Minimum shipment weight for van lines?

#### Data Sources:
- [ ] American Moving & Storage Association (AMSA) guidelines
- [ ] Federal Motor Carrier Safety Administration (FMCSA) tariff database
- [ ] moverescue.com van line comparison tool
- [ ] Van line company websites (Allied, Atlas, Mayflower, North American, United, Wheaton)
- [ ] moving.com van line cost guides
- [ ] Reddit r/moving van line price reports (last 12 months)
- [ ] MoveBudda van line quotes database (if accessible)

---

### 3. Decision Tree & Guardrails

#### When to Show Each Option:

**Research Questions:**
- At what distance does van line become cheaper?
- At what weight/volume does van line become viable?
- Do van lines serve multi-stop moves? (we currently hide them for multi-stop)
- Geographic restrictions: rural areas, Alaska, Hawaii, international?
- Storage needs: does this affect the calculation?
- Timing flexibility: when should we recommend van vs dedicated?

#### Create Decision Matrix:
For each combination, determine which services to show:

| Distance | Weight | Stops | Timing | Recommended Service(s) |
|----------|--------|-------|--------|----------------------|
| <100mi   | Any    | Any   | Any    | ? |
| 100-250mi| <2000lb| 1     | Flexible| ? |
| 100-250mi| >2000lb| 1     | Flexible| ? |
| 250-500mi| <2000lb| 1     | Flexible| ? |
| 250-500mi| >2000lb| 1     | Flexible| ? |
| >500mi   | <2000lb| 1     | Flexible| ? |
| >500mi   | >2000lb| 1     | Flexible| ? |
| Any      | Any    | 2+    | Any    | ? |
| >1000mi  | Any    | 1     | Rush   | ? |

Fill in: "Dedicated only", "Van line only", "Both (show comparison)", "Both (show dedicated as premium)"

---

### 4. Cost Formula Validation

#### Current Dedicated Formula (Long Distance):
```
Base rate per pound: $1.00-$2.50 (varies by distance)
OR
Base rate per cu ft: $8-$12 (varies by distance)
Multiplier: 0.85 (low) to 1.25 (high)
```

**Validate:**
- [ ] Is weight-based or volume-based more accurate?
- [ ] Are these per-unit rates realistic for 2024-2025?
- [ ] Should we use different formulas for different distance ranges?
- [ ] What's the industry standard range width? (we use 0.85-1.25 = 47% spread)

#### Current Van Line Formula:
```
Chargeable weight: max(actual weight, volume * 7 lbs/cu ft)
Linehaul rate: $0.75-$1.00/lb (varies by distance)
+ Fuel surcharge: 12% of linehaul
+ Destination labor: $0.25/lb
+ Shuttle fee: $750 (if high CoL)
Multiplier: 1.00 (low) to 1.25 (high)
```

**Validate:**
- [ ] Is $0.75-$1.00/lb realistic for linehaul?
- [ ] Is 12% fuel surcharge accurate (2024-2025)?
- [ ] Is $0.25/lb for destination labor correct?
- [ ] Should shuttle fee be distance-dependent?
- [ ] What's the realistic range spread for van lines?

---

### 5. Regional & Seasonal Adjustments

#### Cost of Living (CoL) Multipliers:
**Current approach:** We apply a CoL multiplier (0.85-1.35) to both dedicated and van line costs.

**Research:**
- [ ] Do van lines typically adjust for CoL, or do they use fixed tariffs?
- [ ] Are origin or destination CoL more important?
- [ ] Do van lines have different rates for major metro areas?
- [ ] Should we apply CoL differently to linehaul vs services?

#### Seasonal Pricing:
- [ ] What is the typical peak season surcharge? (May-September)
- [ ] Do van lines have different seasonal adjustments than dedicated?
- [ ] Should we build season into our algorithm?
- [ ] Holiday/weekend premium pricing?

---

### 6. Competitor Analysis

#### Moving Company Calculators:
Analyze how these estimate costs:

- [ ] **moving.com** - test 3 scenarios (250mi, 500mi, 1000mi)
- [ ] **MoveBudda** - compare dedicated vs van line quotes
- [ ] **Pods.com** - container service (alternative benchmark)
- [ ] **U-Pack** - you-pack-they-drive (alternative benchmark)
- [ ] **Allied Van Lines** - get online quote
- [ ] **Atlas Van Lines** - get online quote
- [ ] **United Van Lines** - get online quote

**Test Scenarios:**
1. **Short-medium (250mi, 2000lb, 1BR apartment)**
2. **Medium-long (500mi, 4000lb, 2BR home)**
3. **Long distance (1200mi, 8000lb, 3BR home)**

Record:
- Dedicated mover estimate (if shown)
- Van line estimate (if shown)
- Which service they recommend
- Delivery window for van line
- Any mandatory fees shown

---

### 7. Key Pricing Components Breakdown

Create a comprehensive list of all potential charges:

#### Dedicated Movers:
- [ ] Base labor rate (hourly or flat)
- [ ] Travel time/mileage
- [ ] Fuel surcharge
- [ ] Packing labor
- [ ] Packing materials (itemized)
- [ ] Furniture disassembly/assembly
- [ ] Stairs/elevator fees
- [ ] Long carry
- [ ] Heavy/specialty items (piano, safe, etc.)
- [ ] Appliance servicing
- [ ] Valuation/insurance
- [ ] Expedited delivery
- [ ] Weekend/holiday premium
- [ ] Multi-stop fee
- [ ] Storage-in-transit
- [ ] Deposit/booking fee

#### Van Lines:
- [ ] Linehaul transportation (per lb or cu ft)
- [ ] Fuel surcharge (% or flat)
- [ ] Origin services (loading)
- [ ] Destination services (unloading)
- [ ] Shuttle/long carry
- [ ] Stairs/elevator
- [ ] Heavy/bulky item fees
- [ ] Packing services (often separate company)
- [ ] Packing materials
- [ ] Valuation/insurance
- [ ] Expedited/guaranteed delivery
- [ ] Storage-in-transit (SIT) - first X days free?
- [ ] Multi-stop (if offered)
- [ ] Peak season surcharge
- [ ] Minimum weight charge

---

### 8. Quality & Reliability Factors

#### Industry Standards:
- [ ] What defines a "reputable" van line vs broker?
- [ ] FMCSA licensing requirements
- [ ] AMSA ProMover certification significance
- [ ] BBB rating correlations with pricing

#### Customer Expectations:
- [ ] What do customers value more: price or reliability?
- [ ] When do customers choose dedicated over van line (even if pricier)?
- [ ] What are common van line complaints? (price changes, delays)
- [ ] Should we factor "hidden fee" risk into estimates?

---

## Deliverables

### 1. Pricing Formula Recommendations

Create a detailed document with:

```markdown
## Dedicated Movers Formula

### Local Moves (<100 miles)
- Base rate: $___/hour for ___-person crew
- Minimum hours: ___
- Travel time: $___/hour
- Fuel surcharge: $___/mile or ___%
- Typical range: low = ___%, high = ___%

### Regional Moves (100-500 miles)
- Pricing model: [hourly/flat rate/weight-based/volume-based]
- Base rate: $___ per [lb/cu ft/mile]
- Additional fees: [list]
- Typical range: low = ___%, high = ___%

### Long Distance (>500 miles)
- Pricing model: [weight-based/volume-based]
- Base rate: $___ per [lb/cu ft]
- Distance tiers: [if applicable]
- Additional fees: [list]
- Typical range: low = ___%, high = ___%

## Van Lines Formula

### Minimum Criteria
- Minimum distance: ___ miles
- Minimum weight: ___ lbs
- Maximum stops: ___

### Base Pricing
- Chargeable weight calculation: max(actual weight, volume × ___ lbs/cu ft)
- Linehaul rates:
  - <1000mi: $___/lb
  - 1000-2000mi: $___/lb
  - >2000mi: $___/lb

### Mandatory Fees
- Fuel surcharge: ___% of linehaul (or $___/lb)
- Origin services: $___ (flat) or $___/lb
- Destination services: $___ (flat) or $___/lb

### Conditional Fees
- Shuttle fee: $___ (when: ___)
- Long carry: $___ per ___ feet beyond ___ feet
- Stairs: $___ per flight beyond ___ flights
- Elevator service: $___ (if not available)
- Storage-in-transit: $___/day after ___ days free

### Delivery Windows
- <500mi: ___-___ days
- 500-1000mi: ___-___ days
- 1000-2000mi: ___-___ days
- >2000mi: ___-___ days

## Decision Logic

Distance < 100mi → Dedicated only
Distance >= 100mi AND < 250mi → [Both/Dedicated/Van line]
Distance >= 250mi AND single-stop → Both (show comparison)
Distance >= 250mi AND multi-stop → [Both/Dedicated only]
Weight < ___lb AND distance >= 500mi → [Both/Dedicated only/Van line only]

## CoL Adjustments
- Origin CoL weight: ___%
- Destination CoL weight: ___%
- Apply to: [all fees/linehaul only/services only]

## Seasonal Adjustments
- Peak season (May-Sept): ___% surcharge
- Applied to: [all services/van lines only/dedicated only]
```

### 2. Comparison Matrix

Excel or Google Sheets with:
- Columns: Distance, Weight, Volume, CoL multiplier
- Rows: Different move scenarios
- For each scenario:
  - Dedicated low/high estimates
  - Van line low/high estimates
  - Industry benchmarks (from competitor analysis)
  - Our algorithm output (before fixes)
  - Our algorithm output (after fixes)
  - Variance from industry benchmarks

### 3. Citations & Sources

Document with:
- All sources consulted
- URLs and access dates
- Key quotes and data points
- Credibility assessment of each source
- Industry expert contacts (if any)

### 4. Edge Cases & Warnings

Document listing:
- Scenarios where our algorithm may fail
- When to show warnings to users
- Disclaimer language recommendations
- Regulatory compliance notes (FMCSA, state-specific)

---

## Timeline

**Phase 1 (Day 1-2):** Dedicated movers research
**Phase 2 (Day 3-4):** Van lines research
**Phase 3 (Day 5):** Competitor analysis
**Phase 4 (Day 6):** Formula recommendations
**Phase 5 (Day 7):** Documentation and matrix creation

---

## Notes & Clarifications

### Current Algorithm Issues Identified:
1. Van lines showing higher costs than dedicated
2. Fuel surcharge (12%) may be too high
3. Destination labor ($0.25/lb) may be too high
4. Shuttle fee ($750) may be applied too broadly
5. Van line high-end multiplier (1.25) may be creating too wide a range

### Questions for Product Team:
- Should we show both options and let users choose?
- Should we add "time flexibility" as a user input?
- Should we show "price vs speed" comparison visually?
- Do we need to account for insurance/valuation differently?

### Assumptions to Validate:
- Van lines are 20-40% cheaper for >500mi moves (is this true?)
- Dedicated movers offer more flexible scheduling (is this valued?)
- Most customers don't understand van line trade-offs (delivery window)
- Packing services are similar cost between both (true?)

---

## Research Tips

1. **Use incognito/private browsing** when getting quotes to avoid tracking
2. **Use realistic scenarios** (don't test with 100lb or 50,000lb extremes)
3. **Screenshot all calculator results** for documentation
4. **Note the date** - moving prices fluctuate seasonally
5. **Check multiple zip codes** for CoL validation
6. **Look for PDF tariff schedules** on van line websites (often in footer)
7. **Search for "moving broker vs van line"** to understand industry structure
8. **Review recent Reddit posts** (last 3-6 months) for real-world pricing

## Contact

Questions or need clarification? Contact: [Your name/email]
