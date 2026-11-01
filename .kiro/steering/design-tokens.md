---
inclusion: always
---

# Design Tokens — CorkBack Foundations

Locked from the Figma "Foundations · Paper and Ink" frame. This doc is the source of truth; `tailwind.config.ts` and `globals.css` mirror it. A civic board, not a social dashboard: three foundations and one accent, one type family, a restrained frame that lets the cork do the talking.

## Palette

| Token | Hex | Role |
|---|---|---|
| Paper | `#FFFDF8` | App background. Always. The signed-in Discovery sidebar stays Paper. |
| Card (white) | `#FFFFFF` | Card surfaces. Paired with the Board border. |
| Board | `#E5DDCC` | Card border and board tone. |
| Ink | `#1E1E1C` | All primary/product text. |
| Dark red | `#8C2B1F` | Pins, selected chips, "Back" in the wordmark, small highlights, and **the one main action per screen only**. |
| Deep navy | `#1F2E4D` | **Limited role only:** View profile, View posting, @handles links, ocean labels, the Desktop active Map link, Desktop Sign in buttons, and the 2px borders on fields and category chips. |

Rule: exactly one dark-red main action per screen. Everything else that is interactive-but-secondary leans navy or neutral. Never introduce a fifth interface color — imagery (flyers) is content, not a fifth color.

## Typography

- Single family: **Kalam**. Regular for plain text, Bold for bold text.
- Editorial headings / expressive flyer titles: 29–34 px (19–24 px mobile headings).
- Card titles: 19–24 px.
- Body: 15 / 22.5. Labels: 13 / 19.5. Metadata: 12 / 18.

## Specific component colors

- **Wordmark**: recreated as text in Kalam Bold. "Back" in dark red, on a dark navy label, white wordmark text. There is no separate vector wordmark file.
- **Scan a flyer**: dark red (the main action).
- **Set an alert**: deep navy (secondary).
- **Fields**: white with a 2px navy border.
- **Category chips**: white with a navy border; selected chip is dark red. Built as text chips in code — there is no separate category icon set.
- **Signed-in profile icon**: white circle, dark-blue border, dark-blue icon.
- **Local maps**: darker tan background so white roads and red pins pop.

## Shape rhythm

- 50px primary controls · 13px card corners · 24px mobile edges · 8 / 12 / 20 / 28 px spacing rhythm.

## Cork texture (Choice A + texture decision)

- Cork is **procedural CSS only** (`.cork-band` in `globals.css`). No image asset, no Wolfgordon swatch, nothing cropped from a PNG.
- Cork appears **only on header bands and empty states**. It is never the global background; the global background is Paper.
