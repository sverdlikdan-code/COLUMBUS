# Designer Agent — PRD

**Version:** 1.0  
**Date:** 2026-04-29  
**Status:** Draft

---

## Description

`Designer Agent` is a specialist responsible for product visual direction and competitor-aware UX guidance.

Primary mission:
1. Monitor key competitors: Bringg, Rasner Logistic Software, RouteQ, BeatRoute, PepUpSales, RouteOptima, Ascomy
2. Translate findings into actionable UI style rules for the app
3. Maintain consistency of buttons, interaction behavior, and visual patterns

---

## Problem It Solves

Without a dedicated design intelligence layer, product UI drifts and feature decisions become reactive.  
The team needs one agent that continuously watches market patterns and turns them into coherent design standards.

---

## Goals

1. **Competitive awareness** — continuously track named competitors
2. **UI consistency** — enforce visual language for controls and flows
3. **Interaction quality** — standardize button states and micro-interactions
4. **Actionable output** — provide implementation-ready guidance, not abstract feedback
5. **Design memory** — keep historical decisions documented in vault notes

---

## Scope

### In Scope

- Competitor feature and UX pattern monitoring
- Visual style recommendations (spacing, hierarchy, color usage, typography direction)
- Button system guidance (primary/secondary/tertiary states and behavior)
- Interaction rules (hover, active, loading, disabled, error/success feedback)
- Design decision notes and periodic summary outputs

### Out of Scope (v1)

- Pixel-perfect UI implementation in code by default
- Brand redefinition from scratch
- Formal design system tooling integration (Figma tokens API, etc.)

---

## Inputs / Outputs

### Inputs

- User request for UI/design direction
- Competitor list (fixed baseline + future extensions)
- Existing app screenshots/references
- Current UI components and constraints

### Outputs

- Competitor comparison snapshot
- Recommended UI patterns with rationale
- Concrete button/interaction specs
- Prioritized design actions (quick wins vs structural changes)
- Vault update with decision log

---

## Core Workflow

1. Parse request and determine screen/flow scope
2. Gather competitor signals relevant to the same workflow
3. Extract pattern deltas:
   - what competitors do better
   - what to avoid
4. Produce style guidance:
   - visual tokens direction
   - button hierarchy and states
   - interaction behavior
5. Provide implementation brief to development agents
6. Write session memory to vault notes

---

## Competitor Monitoring Baseline

Mandatory watchlist:
- Bringg
- Rasner Logistic Software
- RouteQ
- BeatRoute
- PepUpSales
- RouteOptima
- Ascomy

For each analysis cycle, capture:
- UX flow strengths
- UI control patterns
- Button behavior and interaction quality
- Operational dashboard clarity

---

## Acceptance Criteria

- [ ] Recommendations reference at least one relevant competitor pattern
- [ ] Button and interaction guidance is explicit enough to implement directly
- [ ] Suggestions preserve product consistency and avoid random style mixing
- [ ] Output clearly separates "adopt", "adapt", and "avoid"
- [ ] Session decisions are logged in vault

---

## Risks / Caveats

- Competitor pages may be partially inaccessible or marketing-only
- Overfitting to competitor UI can reduce product identity
- Need explicit prioritization to avoid design churn

---

## Future Enhancements

1. Weekly automated competitor digest
2. Pattern scorecard (us vs competitors)
3. Reusable component spec templates
4. Versioned design decision changelog

