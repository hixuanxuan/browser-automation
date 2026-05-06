(function () {
  const OVERLAY_ID = '__vet_overlay__';

  // 切换行为：已存在则关闭
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    existing.remove();
    console.log('[VET] Overlay closed.');
    return;
  }

  // ========== 按层深着色：同层同色，共10色循环 ==========
  const DEPTH_PALETTE = [
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
  const VET_ALPHA = 1;

  // ========== 判定工具 ==========
  const SKIP_TAGS = new Set([
    'script', 'style', 'meta', 'link', 'noscript', 'head', 'title', 'br',
  ]);

  function hasNonTransparent(color) {
    if (!color || color === 'transparent' || color === 'none') return false;
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return true;
    const parts = m[1].split(',').map(s => parseFloat(s));
    return parts.length < 4 ? true : parts[3] > 0.02;
  }

  function parseRgba(color) {
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(s => parseFloat(s.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length >= 4 ? p[3] : 1 };
  }

  function colorsAreSimilar(c1, c2, tol = 15) {
    const a = parseRgba(c1), b = parseRgba(c2);
    if (!a || !b) return c1 === c2;
    if (a.a < 0.02 && b.a < 0.02) return true;  // both transparent
    if (a.a < 0.02 || b.a < 0.02) return false;  // one transparent, one not
    return Math.abs(a.r - b.r) < tol && Math.abs(a.g - b.g) < tol && Math.abs(a.b - b.b) < tol;
  }

  // Returns true only when the background adds visual distinction vs parent.
  // A background that matches (or nearly matches) the parent adds nothing visual.
  function hasMeaningfulBg(el, style) {
    if (style.backgroundImage && style.backgroundImage !== 'none') return true;
    if (!hasNonTransparent(style.backgroundColor)) return false;
    const parent = el.parentElement;
    if (!parent) return true;
    const parentBg = getComputedStyle(parent).backgroundColor;
    // Parent is transparent → our background introduces new color → meaningful
    if (!hasNonTransparent(parentBg)) return true;
    // Both opaque → meaningful only if visually distinct
    return !colorsAreSimilar(style.backgroundColor, parentBg);
  }

  function hasBg(style) {
    return hasNonTransparent(style.backgroundColor)
      || (style.backgroundImage && style.backgroundImage !== 'none');
  }

  function hasBorder(style) {
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(style['border' + side + 'Width']) > 0
          && style['border' + side + 'Style'] !== 'none'
          && hasNonTransparent(style['border' + side + 'Color'])) {
        return true;
      }
    }
    return false;
  }

  function hasShadow(style) {
    return style.boxShadow && style.boxShadow !== 'none';
  }

  function hasDirectText(el) {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim()) return true;
    }
    return false;
  }

  function isVisible(el, style, rect) {
    if (rect.width < 1 || rect.height < 1) return false;
    if (style.display === 'none') return false;
    // checkVisibility covers visibility:hidden/collapse, content-visibility:hidden,
    // opacity:0, and all ancestor states — much more thorough than getComputedStyle alone
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }
    // Fallback for older browsers
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
    if (hasMeaningfulBg(el, style) || hasBorder(style) || hasShadow(style)) {
      const area = rect.width * rect.height;
      if (area < 48 * 48 && style.backgroundImage !== 'none') return 'icon';
      if (rect.width < 8 || rect.height < 8) return 'decoration';
      return 'container';
    }
    return null;
  }

  function getDOMDepth(el) {
    let depth = 0;
    let cur = el.parentElement;
    while (cur && cur !== document.body) {
      depth++;
      cur = cur.parentElement;
    }
    return depth;
  }

  // ========== 提取 VET ==========
  function extractVET(scopeEl = null) {
    const nodes = [];
    const scope = scopeEl || document.body;
    const all = scope.querySelectorAll('*');
    for (const el of all) {
      const tag = el.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      if (el.id === OVERLAY_ID) continue;

      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (!isVisible(el, style, rect)) continue;

      const category = classify(el, style, rect);
      if (!category) continue;

      nodes.push({
        el,
        category,
        tag,
        depth: getDOMDepth(el),
        rect: {
          x: rect.left + scrollX,
          y: rect.top + scrollY,
          w: rect.width,
          h: rect.height,
        },
        zIndex: parseInt(style.zIndex, 10) || 0,
        area: rect.width * rect.height,
      });
    }
    nodes.sort((a, b) => b.area - a.area);
    return nodes;
  }

  // ========== 生成 CSS 路径（用于元素定位） ==========
  function getCssPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id) {
        seg += '#' + CSS.escape(cur.id);
        parts.unshift(seg);
        break;
      }
      if (cur.className) {
        const classes = [...cur.classList].slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
        if (classes) seg += classes;
      }
      // Add nth-of-type if needed for uniqueness at this level
      const siblings = cur.parentElement ? [...cur.parentElement.children].filter(c => c.tagName === cur.tagName) : [];
      if (siblings.length > 1) {
        const idx = siblings.indexOf(cur) + 1;
        seg += `:nth-of-type(${idx})`;
      }
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  // ========== 渲染 overlay ==========
  function render(nodes) {
    const docW = Math.max(document.documentElement.scrollWidth, innerWidth);
    const docH = Math.max(document.documentElement.scrollHeight, innerHeight);

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = `
      position:absolute;left:0;top:0;width:${docW}px;height:${docH}px;
      z-index:2147483646;pointer-events:none;
    `;

    const depthSet = [...new Set(nodes.map(n => n.depth))].sort((a, b) => a - b);
    const depthToColor = new Map(depthSet.map((d, i) => [d, DEPTH_PALETTE[i % DEPTH_PALETTE.length]]));

    nodes.forEach(n => {
      const color = depthToColor.get(n.depth);
      n.color = color;  // store color back into node for inspection
      const box = document.createElement('div');
      box.style.cssText = `
        position:absolute;
        left:${n.rect.x}px;top:${n.rect.y}px;
        width:${n.rect.w}px;height:${n.rect.h}px;
        border-radius:2px;
        box-sizing:border-box;
        background:${color};
        opacity:${VET_ALPHA};
      `;
      box.dataset.vetCategory = n.category;
      box.dataset.vetTag = n.tag;
      box.dataset.vetDepth = n.depth;
      overlay.appendChild(box);
    });

    document.body.appendChild(overlay);
  }

  // 去除深层嵌套：保留 VET 树中前 maxLayers 层
  // rootEl: 深度计数的起点，到达 rootEl 时停止向上计数（rootEl 及其祖先不参与计层）
  function removeNestedVetNodes(nodes, maxLayers = 2, rootEl = null) {
    const elSet = new Set(nodes.map(n => n.el));
    return nodes.filter(n => {
      let vetAncestorCount = 0;
      let cur = n.el.parentElement;
      while (cur && cur !== rootEl) {
        if (elSet.has(cur)) vetAncestorCount++;
        cur = cur.parentElement;
      }
      return vetAncestorCount < maxLayers;
    });
  }

  // window.__VET_ROOT__ 可在注入前设置为 CSS selector 或 Element，
  // 设置后深度计数相对于该元素内部，其外部及祖先不计层数
  const rootEl = window.__VET_ROOT__
    ? (typeof window.__VET_ROOT__ === 'string'
        ? document.querySelector(window.__VET_ROOT__)
        : window.__VET_ROOT__)
    : null;

  // window.__VET_MAXLAYERS__ 可在注入前设置，控制 VET 树最大层数，默认 2
  const maxLayers = (typeof window.__VET_MAXLAYERS__ === 'number' && window.__VET_MAXLAYERS__ >= 1)
    ? window.__VET_MAXLAYERS__
    : 2;

  const vet = removeNestedVetNodes(extractVET(rootEl), maxLayers, rootEl);
  render(vet);
  window.__VET__ = vet;
  window.__VET_ACTUAL_LAYERS__ = maxLayers;

  // JSON-serializable snapshot for CDP retrieval
  window.__VET_INFO__ = vet.map(n => ({
    color: n.color,
    rect: n.rect,
    category: n.category,
    depth: n.depth,
    tag: n.tag,
    id: n.el.id || '',
    className: n.el.className || '',
    text: n.el.textContent.trim().slice(0, 80),
    cssPath: getCssPath(n.el),
  }));

  console.log(`[VET] Rendered ${vet.length} nodes (maxLayers=${maxLayers}). Inspect via window.__VET__ / window.__VET_INFO__`);
})();
