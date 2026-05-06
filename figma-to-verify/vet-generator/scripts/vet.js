/**
 * VET (Visual Element Tree) injector.
 *
 * Inject into a page via CDP Runtime.evaluate.  Calling it twice toggles the overlay off.
 *
 * Pre-injection controls (set on window before injecting):
 *   window.__VET_ROOT__      CSS selector or Element — scope extraction and depth counting to this subtree
 *   window.__VET_MAXLAYERS__ number — max VET nesting layers to show (default 2)
 *
 * Post-injection exports on window:
 *   window.__VET__           Array of node objects (live DOM refs + metadata + .color)
 *   window.__VET_INFO__      JSON-serialisable snapshot — safe to read via CDP returnByValue
 *   window.__VET_ACTUAL_LAYERS__  the maxLayers value actually used
 *
 * VET_INFO entry shape:
 *   { color, rect: {x,y,w,h}, category, depth, tag, id, className, text, cssPath }
 */
(function () {
  const OVERLAY_ID = '__vet_overlay__';

  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    existing.remove();
    console.log('[VET] Previous overlay removed; re-injecting.');
  }

  // ── Colour palette (by DOM depth rank) ──────────────────────────────────────
  const PALETTE = [
    '#2196F3', // blue
    '#FF9800', // orange
    '#9C27B0', // purple
    '#00BCD4', // cyan
    '#795548', // brown
    '#3F51B5', // indigo
    '#FFD600', // yellow
    '#607D8B', // blue-grey
    '#673AB7', // deep purple
    '#FFC107', // amber
  ];

  const SKIP_TAGS = new Set(['script','style','meta','link','noscript','head','title','br']);

  // ── Colour helpers ───────────────────────────────────────────────────────────
  function hasNonTransparent(c) {
    if (!c || c === 'transparent' || c === 'none') return false;
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return true;
    const parts = m[1].split(',').map(Number);
    return parts.length < 4 ? true : parts[3] > 0.02;
  }

  function parseRgba(c) {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(s => parseFloat(s.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length >= 4 ? p[3] : 1 };
  }

  function colorsSimilar(c1, c2, tol = 15) {
    const a = parseRgba(c1), b = parseRgba(c2);
    if (!a || !b) return c1 === c2;
    if (a.a < 0.02 && b.a < 0.02) return true;
    if (a.a < 0.02 || b.a < 0.02) return false;
    return Math.abs(a.r-b.r) < tol && Math.abs(a.g-b.g) < tol && Math.abs(a.b-b.b) < tol;
  }

  // ── Visual-significance helpers ──────────────────────────────────────────────
  function meaningfulBg(el, style) {
    if (style.backgroundImage && style.backgroundImage !== 'none') return true;
    if (!hasNonTransparent(style.backgroundColor)) return false;
    const parent = el.parentElement;
    if (!parent) return true;
    const pb = getComputedStyle(parent).backgroundColor;
    return !hasNonTransparent(pb) || !colorsSimilar(style.backgroundColor, pb);
  }

  function hasBorder(style) {
    for (const side of ['Top','Right','Bottom','Left']) {
      if (parseFloat(style['border'+side+'Width']) > 0
        && style['border'+side+'Style'] !== 'none'
        && hasNonTransparent(style['border'+side+'Color'])) return true;
    }
    return false;
  }

  function hasShadow(style) { return style.boxShadow && style.boxShadow !== 'none'; }

  function hasDirectText(el) {
    for (const n of el.childNodes)
      if (n.nodeType === 3 && n.textContent.trim()) return true;
    return false;
  }

  function isVisible(el, style, rect) {
    if (rect.width < 1 || rect.height < 1) return false;
    if (style.display === 'none') return false;
    if (typeof el.checkVisibility === 'function')
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (parseFloat(style.opacity) === 0) return false;
    return true;
  }

  function classify(el, style, rect) {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'img' || tag === 'picture' || tag === 'video' || tag === 'canvas') return 'image';
    if (tag === 'svg') return (rect.width <= 48 && rect.height <= 48) ? 'icon' : 'image';
    if (tag === 'button' || el.getAttribute('role') === 'button') return 'button';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'input';
    if (hasDirectText(el)) return 'text';
    if (meaningfulBg(el, style) || hasBorder(style) || hasShadow(style)) {
      if (rect.width * rect.height < 48*48 && style.backgroundImage !== 'none') return 'icon';
      if (rect.width < 8 || rect.height < 8) return 'decoration';
      return 'container';
    }
    return null;
  }

  function domDepth(el) {
    let d = 0, c = el.parentElement;
    while (c && c !== document.body) { d++; c = c.parentElement; }
    return d;
  }

  // ── CSS path for element identity ────────────────────────────────────────────
  function cssPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id) { seg += '#' + CSS.escape(cur.id); parts.unshift(seg); break; }
      if (cur.className) {
        const cls = [...cur.classList].slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
        if (cls) seg += cls;
      }
      const sibs = cur.parentElement ? [...cur.parentElement.children].filter(c => c.tagName === cur.tagName) : [];
      if (sibs.length > 1) seg += `:nth-of-type(${sibs.indexOf(cur)+1})`;
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  // ── Extract VET nodes ────────────────────────────────────────────────────────
  function extractVET(scopeEl) {
    const nodes = [];
    const scope = scopeEl || document.body;
    for (const el of scope.querySelectorAll('*')) {
      const tag = el.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag) || el.id === OVERLAY_ID) continue;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (!isVisible(el, style, rect)) continue;
      const category = classify(el, style, rect);
      if (!category) continue;
      nodes.push({
        el, category, tag,
        depth: domDepth(el),
        rect: { x: rect.left + scrollX, y: rect.top + scrollY, w: rect.width, h: rect.height },
        area: rect.width * rect.height,
      });
    }
    nodes.sort((a, b) => b.area - a.area);
    return nodes;
  }

  // ── Prune deep nesting ───────────────────────────────────────────────────────
  function pruneDeep(nodes, maxLayers, rootEl) {
    const elSet = new Set(nodes.map(n => n.el));
    return nodes.filter(n => {
      let ancestors = 0, cur = n.el.parentElement;
      while (cur && cur !== rootEl) {
        if (elSet.has(cur)) ancestors++;
        cur = cur.parentElement;
      }
      return ancestors < maxLayers;
    });
  }

  // ── Render overlay ───────────────────────────────────────────────────────────
  function render(nodes) {
    const docW = Math.max(document.documentElement.scrollWidth, innerWidth);
    const docH = Math.max(document.documentElement.scrollHeight, innerHeight);

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.style.cssText =
      `position:absolute;left:0;top:0;width:${docW}px;height:${docH}px;z-index:2147483646;pointer-events:none;`;

    const depthRanks = [...new Set(nodes.map(n => n.depth))].sort((a,b) => a-b);
    const depthColor = new Map(depthRanks.map((d, i) => [d, PALETTE[i % PALETTE.length]]));

    for (const n of nodes) {
      const color = depthColor.get(n.depth);
      n.color = color;
      const box = document.createElement('div');
      box.style.cssText =
        `position:absolute;left:${n.rect.x}px;top:${n.rect.y}px;` +
        `width:${n.rect.w}px;height:${n.rect.h}px;` +
        `border-radius:2px;box-sizing:border-box;background:${color};`;
      box.dataset.vetCategory = n.category;
      box.dataset.vetDepth = n.depth;
      overlay.appendChild(box);
    }
    document.body.appendChild(overlay);
  }

  // ── Main ─────────────────────────────────────────────────────────────────────
  const rootEl = window.__VET_ROOT__
    ? (typeof window.__VET_ROOT__ === 'string' ? document.querySelector(window.__VET_ROOT__) : window.__VET_ROOT__)
    : null;

  const maxLayers = (typeof window.__VET_MAXLAYERS__ === 'number' && window.__VET_MAXLAYERS__ >= 1)
    ? window.__VET_MAXLAYERS__ : 2;

  const vet = pruneDeep(extractVET(rootEl), maxLayers, rootEl);
  render(vet);

  window.__VET__ = vet;
  window.__VET_ACTUAL_LAYERS__ = maxLayers;
  window.__VET_INFO__ = vet.map(n => ({
    color:     n.color,
    rect:      n.rect,
    category:  n.category,
    depth:     n.depth,
    tag:       n.tag,
    id:        n.el.id || '',
    className: n.el.className || '',
    text:      n.el.textContent.trim().slice(0, 80),
    cssPath:   cssPath(n.el),
  }));

  console.log(`[VET] ${vet.length} nodes rendered (maxLayers=${maxLayers}). See window.__VET_INFO__`);
})();
