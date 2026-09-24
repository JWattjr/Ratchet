---
name: Ratchet
description: A friendly, evidence-led release calibration bench for GenLayer Studio Next.
colors:
  ink: "#18364b"
  ink-strong: "#102a3c"
  muted: "#597182"
  subtle: "#52697b"
  paper: "#f4f8fa"
  white: "#fff"
  bench: "#eaf3f7"
  line: "#cfdee6"
  line-strong: "#afc4cf"
  sky: "#d9eaf3"
  blue: "#536fc1"
  blue-deep: "#4057a6"
  mint: "#28735f"
  mint-pale: "#e1f3ec"
  amber: "#91620d"
  amber-pale: "#f8efdc"
  coral: "#a94b43"
  coral-pale: "#f8e8e6"
typography:
  display:
    fontFamily: '"Nunito Sans Variable", "Nunito Sans", "Segoe UI", sans-serif'
    fontSize: "clamp(32px, 3.3vw, 47px)"
    fontWeight: 680
    lineHeight: 1.08
    letterSpacing: "-0.055em"
  headline:
    fontFamily: '"Nunito Sans Variable", "Nunito Sans", "Segoe UI", sans-serif'
    fontSize: "24px"
    lineHeight: 1.1
    letterSpacing: "-0.04em"
  title:
    fontFamily: '"Nunito Sans Variable", "Nunito Sans", "Segoe UI", sans-serif'
    fontSize: "20px"
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  body:
    fontFamily: '"Nunito Sans Variable", "Nunito Sans", "Segoe UI", sans-serif'
    fontSize: "15px"
    lineHeight: 1.5
  label:
    fontFamily: '"Nunito Sans Variable", "Nunito Sans", "Segoe UI", sans-serif'
    fontSize: "9px"
    fontWeight: 750
    lineHeight: 1.5
    letterSpacing: "0.09em"
  action:
    fontFamily: '"Nunito Sans Variable", "Nunito Sans", "Segoe UI", sans-serif'
    fontSize: "11px"
    fontWeight: 750
  navigation:
    fontFamily: '"Nunito Sans Variable", "Nunito Sans", "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 600
  reference:
    fontFamily: '"IBM Plex Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace'
    fontSize: "12px"
    fontWeight: 600
rounded:
  sm: "6px"
  control: "7px"
  md: "8px"
  plate: "14px"
  pill: "999px"
  circle: "50%"
components:
  nav-primary:
    textColor: "{colors.muted}"
    typography: "{typography.navigation}"
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.white}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "40px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "0 13px"
    height: "38px"
  input-release-id:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.sm}"
    padding: "7px 10px"
    height: "38px"
  chip-advanced:
    backgroundColor: "{colors.mint-pale}"
    textColor: "{colors.mint}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "27px"
  chip-held:
    backgroundColor: "{colors.amber-pale}"
    textColor: "{colors.amber}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "27px"
  chip-rolled-back:
    backgroundColor: "{colors.coral-pale}"
    textColor: "{colors.coral}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "27px"
  release-bay-empty:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.plate}"
  flight-recorder-stop:
    backgroundColor: "{colors.white}"
    textColor: "{colors.muted}"
    rounded: "{rounded.circle}"
    size: "25px"
    height: "25px"
  bench-instrument:
    backgroundColor: "#e9eefb"
    rounded: "{rounded.circle}"
    size: "69px"
---

# Design System: Ratchet

## Overview

**Creative North Star: "Ratchet Calibration Bench"**

Ratchet turns release review into a friendly calibration bench: a cool, pale-blue working surface holds a frozen declaration beside observed replay evidence and the contract's recorded outcome. Deep ink and thin registration rules keep dense details easy to align. Nunito Sans Variable carries the interface in an approachable engineered voice; IBM Plex Mono is reserved for hashes, IDs, addresses, and other exact references. Both fonts are bundled locally through Fontsource.

Periwinkle marks controls and active inspection, while mint, amber, and coral identify ADVANCE, HOLD, and ROLLBACK. Rounded instrument plates contain the evidence, and one small five-stop shuttle supports stage-by-stage reading. Live connection state and the configured contract address stay visible beside the work surface. The final desktop and mobile captures show Studio Next live on chain 61997, the deployed address linked to the explorer, and the selected on-chain `RATCHET-ROLLBACK` release with its bond and history. The release picker uses live contract reads; it never substitutes sample releases when reads fail.

**Key Characteristics:**
- Cool calibration surface with deep, readable technical text.
- Fine registered rules and gently rounded plates organize evidence.
- State color is paired with a written label and a shape.
- Friendly engineered sans for prose; mono only for precise references.
- A restrained five-stop shuttle supports inspection without taking focus from evidence.

## Colors

The palette uses cool blue neutrals for the bench and distinct enamel-like accents for connection, progress, and release outcomes.

### Primary
- **Calibration Periwinkle** (`colors.blue`): Primary action fills, active inspection markers, and the evidence rail.
- **Deep Periwinkle** (`colors.blue-deep`): Links, selected labels, and the darker edge of interactive controls.

### Secondary
- **Outcome Mint** (`colors.mint`): ADVANCE state text and markers.
- **Pale Outcome Mint** (`colors.mint-pale`): ADVANCE chip and connected-state halo surfaces.

### Tertiary
- **Hold Amber** (`colors.amber`) and **Pale Hold Amber** (`colors.amber-pale`): The calm HOLD state and its contained surface.
- **Rollback Coral** (`colors.coral`) and **Pale Rollback Coral** (`colors.coral-pale`): ROLLBACK, unavailable, and error states; pair the color with a clear label and shape.

### Neutral
- **Deep Slate Ink** (`colors.ink`) and **Workface Ink** (`colors.ink-strong`): Main copy, headings, hashes, and evidence values.
- **Muted Slate** (`colors.muted`) and **Fine Label Slate** (`colors.subtle`): Supporting copy, captions, and compact field labels.
- **Cool Paper** (`colors.paper`), **Plate White** (`colors.white`), and **Calibration Blue** (`colors.bench`): Page ground, principal instrument surfaces, and the empty-state mark.
- **Registration Line** (`colors.line`) and **Strong Registration Line** (`colors.line-strong`): Dividers, field edges, and alignment marks.
- **Sky Blue** (`colors.sky`): Quiet hover surface for icon controls.

**The Named State Rule.** Every status keeps its text label and distinct shape alongside its color; color alone never carries the outcome.

## Typography

**Display Font:** Nunito Sans Variable (with Nunito Sans, Segoe UI, and sans-serif fallbacks)  
**Body Font:** Nunito Sans Variable (with Nunito Sans, Segoe UI, and sans-serif fallbacks)  
**Label/Mono Font:** IBM Plex Mono (with Cascadia Code, SFMono-Regular, Consolas, and monospace fallbacks)

**Character:** Nunito Sans keeps technical review warm, compact, and legible. IBM Plex Mono gives hashes, IDs, transaction references, and addresses a stable reading shape without turning ordinary copy into a terminal.

### Hierarchy
- **Display** (weight 680, responsive 32–47px, line-height 1.08): The opening release promise.
- **Headline** (24px, line-height 1.1): The selected release name and primary evidence title.
- **Title** (20px, line-height 1.2): Instrument and plate headings such as “Release bench.”
- **Body** (15px, line-height 1.5): Default interface copy; supporting paragraphs reduce in size on narrow screens.
- **Label** (9px, weight 750, letter-spacing 0.09em): Section indices, evidence field captions, and compact uppercase labels.
- **Reference** (12px, weight 600): Hashes, release IDs, addresses, and block-like references; denser evidence can step down to 8–9px where the implementation does so.

**The Technical Mono Rule.** Use IBM Plex Mono for exact identifiers and references; keep explanatory labels and prose in Nunito Sans.

## Layout

The workbench is centered within a 1376px maximum width, with a 32px desktop side inset. The introduction pairs the release promise with a live connection stamp; a two-rule registration band leads into one large release bay. Inside that bay, the specimen and evidence occupy the main column while a narrow reference instrument sits beside them. Fine rules align the declaration, replay, consensus, and contract-action sequence.

At 1050px the side instrument and primary specimen tighten. At 800px the release bay becomes one column and the reference instrument moves below the specimen. At 600px the introduction stacks, evidence comparisons become a declared → observed → decision sequence, and controls use 44px minimum touch targets. At 390px, outer insets and labels tighten while evidence remains readable rather than shrinking a wide table. The five-stop rail remains selectable without motion.

## Elevation & Depth

The bench is mostly flat: tonal surface changes, one-pixel rules, and aligned plates do most of the separating. The release bay carries a faint ambient shadow, primary buttons have a shallow hard lower edge, and selected rail elements and connection indicators use small local halos. The create dialog receives a stronger overlay shadow only while open. There are no glass panels or gradient surfaces.

**The Registered Plane Rule.** Use borders and aligned rules to define the work surface; reserve shadows for the release bay, tactile action edge, selected marker, connection-state halo, and modal overlay.

## Shapes

Controls use gently rounded corners (6–8px); the release bay uses a more generous plate corner (14px), and status markers are compact pills (999px radius). Evidence fields and inner inspection panels stay smaller than their containing plate. Instrument details use concentric circles, fine crosshairs, small square markers, and occasional rotated diamonds. Borders remain mostly one pixel and low contrast so they register alignment without becoming a grid-heavy dashboard.

## Components

### Buttons
- **Primary action:** A compact periwinkle control with white text and a shallow lower edge (40px desktop height, 44px at widths up to 600px). It rises one pixel on hover, darkens to deep periwinkle, and keeps the visible three-pixel focus outline.
- **Outline action:** A white or transparent-faced control with a cool border (38px desktop height, 44px on narrow screens). Hover shifts the border and text toward periwinkle; disabled actions lower opacity and use a not-allowed cursor.
- **Quiet action:** Text and icon actions remain unfilled until hover, when a quiet sky surface or deep-periwinkle text indicates interactivity.

### Chips
- **Style:** A small rounded pill with a one-pixel state border, a compact square marker, and an uppercase label.
- **State:** ADVANCE uses mint, HOLD amber, ROLLBACK coral; sealed, draft, cancelled, and unavailable states use subdued blue-gray treatments. Status color is always paired with shape and text.

### Cards / Containers
- **Release bay:** A white instrument plate with a fine cool border, 14px corners, and the system's faint ambient shadow. Its header is ruled off from the specimen area.
- **Empty live index:** “No releases are recorded yet” explains the real empty contract index and offers “Prepare first release.” It contains no seeded release or illustrative chain record.
- **Inspection panel:** A lightly tinted inner plate with an 8px corner and 1px outline; field groups use dividers rather than nested shadows.

### Inputs / Fields
- **Style:** White fields with a cool border, 6px corners, and compact padding; identifier and hash-like values use the mono face only where exactness is needed.
- **Focus:** The shared visible focus treatment is a three-pixel periwinkle outline with a three-pixel offset.
- **Error / Disabled:** Errors use coral text on a pale coral surface and a border; disabled controls reduce opacity and keep their disabled behavior visible.

### Navigation
- **Style:** The top bar keeps Ratchet identity at the left, three direct section links across the center, and the wallet control at the right. Links are muted at rest and deep periwinkle on hover. The section links hide at 800px and below; the work surface and its evidence navigation remain available.

### Signature Components
- **Connection stamp:** Keep Studio Next status, live chain label, refresh action, and shortened explorer-linked contract address together. The wording distinguishes checking, live, unavailable, and unconfigured states.
- **Five-stop evidence shuttle:** Declaration → Replay → Comparison → Validators → Contract action. Numbered tab buttons select a stage; a restrained shuttle and rail progress echo the selection. Motion is short and reduced to an immediate change for reduced-motion preferences.
- **Bench reference instrument:** A compact concentric alignment mark and live contract counts sit in the side rail on wide layouts, then move below the specimen on smaller screens.

## Do's and Don'ts

### Do:
- **Do** keep declared intent, observed execution, consensus, and contract action in a registered sequence.
- **Do** pair each outcome with its written label and shape as well as its state color.
- **Do** use IBM Plex Mono for hashes, IDs, addresses, and transaction references.
- **Do** keep the live connection and deployed address visible, and let the release index report its actual empty state.
- **Do** keep evidence legible at mobile widths and preserve keyboard selection when motion is reduced.

### Don't:
- **Don't** add local sample releases or present fixture data as chain state.
- **Don't** use black neon, glass, gradient decoration, generic dashboard card grids, large editorial serifs, fake terminals, or alarm animation.
- **Don't** make ROLLBACK playful or let decorative objects compete with the verdict and evidence.
- **Don't** put ordinary explanatory copy in the mono face or make state meaning depend on color or movement.
