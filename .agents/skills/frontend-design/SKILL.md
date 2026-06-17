---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces that feel authored by a strong human designer, not averaged from template patterns. Use for any new UI, landing page, dashboard, or visual redesign. Enforces a radical art direction, a functional signature element, a token-driven system, complete interaction + failure states, accessibility (WCAG AA intent), and zero reliance on recognizable AI tropes. Includes the HermesCo house art direction.
---

# Frontend Design Skill

Create distinctive, production-grade frontend interfaces that feel authored by a strong human designer, not averaged from template patterns.

## Success Criteria
- Distinct visual identity with a clear narrative and signature element
- Production-grade functionality with complete states and responsive behavior
- Accessibility by default with WCAG AA intent
- Token-driven design system rather than one-off styling
- Zero reliance on recognizable AI tropes

## Before Writing Code

### 1. Understand the Context
- **Purpose** — what problem does this interface solve and who uses it
- **Constraints** — framework, performance budget, accessibility requirements
- **Brand Anchors if provided** — adjectives, references, taboos

If critical information is missing, request only what blocks correct execution.

### 2. Commit to a Radical Art Direction
Pick one extreme and execute it with precision. Bold maximalism and refined minimalism both work — intentionality is mandatory. Example directions (inspiration only): Editorial magazine; Neo-brutalist industrial; Luxury refined; Retro-futurist CRT; Organic tactile; Punk zine rebellion; Bauhaus precision; Psychedelic surreal.

**CRITICAL:** No two designs should converge on the same choices. Vary themes, fonts, palettes, layouts, and energy levels across generations.

### 3. Invent a Signature Element
Every build must include one unforgettable hook that is functional, not decorative. Valid examples: morphing border/frame responding to scroll or state; typographic hero with deliberate kerning and optical rhythm; navigation with spatial logic and animated affordances; custom cursor behavior that improves discoverability; texture system supporting hierarchy and focus; branded data-visualization language; scroll-triggered reveal with orchestrated timing.

## Design Tokens
Define tokens before layout. `:root` must define color (`--color-bg/surface/text/muted/accent/focus/success/warning/danger`), typography (`--font-display/body/mono`, a text + leading scale xs→2xl), spacing (`--space-1..8`), radius/shadow (`--radius-sm/md/lg`, `--shadow-sm/md/lg`), and motion (`--duration-fast/base/slow`, `--ease-out/spring`).

## Aesthetics Rules

### Typography
- Avoid Inter, Roboto, Arial, and system defaults
- Pair a characterful display face with a refined body face
- Tune letter-spacing and line-height intentionally
- Use typographic contrast as a primary design tool
- Provide robust fallbacks that preserve tone

### Color & Palette
- No emoticon icons anywhere on the site
- No default purple-gradient-on-white SaaS aesthetic
- One dominant hue plus 1–3 accents with defined roles
- Contrast and focus colors must be functional
- Dark mode only if it strengthens the direction

### Layout & Composition
- No predictable center-hero → three-cards → icon-row
- Consistent grid logic plus at least one intentional grid break
- Asymmetry encouraged when it clarifies hierarchy
- Responsive design must preserve narrative and rhythm

### Motion
- Motion communicates structure, feedback, and affordances
- Prefer one orchestrated entrance over scattered micro-animation
- Scroll reveals only when they add meaning
- Respect `prefers-reduced-motion` with a clean fallback
- Prefer transform/opacity for performance

### Texture & Material
- Avoid flat sterile backgrounds unless austerity is intentional
- Texture must support hierarchy, not add noise
- Depth language must be consistent across the system
- Glass effects only if fully committed and readable
- Allowed: subtle grain overlay, SVG parametric patterns, noise-driven gradients, paper-fold shadows, CRT scanlines, procedural canvas texture (performance permitting)

## Required Interaction States
Every interactive element must implement: Default, Hover, Active/pressed, Focus-visible, Disabled, Loading, Error, Empty (where applicable).

## Production Requirements
- **Accessibility:** semantic HTML; ARIA only where necessary; keyboard navigation for all interactive elements; visible focus styling integrated into the aesthetic; form validation messaging where forms exist.
- **Responsive:** minimum three breakpoints; narrative and hierarchy preserved across sizes; touch targets ≥ 44px.
- **Performance:** avoid heavy effects by default; canvas/WebGL/particles require reduced mode and lazy initialization; GPU-friendly animation.
- **Failure handling:** account for network failure/offline, partial/delayed data, user error + recovery. Failure states must be visually intentional, on-brand, informative without verbosity. No silent failures. No default browser error states.

## Enforcement

### Narrative Consistency — reject if any are true
- Typography, motion, layout, and copy feel authored by different systems
- Components are visually polished but conceptually disconnected
- Microcopy tone contradicts the chosen direction

### No Placeholder Energy — reject if any are present
- Lorem ipsum or filler copy
- Vague marketing language without context
- Empty states without guidance
- Labels or helper text that ignore the established voice

### Abomination Checklist — reject if any are true
- Inter + purple gradient + rounded cards + generic icons
- Generic chatbot bubbles with no branded concept
- Default Tailwind appearance with minimal tokenization
- Missing focus states or keyboard access
- No error or loading states
- Marketplace template resemblance
- Visual polish without usability completeness
- Convergence on common AI aesthetic patterns

## Output Structure
1. **Art Direction Brief** — direction & tone, type-pairing concept, palette logic, motion grammar, material/texture choice.
2. **Code** — complete runnable code matching the requested scope; implementation complexity matches the aesthetic vision.
3. **Extension Notes** — how to extend tokens, components, and states without breaking coherence.

## Final Quality Gate (all must be true)
Signature element exists and is functional · tokens drive styling · accessibility met · all interaction states implemented · failure/recovery states designed · narrative consistency holds · responsive rhythm preserved · no AI-trope patterns. If any check fails, the output is invalid.

> Don't hold back. Every interface should feel crafted by a designer with a clear point of view — not generated by an algorithm averaging templates.

---

# HermesCo House Art Direction

The concrete application of this skill for the HermesCo product.

**Direction & tone:** "The Messenger's Command Center" — classical Hermes authority × new-age fintech terminal. Editorial serif gravitas, ink-and-bronze materials, one living signature backdrop, real depth. Mythic foundation (caduceus, winged messenger) meets a live agent/money terminal.

**Signature element — The Messenger Network:** a full-bleed interactive canvas constellation of gold→bronze "messenger" nodes drifting over ink, with connection lines that ignite along the path nearest the cursor (a Hermes-bronze reskin of the joepro.ai neural network in the `rhyme-protocol` repo, `components/NeuralNetworkInteractive.tsx`). Full-strength on the landing hero; dimmed + slowed behind the command center. MUST honor `prefers-reduced-motion` (render a single static frame) and lazy-init on the client only. Implementation lives at `src/components/MessengerNetwork.tsx`.

**Type pairing:** display = DM Serif Display (classical authority), with Instrument Serif for editorial moments; body/UI = Space Grotesk (characterful, NOT Inter — Inter is banned by this skill); data/ledger/labels = JetBrains Mono. Tune tracking + leading; use serif↔mono contrast as the primary device.

**Palette logic (tokens in `globals.css`):** dominant hue = bronze — `--color-accent: #C8893E`, light `#E0A35A`, with the metallic `--color-accent-gradient`. Surface = ink `#0E0E10`, elevated `#131316`/`#1A1A1D`. Text = cream `#EDE6D9` / bright `#F4F0EB`. Accents = teal `#5BD6C0` (live/credit signals), `--color-hermes #4F7A5A`. Semantic: success `#22c55e`, warning `#F59E0B`, danger `#ef4444`. No purple-on-white, no emoji icons.

**Motion grammar:** one orchestrated hero entrance (staggered fade-up), not scattered micro-animations; ledger entries slide + fade in; net-profit counts up; proposal cards carry weight (scale/opacity). Transform/opacity only; everything degrades cleanly under reduced motion.

**Material:** subtle film grain overlay + bronze radial glows + committed, readable glass on Treasury cards. Consistent depth language (border + inner highlight + soft shadow).

**Voice:** terse, authoritative, mythic-but-precise. Money is real — never fake/seeded/placeholder data; empty and failure states must state the real condition (e.g. "Stripe not connected—set STRIPE_SECRET_KEY").
