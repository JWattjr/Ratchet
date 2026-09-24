---
name: Ratchet
description: A paper-and-pencil release review notebook for stable GenLayer Studionet.
colors:
  ink: "#34362f"
  ink-strong: "#292b26"
  muted: "#5e5d53"
  subtle: "#56584f"
  paper: "#f4f1e8"
  paper-light: "#fbf8ef"
  white: "#fbf8ef"
  bench: "#eee9dc"
  line: "#c9c2b3"
  line-strong: "#958e7f"
  sky: "#e6e8e1"
  blue: "#496b99"
  blue-deep: "#385781"
  blue-pale: "#e6e9e4"
  mint: "#3d6849"
  mint-pale: "#e6ede2"
  amber: "#80581b"
  amber-pale: "#f1e8d5"
  coral: "#934a42"
  coral-pale: "#f0e1db"
typography:
  display:
    fontFamily: '"Patrick Hand", cursive'
    fontSize: "clamp(34px, 4.2vw, 58px)"
    fontWeight: 400
    lineHeight: 1.02
  headline:
    fontFamily: '"Patrick Hand", cursive'
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1.12
  title:
    fontFamily: '"Patrick Hand", cursive'
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.2
  subhead:
    fontFamily: '"Patrick Hand", cursive'
    fontSize: "19px"
    fontWeight: 400
  body-small:
    fontFamily: '"Nunito Sans Variable", "Nunito Sans", "Segoe UI", sans-serif'
    fontSize: "12px"
    lineHeight: 1.5
  body:
    fontFamily: '"Nunito Sans Variable", "Nunito Sans", "Segoe UI", sans-serif'
    fontSize: "14px"
    lineHeight: 1.6
  label:
    fontFamily: '"Patrick Hand", cursive'
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.35
  action:
    fontFamily: '"Patrick Hand", cursive'
    fontSize: "16px"
    fontWeight: 400
  reference:
    fontFamily: '"IBM Plex Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace'
    fontSize: "10px"
    fontWeight: 500
rounded:
  sm: "2px"
  control: "3px"
  dialog: "4px"
  circle: "50%"
  plate: "0px"
components:
  button-primary:
    backgroundColor: "{colors.blue-pale}"
    textColor: "{colors.blue-deep}"
    typography: "{typography.action}"
    border: "1px dashed {colors.blue-deep}"
    height: "44px on mobile"
  input-release-id:
    backgroundColor: "{colors.paper-light}"
    textColor: "{colors.ink-strong}"
    typography: "{typography.reference}"
  verdict-advance:
    textColor: "{colors.mint}"
    highlight: "translucent uneven pencil wash"
  verdict-hold:
    textColor: "{colors.amber}"
    highlight: "translucent uneven pencil wash"
  verdict-rollback:
    textColor: "{colors.coral}"
    highlight: "translucent uneven pencil wash"
---

# Design System: Ratchet

## Overview

**Creative North Star: “The marked release notebook.”** Ratchet turns a protocol release review into an open paper plan, marked by the people proposing it and checked against what replay observed. The warm sheet, handwritten headings, pencil rules, and colored outcome marks create the feeling of a working document while preserving the precision of its live evidence.

The paper surface uses a warm off-white base (#f4f1e8) with a barely visible grain. Headings, labels, stage numbers, verdicts, and controls use Patrick Hand. Nunito Sans remains on explanations and longer prose; IBM Plex Mono stays on addresses, hashes, JSON, URLs, and transaction references. The release selector uses mono for exact IDs so they remain easy to compare and copy.

Blue ink marks declared or proposer-supplied information. Green means ADVANCE, passing checks, and returned bond. Ochre means HOLD, pending work, and locked bond. Red means ROLLBACK, failures, undeclared changes, and slashed bond. Status always appears in readable text as well as color. State colors and graphite text exceed WCAG AA contrast on both paper surfaces.

**Key characteristics:**
- Warm paper, subtle grain, graphite type, and generous whitespace.
- Patrick Hand brings personality to short UI text; clean sans and mono protect dense evidence.
- State colors follow a fixed meaning across the release, evidence, and bond views.
- Uneven highlighter strokes call out section titles and the selected verdict.
- One curved pencil arrow links evidence to the final verdict; hand-drawn underlines emphasize the verdict and bond total.
- Thin SVG outlines receive a slight, static ink wobble. Focus and selected states use a visible dashed outline.

## Colors

- **Graphite** (ink, ink-strong): Primary text and headings.
- **Graphite gray** (muted, subtle): Explanations, captions, and supporting labels.
- **Paper** (paper): Main page background. paper-light / white is warm cream for small controls and text surfaces; never use pure white panels.
- **Pencil rule** (line, line-strong): Occasional loose separators and control boundaries. Do not draw spreadsheet grids or box every evidence field.
- **Blue ink** (blue, blue-deep, blue-pale): Declared values, proposer-supplied data, links, and active inspection.
- **Advance green** (mint, mint-pale): ADVANCE, passing invariants, and returned bond.
- **Hold ochre** (amber, amber-pale): HOLD, pending work, and locked bond.
- **Rollback red** (coral, coral-pale): ROLLBACK, failures, undeclared changes, and slashed bond.

The CSS reuses and warms --blue, --mint, --amber, and --coral. Foreground state colors are selected for AA contrast on the paper backgrounds. Pale colors are decorative washes and never carry text meaning by themselves.

## Typography

**Handwritten UI face:** Patrick Hand, self-hosted at build time with next/font/google. Kalam was compared on the same page; its slanted, more cursive forms reduce quick scanning in labels and verdicts, so Patrick Hand is the more readable choice.

**Body face:** Nunito Sans Variable for descriptive copy and longer explanations.
**Technical face:** IBM Plex Mono for hashes, JSON, contract addresses, transaction hashes, URLs, and exact values in the release selector.

- **Display:** 34px compact, up to 58px fluid, Patrick Hand, regular weight, short headline lines.
- **Section title:** 19–30px, Patrick Hand, regular weight.
- **Label and control:** 11–16px, Patrick Hand, regular weight.
- **Body:** 12–14px, Nunito Sans, 1.5–1.6 line height.
- **Exact reference:** 10–12px, IBM Plex Mono, 1.5–1.6 line height; wrap long values rather than clipping them.

Never use handwriting for contract addresses, hashes, JSON, transaction references, or long explanations.

## Layout

Keep the current live review flow and page structure. The page remains a centered workbench with a compact top navigation, release selector, declaration and replay evidence, decision strip, evidence-stage tabs, live reference counts, release history, and method explanation. Styling removes the nested cool-white instrument plates and replaces their borders with whitespace, pale paper shifts, and occasional pencil rules.

At desktop widths, keep the connection stamp beside the opening statement and the live contract counts in the side rail. At tablet widths, move the side rail below the evidence. At narrow widths, stack the connection stamp and evidence fields, keep controls at least 44px tall, and let identifiers wrap. The interface must remain usable at 375px with no horizontal scroll.

## Surface and detail

- Apply a low-opacity SVG noise overlay to the paper; keep it behind content and nearly imperceptible.
- Use irregular CSS marker strokes behind section headings and the final verdict, tinted by the heading or outcome.
- Draw one curved SVG arrow from the evidence area toward the verdict. Do not repeat arrow doodles elsewhere.
- Give the verdict a single rough pencil underline and the bond total a double underline.
- Keep icons as thin inline SVG outlines with round caps and joins, using a restrained static displacement for a hand-inked edge.
- Use whitespace first. Dividers are occasional, thin, and slightly imperfect; do not add cell borders, spreadsheet grid lines, column letters, or row numbers.
- Controls are lightly tinted paper with fine or dashed pencil edges. Keyboard focus remains a high-contrast dashed blue outline with a clear offset.
- Respect reduced-motion preferences. The grain and ink treatment are static; motion is limited to existing control feedback.

## Components

### Verdict and bond

The verdict uses a state-colored handwritten word, a translucent uneven marker wash, a hand-drawn underline, and the single evidence-to-verdict arrow. Keep the supporting explanation in Nunito Sans. The bond amount uses a double pencil underline; the breakdown colors returned, locked, and slashed values green, ochre, and red respectively.

### Evidence

Use blue ink for declared values. Keep exact evidence in IBM Plex Mono or clean sans. Hashes, JSON, long URLs, transaction receipts, and explanatory paragraphs stay legible and may wrap. Evidence groups are separated with whitespace and occasional pencil rules instead of nested cards.

### Actions and focus

Buttons use Patrick Hand with warm tinted fills and a light dashed edge. The HOLD action uses ochre; controls do not imply a verdict before it is recorded. Focus is a visible dashed outline. Selected evidence stages have a dashed hand-marked boundary, with their label and number still readable.

### Live status

Keep Studionet connection state, chain label, refresh action, and explorer-linked contract address visible. Keep the real live release selector and never substitute sample releases when contract reads fail.

## Accessibility and evidence integrity

- Maintain at least 4.5:1 contrast for normal text and 3:1 for large text on paper surfaces.
- Pair each outcome color with its written status and shape.
- Keep the focus outline visible for keyboard use and retain 44px touch targets on narrow screens.
- Honor reduced motion.
- Do not style hashes, identifiers, contract addresses, JSON, or long explanatory text as handwriting.
- Do not display fallback records as live chain state. A network failure must remain an honest unavailable state.
