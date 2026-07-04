---
name: nexus-moves-design
description: Use this skill to generate well-branded interfaces and assets for Nexus Moves, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick reference
- **One color system:** Nexus Blue (`--blue-500 #4F5BF0`) is the single action color. The **shimmer** (`--shimmer`, blue→cyan) is the signature — reserve it for AI/hero moments (assistant avatar, one hero CTA, progress fills). The **beacon orange** (`--beacon-500`) is the one warm spark — streaks/arrival only.
- **Themes:** dark-first (mobile app), full light theme (`[data-theme="light"]` — dashboard, marketing).
- **Type:** Bricolage Grotesque (display/marketing), system stack (all UI), JetBrains Mono (eyebrows/data).
- **Voice:** warm, first-person ("I checked…"), uses the customer's name, concrete honest numbers, sentence case, no emoji in production.
- **Icons:** Lucide (line, 2px, rounded). No hand-drawn SVGs, no emoji.
- Link `styles.css` for all tokens. Components live in `components/`, full screens in `ui_kits/`.
