# Frames — Photo Layout Tool

A browser-based tool for generating framed photo layouts for social media. Stage as many photos as you want, pick a template, select which images to use, see a live preview, and download a full-resolution PNG.

**Live site:** https://brooksilg.github.io/frames/

## Quick Start

Serve the project directory over HTTP (required for `fetch` to load templates):

```bash
cd frames
python3 -m http.server 8080
```

Open **http://localhost:8080** in your browser.

## Usage

1. **Drag & drop** photos onto the drop zone (or click to browse) — stage as many as you want
2. **Select a template** from the dropdown
3. **Click thumbnails** to select them for the template — a numbered badge shows slot assignment (①, ②)
4. The **live preview** renders immediately on a `<canvas>` at full output resolution
5. Click **Download** to save the result as a PNG

### Selection behavior

- Click an unselected image to assign it to the next open slot
- Click a selected image to deselect it
- If all slots are full, clicking a new image **replaces the last slot** — no need to deselect first
- Switching to a template with fewer slots automatically trims extra selections (e.g., diptych → single drops slot 2)
- Empty slots show a light grey placeholder rectangle in the preview

### Image management

- Remove individual images with the **×** button (appears on hover)
- **Clear all** button removes all staged images at once
- All staged images, selections, and the chosen template **persist across page reloads** (images stored in IndexedDB, UI state in localStorage)

### Validation

- Templates declare how many images they need (1 or 2) — the download button is disabled until all slots are filled
- Orientation-restricted templates (vertical/horizontal) reject mismatched images with an error message

## Project Structure

```
frames/
├── index.html          # HTML shell — two-panel layout, links CSS and JS
├── templates.json      # Template definitions (edit this to add layouts)
├── src/
│   ├── styles.css      # All styling (responsive, masonry thumbnails)
│   └── app.js          # Application logic (staging, selection, rendering, persistence)
└── README.md
```

### `index.html`

Two-panel layout: left panel (1/3 width on desktop) has the drop zone and thumbnail gallery; right panel (2/3 width) has the template selector, status bar, and canvas preview. Falls back to single-column on mobile (<900px).

### `src/styles.css`

Dark-themed UI with:
- Responsive two-panel layout via flexbox
- CSS columns-based masonry grid for thumbnails
- Selection states (blue border + badge), hover-reveal × buttons
- Scaled canvas preview with max-height constraint

### `src/app.js`

All application logic:

| Section | Responsibility |
|---|---|
| State | `templates[]`, `stagedImages[]`, `selectedIds[]`, `currentTemplate` |
| IndexedDB | `openDB()`, `saveImageToDB()`, `deleteImageFromDB()`, `clearImagesDB()`, `loadAllImagesFromDB()` — persists image blobs |
| localStorage | Saves/restores template index, selected IDs, staging order, next ID counter |
| Template loading | Fetches `templates.json`, populates dropdown, then calls `restoreState()` |
| File handling | Drag-and-drop and file input; stages unlimited images |
| Selection logic | `toggleSelect()` — manages slot assignment with replace-last-slot behavior |
| Thumbnails | Masonry grid with selection badges, hover × buttons, clear-all |
| Rendering | Builds slot array (real images + placeholders), validates, draws onto canvas |
| Resize helpers | `resizeToLargestSide()` and `fitInBox()` compute scaled dimensions |
| Draw helpers | `drawSlot()` — draws either an image or a grey placeholder rectangle |
| Single image | Centers one resized image on the canvas, with optional border |
| Diptych | Side-by-side or stacked layout for 2 images, with equal spacing |
| Download | Exports the canvas as a PNG blob and triggers a browser download |

### `templates.json`

An array of template objects. Each template defines:

```jsonc
{
  "name": "Display name",
  "imageCount": 1,              // 1 or 2
  "orientation": "vertical",    // "vertical", "horizontal", or "any"
  "canvas": {
    "width": 3200,
    "height": 4000
  },
  "background": "#ffffff",      // any CSS color

  // For single-image templates:
  "images": [
    {
      "resizeLargestSide": 3800, // scale so the largest dimension equals this
      "border": {                // optional, omit or null for no border
        "width": 10,
        "color": "#000000"
      },
      "position": "center"
    }
  ],

  // For 2-image (diptych) templates, add:
  "layout": "stacked",          // "side-by-side" or "stacked"
  "gap": 40,                    // px gap between images
  "images": [
    {
      "resizeTo": "fit",
      "maxWidth": 3000,
      "maxHeight": 1940,
      "position": "center-top"
    },
    {
      "resizeTo": "fit",
      "maxWidth": 3000,
      "maxHeight": 1940,
      "position": "center-bottom"
    }
  ]
}
```

## Included Templates

| Template | Images | Canvas | Notes |
|---|---|---|---|
| White Frame — Vertical 4×5 | 1 portrait | 3200×4000 | |
| White Frame — Horizontal 5×4 | 1 landscape | 4000×3200 | |
| White Frame + Black Border — Vertical 4×5 | 1 portrait | 3200×4000 | 10px black border |
| White Frame + Black Border — Horizontal 5×4 | 1 landscape | 4000×3200 | 10px black border |
| White Frame — Diptych Vertical 4×5 | 2 | 3200×4000 | Stacked |
| Square White Frame — 1×1 | 1 any | 4000×4000 | |
| Square White Frame + Black Border — 1×1 | 1 any | 4000×4000 | 10px black border |

## Adding a Template

Edit `templates.json` and add a new object to the array. Reload the browser — no build step needed.

## Technical Notes

- **No build tools or dependencies** — vanilla HTML/CSS/JS served as static files
- Rendering uses the Canvas 2D API at full output resolution; the preview is CSS-scaled to fit the viewport
- Images stay in the browser (nothing is uploaded to a server)
- Image blobs are persisted in **IndexedDB**; UI state in **localStorage** — everything survives page reloads
- Download produces a lossless PNG at the exact canvas dimensions defined in the template
