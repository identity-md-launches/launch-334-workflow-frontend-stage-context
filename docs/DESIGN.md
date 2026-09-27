# Circle design

## Overview

Circle is a one-page interface for small groups using the deployed CIRC rotating savings contract on Sepolia. It pairs a quiet paper background and serif headline with plain, readable controls. The composition introduces the commitment, displays wallet balances, then puts circle creation beside discovery. Selected-circle details follow in normal document flow. This is an implemented product design, not an inferred financial safety guarantee.

Source: `web/src/styles.css` for tokens/layout; `web/src/App.tsx` for components/content. This document lives under `docs/` because the assignment's overriding write allowlist does not permit a root `DESIGN.md`.

## Colors

All values are sRGB hex in `:root`. Primitive values are mapped to role tokens; use role tokens in components.

| Role token | Value | Use |
| --- | --- | --- |
| `--color-bg` | `#f6f5ef` | Page paper |
| `--color-surface` | `#fffef9` | Fields, buttons, create/detail panels |
| `--color-subtle` | `#eeeee5` | Bond summary, empty state, disabled controls |
| `--color-text` | `#20291c` | Body, headings, neutral controls |
| `--color-muted` | `#58604f` | Supporting copy, units, labels |
| `--color-border` | `#d6d8cc` | Structural lines and panel edges |
| `--color-control-border` | `#7b816f` | Input and button affordances |
| `--color-accent` | `#49602c` | Primary action background |
| `--color-accent-hover` | `#364920` | Primary hover and links |
| `--color-accent-soft` | `#e6ebd8` | Selected circle row |
| `--color-on-accent` | `#ffffff` | Primary action text |
| `--color-warning-bg` | `#f2e9d9` | Testnet/economic notice and wrong network |
| `--color-warning-text` | `#654719` | Notice and eligibility warning text |
| `--color-error` | `#9b3127` | Recoverable errors and invalid field borders |
| `--color-focus` | `#20291c` | 3px focus outline with 4px offset |

Measured browser foreground/background pairs are recorded in `docs/frontend/browser-results.json`: muted/page 6.01:1, warning/notice 7.06:1, selected badge/soft accent 12.35:1, neutral action/surface 14.90:1, heading/page 13.78:1. These measurements describe those specific rendered states, not every possible state. There is one deliberate light theme and a forced-colors focus/selection override. No dark theme or gradients are implemented.

## Typography

The global family is `Segoe UI`, `-apple-system`, `BlinkMacSystemFont`, Arial, sans-serif. The display heading uses Georgia, Times New Roman, serif. These are platform fonts; there are no remote requests or font files. Platform availability determines the face.

The base is 16px with unitless line-height 1.55. Body uses weight 400; controls and section headings use 600. `--text-small` is .8125rem (13px), `--text-body` 1rem and `--text-section` 1.5rem (24px). H1 is `clamp(3rem, 5.4vw, 4.75rem)`, weight 400, letter-spacing −.055em. H2 is 1.5rem/−.035em; H3 is 1.125rem/−.02em. Headings use line-height 1.12 and balanced wrapping. Eyebrows are .75rem, uppercase via CSS, .1em tracking, weight 600.

Descriptions wrap with `text-wrap: pretty`; extended rules cap at 75ch. Changing amounts, blocks and rounds use tabular numbers. Balances use 1.875rem desktop, 1.5rem mobile; detail statistics use 1.375rem, then 1.125rem. Amounts can wrap without truncating precision. Inputs remain 16px. Address links expose the full address through their explorer destination/title and isolate abbreviated address direction with `bdi` where used.

## Layout

`.shell` is at most 1200px with 40px inline padding. Header, main and footer share that alignment. A 4px-based spacing vocabulary uses 8/12/16px within components and 24/32/40px between groups. The hero grid is 1.3:1 with an 80px gap; the work area is 1:1.4 with a 40px gap. The balance row has three equal columns. Details use four statistics columns, auto-fit seat cards of at least 150px, and two action columns.

At 960px, shell padding becomes 28px, work columns tighten to 1:1.1, and circle-row metadata wraps below. At 760px, hero/work/action grids become one column, detail statistics become two columns, and notices/header content wrap. At 480px, shell and panels use 20px padding, balances become stacked label/value rows and footer links stack. Controls remain inset. These are content-driven adaptations of this page, not a universal device taxonomy.

Browser checks covered widths 320, 390, 760, 960 and 1440, with no horizontal overflow. The 390px RTL mirror and 200% root text test also stayed within the viewport. There is no fixed/sticky chrome, horizontal carousel, overlay or scroll trap. Other browsers and native devices remain unverified.

## Elevation & Depth

The page is flat: no box shadows. Background tone groups the bond summary and notices; 1px borders communicate fields, cards, selection and section boundaries. There are no modal layers. The keyboard skip link uses z-index 5 only when focused.

## Shapes

Panels use `--radius: 16px`; controls use `--radius-control: 8px`; inset summaries/notices use 10px; status/count chips use a pill radius. The brand mark is three overlapping CSS circles. The corresponding locally authored SVG favicon is `web/public/favicon.svg`. Decorative marks and arrows are hidden from assistive technology. These simple geometric assets require no raster dependencies.

## Components

- `Mark` in `App.tsx`: decorative three-circle brand symbol reused in the header, loading/empty state and footer.
- `Stat`: semantic `dt`/`dd` pair for live wallet and circle values. Callers supply the label and value; absent wallet values use an em dash rather than a misleading zero.
- `AddressLink`: explorer link derived from the runtime deployment network. Opens separately with `rel="noreferrer"`; supports an explicit label or abbreviated address.
- `payment(...)`: local approval/payment pattern. Two separately labeled buttons show exact required CIRC, allowance state, balance shortfall and prerequisite text. Approval never implies payment completion. Sufficient allowance displays “Approved”; invalid eligibility disables both steps.
- Buttons: neutral outlined default, `.primary` for connection (disconnected) or create (connected), `.compact` for refresh. Native disabled states remain legible; pending work disables writes. Hover changes background. Keyboard focus has a visible perimeter.
- Fields: persistent labels, 16px input text, decimal/numeric keyboards, contextual hints and an announced error region. Inputs remain editable during disconnected reads, while transaction buttons require verified prerequisites.
- Circle rows: native buttons with `aria-pressed`, ID, amount/duration, lifecycle and occupancy; selection uses border plus background. Pagination is explicit, six IDs per page, with direct ID lookup.
- `.seat-grid`: seat number, member explorer link and textual payment/default state. Color is supplemental to words.
- `.feedback`: persistent polite status region for wallet/receipt progress, alerts for errors, and explorer link for submitted hashes. Read failures have a separate alert near the list with Refresh recovery.
- `.rules`: native `details`/`summary` for longer commitment mechanics, keyboard operable without custom ARIA.

The first keyboard target is Skip to content; main is programmatically focusable. All buttons/fields/summary have at least 44px height, verified at the tested widths. Motion is limited to 120ms background/scale feedback; press scale is .96, enabled only when `prefers-reduced-motion: no-preference`. Forced-colors mode uses system Highlight for focus and selection.

## Do's and Don'ts

Reuse `.shell`, `.section-heading`, `Stat`, the field styles and the approval/payment pattern for related work. Keep one green primary action at a time, state exact CIRC amounts before signing, and keep status in text as well as color. Use semantic role tokens, native controls and logical inline/block spacing.

Do not truncate monetary precision, hide an error only in a toast, introduce an extra deployment map, or present approval as a completed payment. Do not add motion, decorative charts or remote assets to fill space. Another page should begin with the same shell/heading rhythm and reuse these patterns; routing must remain static-host compatible.

Design guidance applied from Jakub Krehel's Better Interface, MIT, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e` ([source](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface)). Documentation structure adapted from Paul Bakaus's Impeccable, Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8` ([source](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md)). The pinned local references were read; their text is not redistributed here.
