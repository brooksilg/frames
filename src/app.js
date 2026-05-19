// ── State ──────────────────────────────────────────────
let templates = [];
let stagedImages = [];   // { id, file, img, width, height }
let selectedIds = [];    // ordered list of selected image ids (slot 1, slot 2, …)
let currentTemplate = null;
let currentTemplateIndex = '';
let nextId = 0;

const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d');

// ── IndexedDB for image persistence ───────────────────
const DB_NAME = 'frames-app';
const DB_VERSION = 1;
const STORE_NAME = 'images';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveImageToDB(id, blob, width, height, name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ id, blob, width, height, name });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteImageFromDB(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearImagesDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadAllImagesFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Save UI state to localStorage ─────────────────────
function saveState() {
  localStorage.setItem('frames-templateIndex', currentTemplateIndex);
  localStorage.setItem('frames-selectedIds', JSON.stringify(selectedIds));
  localStorage.setItem('frames-stagedOrder', JSON.stringify(stagedImages.map(i => i.id)));
  localStorage.setItem('frames-nextId', nextId);
}

// ── Load templates ────────────────────────────────────
fetch('templates.json')
  .then(r => r.json())
  .then(data => {
    templates = data;
    const sel = document.getElementById('templateSelect');
    templates.forEach((t, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
    // After templates load, restore persisted state
    restoreState();
  })
  .catch(() => setStatus('Failed to load templates.json', true));

// ── Restore persisted state ───────────────────────────
async function restoreState() {
  try {
    // Restore images from IndexedDB
    const records = await loadAllImagesFromDB();
    if (records.length > 0) {
      // Restore staged order
      const savedOrder = JSON.parse(localStorage.getItem('frames-stagedOrder') || '[]');
      const savedNextId = parseInt(localStorage.getItem('frames-nextId') || '0');
      nextId = savedNextId;

      // Load each image blob into an HTMLImageElement
      const loaded = await Promise.all(records.map(rec => {
        return new Promise((resolve) => {
          const img = new Image();
          const url = URL.createObjectURL(rec.blob);
          img.onload = () => {
            resolve({
              id: rec.id, file: null, img, name: rec.name,
              width: rec.width, height: rec.height,
            });
          };
          img.onerror = () => resolve(null);
          img.src = url;
        });
      }));

      const valid = loaded.filter(Boolean);
      // Sort by saved order
      const orderMap = new Map(savedOrder.map((id, i) => [id, i]));
      valid.sort((a, b) => (orderMap.get(a.id) ?? a.id) - (orderMap.get(b.id) ?? b.id));
      stagedImages = valid;

      // Ensure nextId is higher than any restored id
      const maxId = Math.max(...stagedImages.map(i => i.id), nextId - 1);
      nextId = maxId + 1;
    }

    // Restore template selection
    const savedTemplateIdx = localStorage.getItem('frames-templateIndex');
    if (savedTemplateIdx !== null && savedTemplateIdx !== '' && templates[parseInt(savedTemplateIdx)]) {
      currentTemplateIndex = savedTemplateIdx;
      currentTemplate = templates[parseInt(savedTemplateIdx)];
      document.getElementById('templateSelect').value = savedTemplateIdx;
    }

    // Restore selected IDs (filter out any that no longer exist)
    const savedSelectedIds = JSON.parse(localStorage.getItem('frames-selectedIds') || '[]');
    const stagedIdSet = new Set(stagedImages.map(i => i.id));
    selectedIds = savedSelectedIds.filter(id => stagedIdSet.has(id));

    enforceSlotLimit();
    updateThumbs();
    render();
  } catch (err) {
    console.warn('Failed to restore state:', err);
  }
}

// ── Template selection ────────────────────────────────
document.getElementById('templateSelect').addEventListener('change', e => {
  const idx = e.target.value;
  currentTemplateIndex = idx;
  if (idx === '') { currentTemplate = null; } else { currentTemplate = templates[parseInt(idx)]; }
  enforceSlotLimit();
  updateThumbs();
  render();
  saveState();
});

// When template changes, trim selectedIds to the new imageCount
function enforceSlotLimit() {
  if (!currentTemplate) return;
  const max = currentTemplate.imageCount;
  if (selectedIds.length > max) {
    selectedIds = selectedIds.slice(0, max);
  }
}

// ── Drop zone & file input ────────────────────────────
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', e => {
  handleFiles(e.target.files);
  fileInput.value = '';  // allow re-selecting same files
});

function handleFiles(fileList) {
  const files = [...fileList].filter(f => f.type.startsWith('image/'));
  if (files.length === 0) return;

  let loaded = 0;
  files.forEach(file => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const id = nextId++;
      stagedImages.push({
        id, file, img, name: file.name,
        width: img.naturalWidth, height: img.naturalHeight,
      });
      // Persist the image blob to IndexedDB
      saveImageToDB(id, file, img.naturalWidth, img.naturalHeight, file.name);
      loaded++;
      if (loaded === files.length) {
        updateThumbs();
        render();
        saveState();
      }
    };
    img.onerror = () => setStatus('Failed to load image: ' + file.name, true);
    img.src = url;
  });
}

// ── Selection logic ───────────────────────────────────
function toggleSelect(id) {
  const idx = selectedIds.indexOf(id);
  if (idx !== -1) {
    // Deselect
    selectedIds.splice(idx, 1);
  } else {
    // Select — if slots are full, replace the last slot
    const max = currentTemplate ? currentTemplate.imageCount : 2;
    if (selectedIds.length >= max) {
      selectedIds[selectedIds.length - 1] = id;
    } else {
      selectedIds.push(id);
    }
  }
  updateThumbs();
  render();
  saveState();
}

function removeImage(id) {
  stagedImages = stagedImages.filter(item => item.id !== id);
  selectedIds = selectedIds.filter(sid => sid !== id);
  deleteImageFromDB(id);
  updateThumbs();
  render();
  saveState();
}

function clearAllImages() {
  stagedImages = [];
  selectedIds = [];
  clearImagesDB();
  updateThumbs();
  render();
  saveState();
}

document.getElementById('clearAllBtn').addEventListener('click', clearAllImages);

// ── Thumbnails ────────────────────────────────────────
function updateThumbs() {
  const container = document.getElementById('thumbs');
  container.innerHTML = '';
  document.getElementById('clearAllBtn').style.display = stagedImages.length > 0 ? '' : 'none';
  stagedImages.forEach(item => {
    const slotIndex = selectedIds.indexOf(item.id);
    const isSelected = slotIndex !== -1;

    const wrap = document.createElement('div');
    wrap.className = 'thumb-wrap' + (isSelected ? ' selected' : '');
    wrap.onclick = (e) => {
      if (e.target.classList.contains('remove')) return;
      toggleSelect(item.id);
    };

    const thumb = document.createElement('img');
    thumb.src = item.img.src;

    const btn = document.createElement('button');
    btn.className = 'remove';
    btn.textContent = '×';
    btn.onclick = (e) => { e.stopPropagation(); removeImage(item.id); };

    wrap.appendChild(thumb);
    wrap.appendChild(btn);

    if (isSelected) {
      const badge = document.createElement('span');
      badge.className = 'slot-badge';
      badge.textContent = slotIndex + 1;
      wrap.appendChild(badge);
    }

    container.appendChild(wrap);
  });
}

// ── Status bar ────────────────────────────────────────
function setStatus(msg, isError) {
  const el = document.getElementById('status');
  el.textContent = msg || '';
  el.className = 'status' + (isError ? ' error' : '');
}

// ── Get selected image items in slot order ────────────
function getSelectedItems() {
  return selectedIds.map(id => stagedImages.find(item => item.id === id)).filter(Boolean);
}

// ── Placeholder dimensions (2:3 or 3:2 depending on orientation) ──
function placeholderSize(orientation, useFullSize) {
  // useFullSize: generate realistic pixel dimensions for auto-canvas templates
  if (useFullSize) {
    if (orientation === 'horizontal') return { width: 3600, height: 2400, _placeholder: true };
    return { width: 2400, height: 3600, _placeholder: true };
  }
  if (orientation === 'horizontal') return { width: 3, height: 2, _placeholder: true };
  return { width: 2, height: 3, _placeholder: true };
}

// ── Rendering ─────────────────────────────────────────
function render() {
  const dlBtn = document.getElementById('downloadBtn');
  dlBtn.disabled = true;

  const selected = getSelectedItems();

  if (!currentTemplate) {
    canvas.style.display = 'none';
    if (stagedImages.length > 0) setStatus('Select a template');
    else setStatus('');
    return;
  }

  const t = currentTemplate;
  const allFilled = selected.length >= t.imageCount;

  // Build slot array: real images + placeholders for empty slots
  const slots = [];
  for (let i = 0; i < t.imageCount; i++) {
    if (i < selected.length) {
      slots.push(selected[i]);
    } else {
      let orient;
      if (t.imageCount >= 2) {
        orient = (t.layout === 'stacked') ? 'horizontal' : 'vertical';
      } else if (t.canvasMode === 'auto') {
        orient = 'horizontal';
      } else {
        orient = t.canvas.height > t.canvas.width ? 'vertical' :
                 t.canvas.width > t.canvas.height ? 'horizontal' : 'vertical';
      }
      slots.push(placeholderSize(orient, t.canvasMode === 'auto'));
    }
  }

  // Resolve canvas size — fixed or auto
  let canvasW, canvasH;
  if (t.canvasMode === 'auto' && t.imageCount === 1) {
    const item = slots[0];
    const longest = Math.max(item.width, item.height);
    const pad = Math.round(longest * (t.paddingPercent / 100));
    canvasW = item.width + pad * 2;
    canvasH = item.height + pad * 2;
  } else {
    canvasW = t.canvas.width;
    canvasH = t.canvas.height;
  }

  // Validate orientation for single-image templates (only if slot is filled)
  if (t.imageCount === 1 && t.orientation !== 'any' && !slots[0]._placeholder) {
    const item = slots[0];
    const isVert = item.height > item.width;
    const isHoriz = item.width > item.height;
    if (t.orientation === 'vertical' && !isVert) {
      setStatus('This template requires a vertical (portrait) image.', true);
      canvas.style.display = 'none';
      return;
    }
    if (t.orientation === 'horizontal' && !isHoriz) {
      setStatus('This template requires a horizontal (landscape) image.', true);
      canvas.style.display = 'none';
      return;
    }
  }

  // Set up canvas at full resolution
  canvas.width = canvasW;
  canvas.height = canvasH;
  canvas.style.display = 'block';

  // Background
  ctx.fillStyle = t.background;
  ctx.fillRect(0, 0, canvasW, canvasH);

  if (t.canvasMode === 'auto' && t.imageCount === 1) {
    renderAutoSingleImage(t, slots[0], canvasW, canvasH);
  } else if (t.imageCount === 1) {
    renderSingleImage(t, slots[0]);
  } else if (t.imageCount === 2) {
    renderDiptych(t, slots);
  }

  if (allFilled) {
    dlBtn.disabled = false;
    setStatus(`Preview: ${canvasW}×${canvasH}px`);
  } else {
    setStatus(`Select ${t.imageCount - selected.length} more image(s)`);
  }
}

// ── Resize helpers ────────────────────────────────────
function resizeToLargestSide(item, maxSide) {
  const scale = maxSide / Math.max(item.width, item.height);
  return { w: Math.round(item.width * scale), h: Math.round(item.height * scale) };
}

function fitInBox(item, maxW, maxH) {
  const scale = Math.min(maxW / item.width, maxH / item.height);
  return { w: Math.round(item.width * scale), h: Math.round(item.height * scale) };
}

// ── Draw a single slot (image or placeholder) ────────
function drawSlot(item, x, y, w, h, rule) {
  if (rule && rule.border) {
    const bw = rule.border.width;
    ctx.fillStyle = rule.border.color;
    ctx.fillRect(x - bw, y - bw, w + bw * 2, h + bw * 2);
  }

  if (item._placeholder) {
    ctx.fillStyle = '#d0d0d0';
    ctx.fillRect(x, y, w, h);
  } else {
    ctx.drawImage(item.img, x, y, w, h);
  }
}

// ── Single image ──────────────────────────────────────
function renderSingleImage(t, item) {
  const rule = t.images[0];
  const { w, h } = resizeToLargestSide(item, rule.resizeLargestSide);
  const drawX = Math.round((t.canvas.width - w) / 2);
  const drawY = Math.round((t.canvas.height - h) / 2);

  drawSlot(item, drawX, drawY, w, h, rule);
}

// ── Auto-canvas single image (padding-based) ───────
function renderAutoSingleImage(t, item, canvasW, canvasH) {
  const rule = t.images ? t.images[0] : {};
  // Image is drawn at native size; padding is baked into canvasW/canvasH
  const drawW = item.width;
  const drawH = item.height;
  const drawX = Math.round((canvasW - drawW) / 2);
  const drawY = Math.round((canvasH - drawH) / 2);

  drawSlot(item, drawX, drawY, drawW, drawH, rule);
}

// ── Diptych (2 images) ───────────────────────────────
function renderDiptych(t, slots) {
  const gap = t.gap || 40;
  const layout = t.layout || 'side-by-side';
  const items = slots.slice(0, 2);

  if (layout === 'side-by-side') {
    const sizes = items.map((item, i) =>
      fitInBox(item, t.images[i].maxWidth, t.images[i].maxHeight)
    );
    const spacingX = (t.canvas.width - sizes[0].w - sizes[1].w) / 3;

    const positions = [
      { x: Math.round(spacingX),
        y: Math.round((t.canvas.height - sizes[0].h) / 2) },
      { x: Math.round(spacingX + sizes[0].w + spacingX),
        y: Math.round((t.canvas.height - sizes[1].h) / 2) },
    ];

    items.forEach((item, i) => {
      const { x, y } = positions[i];
      drawSlot(item, x, y, sizes[i].w, sizes[i].h, t.images[i]);
    });

  } else if (layout === 'stacked') {
    const sizes = items.map((item, i) =>
      fitInBox(item, t.images[i].maxWidth, t.images[i].maxHeight)
    );
    const spacingY = (t.canvas.height - sizes[0].h - sizes[1].h) / 3;

    const positions = [
      { x: Math.round((t.canvas.width - sizes[0].w) / 2),
        y: Math.round(spacingY) },
      { x: Math.round((t.canvas.width - sizes[1].w) / 2),
        y: Math.round(spacingY + sizes[0].h + spacingY) },
    ];

    items.forEach((item, i) => {
      const { x, y } = positions[i];
      drawSlot(item, x, y, sizes[i].w, sizes[i].h, t.images[i]);
    });
  }
}

// ── Download ──────────────────────────────────────────
function stripExtension(filename) {
  return filename ? filename.replace(/\.[^.]+$/, '') : '';
}

function buildDownloadName() {
  const selected = getSelectedItems();
  const t = currentTemplate;
  if (!t || selected.length === 0) return 'frame.png';

  if (t.imageCount >= 2 && selected.length >= 2) {
    // Diptych: name1--name2--diptych.png
    const names = selected.slice(0, 2).map(item =>
      stripExtension(item.name || item.file?.name || 'image')
    );
    return `${names[0]}--${names[1]}--diptych.png`;
  } else {
    // Single: name--frame.png
    const name = stripExtension(selected[0].name || selected[0].file?.name || 'image');
    return `${name}--frame.png`;
  }
}

document.getElementById('downloadBtn').addEventListener('click', () => {
  if (!currentTemplate) return;
  canvas.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = buildDownloadName();
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/png');
});
