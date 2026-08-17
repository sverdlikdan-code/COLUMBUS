---
name: Formula Road
description: Field-sales route planning and client management for Israeli food distribution agents
colors:
  command-blue: "#1565C0"
  command-blue-deep: "#0D47A1"
  command-blue-night: "#082D6E"
  horizon-sky: "#29B6F6"
  sky-wash: "#E3F2FD"
  sky-border: "#BBDEFB"
  canvas: "#F0F5FF"
  field-text: "#0D2137"
  asphalt: "#546E7A"
  dust: "#90A4AE"
  target-gold: "#C9A84C"
  delivery-green: "#1B7B34"
  alert-red: "#C62828"
  caution-orange: "#E65100"
  ice-teal: "#00B894"
typography:
  display:
    fontFamily: "'Segoe UI', Tahoma, Arial, sans-serif"
    fontSize: "32px"
    fontWeight: 900
    lineHeight: 1.1
  headline:
    fontFamily: "'Segoe UI', Tahoma, Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 900
    lineHeight: 1.2
  title:
    fontFamily: "'Segoe UI', Tahoma, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 800
    lineHeight: 1.25
  body:
    fontFamily: "'Segoe UI', Tahoma, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "'Segoe UI', Tahoma, Arial, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    letterSpacing: "0.8px"
rounded:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "20px"
  xl: "24px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "20px"
  xl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.command-blue-deep}"
    textColor: "#ffffff"
    rounded: "{rounded.lg}"
    padding: "14px 0"
  button-primary-hover:
    backgroundColor: "{colors.command-blue-night}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.command-blue}"
    rounded: "{rounded.lg}"
    padding: "12px 0"
  sort-btn:
    backgroundColor: "transparent"
    textColor: "{colors.asphalt}"
    rounded: "{rounded.lg}"
    height: "40px"
    padding: "8px 16px"
  sort-btn-active:
    backgroundColor: "{colors.sky-wash}"
    textColor: "{colors.command-blue}"
  chip-filter:
    backgroundColor: "#F8FBFF"
    textColor: "{colors.command-blue}"
    rounded: "{rounded.lg}"
    padding: "7px 15px"
  chip-filter-active:
    backgroundColor: "{colors.command-blue}"
    textColor: "#ffffff"
  client-card:
    backgroundColor: "#ffffff"
    textColor: "{colors.field-text}"
    rounded: "{rounded.sm}"
    padding: "9px 14px"
---

# Design System: Formula Road

## 1. Overview

**Creative North Star: "The Field Navigator"**

Formula Road is a precision instrument, not an interface. It exists to answer one question per glance: who is next, how far, and how well is this route going to hit target. The design must disappear into the task — a sales agent running 40 client visits on a hot Tuesday in Hadera should never think about the UI. They should think about the route.

The system is built for the field: tablet screens tilted in passenger seats, phones mounted on dashboards, quick thumb taps between stops. Typography is bold and unambiguous; color communicates state, not decoration; touch targets accommodate gloves, sunlight, and speed. Nothing renders for aesthetics alone.

This is not a SaaS dashboard, not a CRM, not a consumer app. It is closer in spirit to a cockpit display than a website — RTL Hebrew text, dense data rows, a three-color state vocabulary, and a map that shares the screen with a ranked client list. Every pixel is accountable.

**Key Characteristics:**
- Bold, heavy type (weight 800–900) for all data labels — readable in direct sunlight
- Semantic color vocabulary: blue for navigation/selection, green for success/walk-routes, red for errors/alerts, gold for targets
- Flat canvas with disciplined shadow use: cards at rest are quiet; hover and selected states become visible
- Touch targets 38px or taller on tablet; no small interactive areas
- RTL-first layout — Hebrew is the primary reading direction

## 2. Colors: The Navigation Palette

A single dominant blue commands the surface. Gold marks achievement. Green signals positive route or delivery states. Everything else recedes to neutral.

### Primary
- **Command Blue** (#1565C0): Primary actions, selected states, active chips, visit badge fill, KM metric values. The authority color.
- **Command Blue Deep** (#0D47A1): Header gradient base, dark emphasis on primary surfaces.
- **Command Blue Night** (#082D6E): Header gradient deepest point. Appears only in gradient origins and extreme emphasis.

### Secondary
- **Horizon Sky** (#29B6F6): The 3px sky-line accent below the header — the only decorative mark in the system. Also used for active AI-sort state and informational highlights.
- **Sky Wash** (#E3F2FD): Hover and selected card backgrounds — the passive presence of Command Blue on a white surface.
- **Sky Border** (#BBDEFB): Dividers, input borders at rest, card borders.

### Tertiary
- **Target Gold** (#C9A84C): Route-goal markers, manager tile accents. Reserved for achievement and target context only.
- **Delivery Green** (#1B7B34): Walk-route groupings, success states, sales-target achievement indicators.
- **Ice Teal** (#00B894): ICE/BDD channel clients exclusively. Never reused for other states.
- **Caution Orange** (#E65100): Warnings, overdue states.
- **Alert Red** (#C62828): No-GPS badges, excluded client state, error indicators.

### Neutral
- **Canvas** (#F0F5FF): App background. Not pure white — a near-imperceptible blue tint anchors it in the same hue family as the primary palette.
- **Field Text** (#0D2137): Primary text. Very dark navy, not pure black.
- **Asphalt** (#546E7A): Secondary text — city names, addresses, contextual labels.
- **Dust** (#90A4AE): Tertiary text — metric units, timestamps, placeholder copy.

### Named Rules
**The Single Voice Rule.** Command Blue and its three named shades are the only colors that carry interactive states. Horizon Sky, Target Gold, Delivery Green, and Ice Teal communicate data categories — they never appear on buttons, chips, or interactive surfaces outside their defined semantic roles.

**The Canvas Tint Rule.** The app background is never pure white. It carries a perceptible blue tint (#F0F5FF) that visually connects white cards above it to the same color family. A pure-white background breaks the palette relationship and makes the app feel disconnected from its primary color.

## 3. Typography

**UI Font:** 'Segoe UI', Tahoma, Arial, sans-serif (system stack — intentional; native on Windows/Android tablets used in the field)

**Character:** Single system sans throughout. Hebrew and Latin share the same face without visual hierarchy conflict. Weight contrast carries all typographic differentiation — no separate display face, no monospace exception, no web font dependency.

### Hierarchy
- **Display** (weight 900, 32px, line-height 1.1): Day picker heading only. Full-screen, single-purpose prompt.
- **Headline** (weight 900, 22px, line-height 1.2): Manager names on login tiles. Prominent single-selection screens.
- **Title** (weight 800, 15px, line-height 1.25): Client names in list rows. Primary data labels throughout. Must be readable on a phone screen at arm's length in sunlight.
- **Body** (weight 400, 12px, line-height 1.4): Client address and city sub-line. Context text only — never primary data.
- **Label** (weight 700–900, 10px, letter-spacing 0.8px+, uppercase): Toolbar chip text, metric units, section markers, badge content. Uppercase enforces category-not-data reading.

### Named Rules
**The Weight-as-Hierarchy Rule.** This system uses no type scale beyond five steps. All hierarchy within a step is carried by weight (800 vs 400), never by introducing a new size. If two pieces of text at the same size need differentiation, one gets weight 800 — no new font size is added.

**The No-Display-Font Rule.** No decorative or display typeface is ever introduced. The system sans is the only typeface. A field instrument is not a brand campaign.

## 4. Elevation

Formula Road uses minimal ambient shadows. Cards are quiet at rest; shadow appears only as a state response — hover, selection, or overlay. All shadows are blue-tinted to stay within the canvas color family.

**The Flat-at-Rest Rule.** Client cards at default state carry a barely perceptible shadow (`0 1px 3px rgba(21,101,192,.06)`). Hover lifts to `0 3px 12px rgba(21,101,192,.14)`. Selected lifts further. Shadows are never neutral grey — they are tinted with the same hue as Command Blue so they read as depth within the palette, not as external drop shadows.

### Shadow Vocabulary
- **Resting card** (`0 1px 3px rgba(21,101,192,.06)`): Client rows at default. Nearly invisible — signals surface, not prominence.
- **Hovered** (`0 3px 12px rgba(21,101,192,.14)`): Card on hover or keyboard focus.
- **Selected / active** (`0 2px 10px rgba(21,101,192,.18)`): Active card, active sort button.
- **Header bar** (`0 2px 8px rgba(13,71,161,.35)`): Fixed top bar — stronger to establish its permanence above scrolling content.
- **Overlay panels** (`0 8px 32px rgba(0,0,0,.35)`): Modals and dropdown menus — neutral dark shadow to read clearly as above-canvas.

## 5. Components

Confident and breathable — each component has clear edges, generous touch targets, and no decorative embellishment. State changes are the only visual events.

### Buttons
- **Shape:** Full pill (border-radius: 20px) for primary CTAs and action triggers; gently curved (9–10px) for in-card action buttons.
- **Primary:** Command Blue gradient (deep → base), white text, full-width within context, `padding: 14px 0`. Shadow: `0 4px 14px rgba(21,101,192,.35)`.
- **Hover:** Gradient shifts one step darker (deep → night). Active tap: scale to 0.97.
- **Ghost:** White background, 2px Command Blue border, Command Blue text. Used for GPS detection and secondary confirmations.
- **Disabled:** Dust (#90A4AE) fill, no shadow, no cursor.

### Sort / Toolbar Buttons
- **Shape:** Pill (border-radius: 20px). `height: 40px` on tablet, `34px` on phone. Minimum touch target met by height.
- **Default:** No background, Asphalt text, Sky Border outline (2px).
- **Active states:** Four semantic variants — priority (Command Blue), AI-route (Delivery Green), AI-Google (purple #7B1FA2), tablet-sort (Caution Orange). Each gets its own background tint and matching text color. Never mix active states.

### City Filter Chips
- **Default:** #F8FBFF background, Command Blue text, 1.5px Sky border. Shape: pill (22px radius on tablet).
- **Active:** Command Blue fill, white text. Shadow: `0 2px 6px rgba(21,101,192,.3)`.
- **Count badge:** Inset pill at 10% opacity of the chip's own color.

### Client Cards
- **Shape:** 10px radius (tablet), 6px (phone).
- **Internal structure (RTL):** Visit number badge → client ID tag → body (name + address) → action buttons → exclude toggle.
- **Background by state:** White (default), Sky Wash (selected), #FFF8F0 (no GPS), #F1FBF4 (AI-optimized or walk-route), 50%-opacity grey (excluded).
- **Visit badge:** 30px circle (tablet), Sky Wash fill, Command Blue border and text. Selected: solid Command Blue.
- **Padding:** 9px vertical / 14px horizontal (tablet); 3px / 7px (phone).
- **State is background, not stripe.** Card state is communicated by full-card background tint. Side-stripe borders are prohibited.

### Action Buttons (Mekarer, Zikuy, Waze, AI Insight)
- **Size:** 38px min-height (tablet), 28px (phone). 9px radius (tablet), 6px (phone).
- **Semantic color per action:** Mekarer = sky-family (#BBDEFB background, Command Blue text); Zikuy = red-family (#FFCDD2, Alert Red text); Waze = teal-family (#E3F9F1, #007A73 text); AI Insight = purple-family (#D1C4E9, #4527A0 text).

### Day Picker Cards
- **Shape:** 28px radius (tablet), 24px (phone). Large, tappable rectangles.
- **Grid:** 3 columns on tablet (2 rows of 3), 5 columns on phone (1 row + orphan). Columns cap at 210px on tablet to prevent horizontal stretching.
- **Blue top accent:** 6px top border in Horizon Sky.
- **Hover:** `translateY(-5px)` plus stronger shadow. The one entrance animation in the system — meaningful here because the choice is a deliberate daily action.

### Header Bar
- **Background:** Three-stop gradient: Command Blue Night (0%) → Command Blue Deep (60%) → Command Blue (100%). Angle: 135deg.
- **Sky line:** 3px horizontal stripe in Horizon Sky immediately below the header. This is the system's only decorative mark.
- **Logo:** White filter (`brightness(0) invert(1)`), 46px height (tablet) / 38px (phone).

## 6. Do's and Don'ts

### Do:
- **Do** use weight 800–900 for any data label the agent must read at a glance in the field.
- **Do** keep touch targets 38px or taller on tablet, 28px or taller on phone.
- **Do** tint shadows with Command Blue (`rgba(21,101,192,...)`) on cards — never use neutral grey shadows.
- **Do** keep the Canvas background tinted (#F0F5FF) — pure white behind a blue-dominant UI breaks the palette relationship.
- **Do** use background-tint states (Sky Wash, #F1FBF4, #FFF8F0) to communicate card state — not side stripes.
- **Do** keep Ice Teal (#00B894) exclusive to ICE/BDD channel clients.
- **Do** reserve uppercase letter-spaced text for category labels and section markers only — never for data values or button actions.
- **Do** add a `@media(min-width:768px)` block for any new screen — phone defaults look amateurish at tablet width without explicit scaling.

### Don't:
- **Don't** use `border-left` or `border-right` greater than 1px as a colored accent stripe on cards or list items. Use a full border, outline, or background tint instead.
- **Don't** use SaaS cream or white-plus-teal enterprise dashboard aesthetics. This is not a CRM.
- **Don't** use dark mode or neon accents. Agents work in Israeli daylight — dark mode introduces readability risk in the field.
- **Don't** use gradient text (`background-clip: text`). All text is a single solid color.
- **Don't** use identical card grids. The client list is a ranked, ordered instrument — not a tile gallery.
- **Don't** introduce a new color for a new state. Map to the existing semantic vocabulary: blue = selected/active, green = positive/delivery, red = error/alert, orange = warning. If a new semantic role genuinely exists, document it here before using it.
- **Don't** animate CSS layout properties. Only `transform`, `box-shadow`, and `opacity` are permitted in transitions. Duration: 120–200ms.
- **Don't** render any UI text at less than 10px. Field agents read without squinting.
- **Don't** use nested cards. Cards contain data rows, not other cards.
