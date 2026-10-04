# Brand sources

The source of the Krama mark and a record of where each picture in the app
came from. Nothing in the build reads this folder.

## The Krama mark: the Forged Stair

Krama is Sanskrit for order, one step after another. The mark is a staircase
that turns back on itself and only ever goes up, with one gold step.

| File | What it is |
| --- | --- |
| `forged-stair.mjs` | Draws the mark. `node brand/forged-stair.mjs` rewrites the three SVGs below. Needs only Node. |
| `krama-mark.svg` | The full mark: twelve steps, an orbit, a glow. For a dark ground. |
| `krama-mark-light.svg` | The full mark in deeper metal, no glow. For a light ground. |
| `krama-mark-small.svg` | The eight-step cut with no orbit. For anything under about 64px. |

Where it appears in the app:

| In the app | Made from |
| --- | --- |
| `components/brand/Logo.tsx` (`LogoMark`) | The small cut, drawn by hand in a 64-unit box on the indigo tile in its gold frame, a tenth larger than its geometry. Same numbers as `forged-stair.mjs`. |
| `app/icon.svg` | The same drawing as `LogoMark`, as a file, for the browser tab. |
| `app/favicon.ico` | `app/icon.svg` at 16, 32 and 48px. |
| `app/apple-icon.png` | `krama-mark.svg` at 172px, centred on the indigo tile, 180x180. No frame: a phone rounds the corners of a touch icon itself and would cut a frame unevenly. |
| `app/opengraph-image.png` | `krama-mark.svg` with the name and the Zetta Metrics credit, 1200x630. |

The PNG and ICO files were rasterised in headless Chromium, which is what the
glow needs (`feGaussianBlur`). Any tool that renders SVG filters will do.

If the geometry changes, change `forged-stair.mjs`, `LogoMark` and
`app/icon.svg` together, then re-render the pictures.

The gold frame (4 Oct 2026) is what lets one mark be seen on every surface:
the product's own dark pages are indigo, and an indigo tile on them had no
edge. It is drawn 2.2 units wide, wholly inside the tile, pale gold at the
top left to deep gold at the bottom right. `LogoMark` and `app/icon.svg`
carry it; change it in both.

## The Zetta Metrics logo

`public/brand/zetta-metrics-emblem.png` and
`public/brand/zetta-metrics-wordmark.png` are cut from the official logo
image Zetta Metrics supplied on 4 Oct 2026: a 1600x900 JPG on a near-black
ground. The ground was removed by reading each pixel's brightness as its
opacity, so the logo's own glow carries onto whatever dark surface it sits
on. They are made for dark surfaces only.

The emblem is the area (150, 190) to (600, 670) of that image and the
wordmark is (620, 300) to (1460, 560), each scaled down. When Zetta Metrics
has a transparent PNG or an SVG of its logo, replace these two files with
it at the same sizes (180x192 and 420x130) and nothing else has to change.
