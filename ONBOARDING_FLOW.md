# Mobile/Desktop Onboarding Flow

The goal is to capture just enough structured data for a brand-new user to start cataloging items within a few minutes. Below is a skeleton of the 5 screens we discussed. Each section lists the core UI elements, data captured, and navigation targets we can flesh out later.

---

## 1. Welcome
- **Hero copy:** “Catalog your entire home in minutes.”
- **Primary CTA:** `Get Started`.
- **Support text:** Two short bullets about AI descriptions + QR-ready boxes.
- **Analytics hook:** track CTA tap.

> *No inputs here—just motivation.*

---

## 2. Profile & Intent
- **Field:** Name (text input).
- **Pill group:** “What brings you here?” → Protect / Move / Insurance / Other.
- **Pill group:** “Home type?” → Studio / 2BR / House / Estate.
- **Primary CTA:** `Next`.

> Store `name`, `goal`, `home_size`. Pills behave as toggles; everything else optional.

---

## 3. Spaces & Locations *(key page → design emphasis)*
- **Title:** “Where are we starting?”
- **Fields:**
  - Location Nickname (text, e.g., “Seattle Home”).
  - Optional address search (Autocomplete shell).
- **Room selector:** grid of pill toggles for Kitchen, Living Room, Bedroom, Garage, Storage, Office, Other. Tapping converts into editable chips (inline pencil icon).
- **Helper text:** explain that rooms drive scanning suggestions and truck zones.
- **Primary CTA:** `Save base location`.
- **Secondary:** `Skip for now`.

> Data: create primary location + default collections per selected rooms.

---

## 4. Log Your First Item
- **Platform check:**
  - **Mobile:** Title “Log your first item.” One large CTA `Start Single Item Capture` → launches existing mobile capture flow (auto-enables AI descriptions). Brief tip list beneath.
  - **Desktop:** Title “Already have an inventory?” CTA `Upload your spreadsheet`. Provide bullet list of required columns + note about upcoming smart field matching (placeholder dialog).
- **Secondary link:** `Not ready? Add a location instead.` (backs to CTA trio below).

> No new APIs yet—just wiring to existing capture/import stubs.

---

## 5. Next Steps Dashboard
- **Progress pill:** “0 of 150 items logged” (estimate derived from profile).
- **Three equal buttons:**
  1. `Add another location` → opens location modal.
  2. `Add another item` → single capture flow.
  3. `Add multiple items` → multi-item capture queue.
- **Optional checklist:** “Print QR sheet”, “Invite helper” (future toggles).

> Once they choose one path, persist progress and suppress onboarding screens on next login.

---

### Implementation Notes
- Route namespace idea: `/onboarding/welcome`, `/onboarding/profile`, etc., guarded by `hasCompletedOnboarding`.
- Persist partial data after each step (localStorage + API).
- Provide skip links but default to walking straight into logging the first item so users experience success quickly.

Let me know what to adjust (copy, layout, or data capture) and I can wire the actual Vue routes next.

