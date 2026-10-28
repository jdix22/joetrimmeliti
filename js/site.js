/* Original Impressions — public site.
   All paintings and events come from data/art.json, which the admin page edits. */
(() => {
  'use strict';

  // Inquiries go straight to Joe's inbox through FormSubmit (no account or server needed).
  const INBOX = 'info@joetrimmeliti.com';
  const FORM_ENDPOINT = 'https://formsubmit.co/ajax/' + INBOX;
  const SITE = 'https://joetrimmeliti.com/';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const money = n => '$' + Number(n).toLocaleString('en-CA');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const imgSrc = (a, kind) => `img/art/${kind}/${a.id}.jpg${a.v ? '?v=' + a.v : ''}`;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let ART = [];
  let lbList = [];   // the list the lightbox is paging through
  let lbIndex = 0;

  /* ---------- size helpers ---------- */
  function dims(a) {
    const n = (a.size || '').match(/\d+(\.\d+)?/g);
    if (!n || n.length < 2) return null;
    const [p, q] = n.map(Number);
    // Sizes on the old site were written both ways round, so trust the photo's orientation.
    const long = Math.max(p, q), short = Math.min(p, q);
    return a.w >= a.h ? { w: long, h: short } : { w: short, h: long };
  }
  function sizeClass(a) {
    const d = dims(a);
    if (!d) return 'unknown';
    const m = Math.max(d.w, d.h);
    return m < 16 ? 'small' : m < 36 ? 'medium' : 'large';
  }
  function metaLine(a) { return [a.medium, a.size].filter(Boolean).join(' · '); }
  function altText(a) { return `${a.title} — ${a.medium ? a.medium.toLowerCase() : 'painting'} by Joe Trimmeliti${a.size ? ', ' + a.size : ''}`; }

  /* ---------- galleries ---------- */
  function pieceHTML(a) {
    const sold = a.status === 'sold';
    return `<li class="piece" data-id="${esc(a.id)}" data-size="${sizeClass(a)}">
      <button class="piece-btn" type="button" data-open="${esc(a.id)}" aria-label="View ${esc(a.title)}">
        <span class="piece-frame" style="aspect-ratio:${a.w}/${a.h}">
          <img src="${imgSrc(a, 'thumb')}" alt="${esc(altText(a))}" width="${a.w}" height="${a.h}" loading="lazy" decoding="async">
          <span class="piece-view">View up close</span>
        </span>
        <span class="piece-label">
          <span class="piece-title">${esc(a.title)}</span>
          ${metaLine(a) ? `<span class="label-meta">${esc(metaLine(a))}</span>` : ''}
          ${sold ? '<span class="label-price is-sold">Collected</span>' : a.price ? `<span class="label-price">${money(a.price)}</span>` : '<span class="label-price">Inquire</span>'}
        </span>
      </button>
    </li>`;
  }

  function renderGalleries() {
    const avail = ART.filter(a => a.status !== 'sold');
    const sold = ART.filter(a => a.status === 'sold');
    $('#gallery-available').innerHTML = sortList(avail).map(pieceHTML).join('');
    $('#gallery-sold').innerHTML = sold.map(pieceHTML).join('');
    $$('.piece-frame img').forEach(img => {
      if (img.complete) img.classList.add('is-loaded');
      else img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
    });
    applyFilter();
    $('[data-stat="total"]').textContent = ART.length;
    $('[data-stat="available"]').textContent = avail.length;
    $('[data-stat="sold"]').textContent = sold.length;
    $('#collected').hidden = !sold.length;
  }

  function sortList(list) {
    const mode = $('#sort').value;
    if (mode === 'curated') return list;
    const dir = mode === 'price-asc' ? 1 : -1;
    return [...list].sort((x, y) => ((x.price ?? 1e9) - (y.price ?? 1e9)) * dir);
  }

  let sizeFilter = 'all';
  function applyFilter() {
    let shown = 0;
    $$('#gallery-available .piece').forEach(li => {
      const hide = sizeFilter !== 'all' && li.dataset.size !== sizeFilter;
      li.classList.toggle('is-hidden', hide);
      if (!hide) shown++;
    });
    $('.gallery-empty').hidden = shown > 0;
    masonry();
  }

  // Each piece spans as many 4px grid rows as it is tall.
  function masonry() {
    $$('.gallery .piece:not(.is-hidden)').forEach(li => {
      const pad = parseFloat(getComputedStyle(li).paddingBottom) || 0;
      li.style.setProperty('--span', Math.ceil((li.firstElementChild.getBoundingClientRect().height + pad) / 4));
    });
  }
  let mT;
  addEventListener('resize', () => { clearTimeout(mT); mT = setTimeout(masonry, 120); });
  document.fonts?.ready.then(masonry);

  $$('[data-filter="size"] .chip').forEach(btn => btn.addEventListener('click', () => {
    $$('[data-filter="size"] .chip').forEach(b => b.classList.toggle('is-on', b === btn));
    sizeFilter = btn.dataset.value;
    applyFilter();
  }));
  $('#sort').addEventListener('change', renderGalleries);

  /* ---------- featured ---------- */
  function renderFeatured() {
    const f = ART.find(a => a.featured && a.status !== 'sold') || ART.find(a => a.status !== 'sold');
    const sec = $('#featured');
    if (!f) { sec.hidden = true; return; }
    sec.hidden = false;
    const img = $('.featured-img img', sec);
    img.src = imgSrc(f, 'full');
    img.alt = altText(f);
    img.width = f.w; img.height = f.h;
    $('#featured-title').textContent = f.title;
    $('.label-meta', sec).textContent = metaLine(f);
    $('.label-price', sec).textContent = f.price ? money(f.price) : 'Price on inquiry';
    $$('[data-open]', sec).forEach(b => (b.dataset.open = f.id));
    $('[data-inquire]', sec).dataset.inquire = f.id;
  }

  /* ---------- events ---------- */
  function fmtDate(iso) {
    const d = new Date(iso + 'T12:00:00');
    return { day: d.toLocaleDateString('en-CA', { day: '2-digit' }), mon: d.toLocaleDateString('en-CA', { month: 'short' }), long: d.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) };
  }
  const mapLink = addr => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr);

  function renderEvents(events) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const upcoming = events.filter(e => new Date(e.date + 'T23:59:59') >= today).sort((a, b) => a.date.localeCompare(b.date));
    const past = events.filter(e => !upcoming.includes(e)).sort((a, b) => b.date.localeCompare(a.date));
    $('#events-upcoming').innerHTML = upcoming.length
      ? upcoming.map(e => { const d = fmtDate(e.date); return `
        <article class="event-card">
          <div class="event-date"><b>${d.day}</b><span>${d.mon}</span></div>
          <div><h4>${esc(e.title)}</h4><p>${esc(d.long)}${e.time ? ' · ' + esc(e.time) : ''}</p><p>${esc(e.venue)}${e.address ? ', ' + esc(e.address) : ''}</p></div>
          ${e.address ? `<a class="btn btn-dark" href="${mapLink(e.address)}" target="_blank" rel="noopener">Directions</a>` : ''}
        </article>`; }).join('<div style="height:16px"></div>')
      : `<p class="events-none">No upcoming shows announced yet. <a href="#contact">Get in touch</a> to hear about the next one or to arrange a private viewing.</p>`;
    $('#events-past').innerHTML = past.map(e => { const d = fmtDate(e.date); return `
      <li class="past">
        ${e.image ? `<img src="img/art/thumb/${esc(e.image)}.jpg" alt="Poster for ${esc(e.title)}" loading="lazy" decoding="async">` : '<span></span>'}
        <div><time datetime="${esc(e.date)}">${esc(d.long)}</time><h4>${esc(e.title)}</h4>
        <p>${esc(e.venue)}${e.address ? ` · <a href="${mapLink(e.address)}" target="_blank" rel="noopener">Map</a>` : ''}</p></div>
      </li>`; }).join('');
    $('.events-sub').hidden = !past.length;
    injectEventSchema(upcoming);
  }

  /* ---------- structured data for search engines ---------- */
  function injectArtSchema() {
    const graph = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Paintings by Joe Trimmeliti',
      itemListElement: ART.map((a, i) => {
        const d = dims(a);
        const item = {
          '@type': 'VisualArtwork',
          name: a.title,
          url: SITE + '#art/' + a.id,
          image: SITE + 'img/art/full/' + a.id + '.jpg',
          creator: { '@id': SITE + '#joe' },
          artform: 'Painting',
          artMedium: a.medium || undefined,
          artworkSurface: /canvas/i.test(a.medium) ? 'Canvas' : /wood/i.test(a.medium) ? 'Wood panel' : undefined,
          width: d ? { '@type': 'Distance', name: d.w + ' in' } : undefined,
          height: d ? { '@type': 'Distance', name: d.h + ' in' } : undefined,
          offers: a.status !== 'sold' && a.price ? {
            '@type': 'Offer', price: a.price, priceCurrency: 'CAD',
            availability: 'https://schema.org/InStock', url: SITE + '#art/' + a.id
          } : undefined
        };
        return { '@type': 'ListItem', position: i + 1, item };
      })
    };
    addJSONLD('art-ld', graph);
  }
  function injectEventSchema(upcoming) {
    if (!upcoming.length) return;
    addJSONLD('events-ld', upcoming.map(e => ({
      '@context': 'https://schema.org', '@type': 'ExhibitionEvent', name: e.title, startDate: e.date,
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', eventStatus: 'https://schema.org/EventScheduled',
      location: { '@type': 'Place', name: e.venue, address: e.address },
      performer: { '@id': SITE + '#joe' }, organizer: { '@id': SITE + '#joe' }
    })));
  }
  function addJSONLD(id, data) {
    let s = document.getElementById(id);
    if (!s) { s = document.createElement('script'); s.type = 'application/ld+json'; s.id = id; document.head.appendChild(s); }
    s.textContent = JSON.stringify(data);
  }

  /* ---------- lightbox ---------- */
  const lb = $('#lightbox');
  const lbImg = $('.lb-img', lb);
  const lbZoom = $('.lb-zoom', lb);
  let lastFocus = null;
  let view = 'art';

  document.addEventListener('click', e => {
    const opener = e.target.closest('[data-open]');
    if (opener && opener.dataset.open) { e.preventDefault(); location.hash = 'art/' + opener.dataset.open; }
    const inq = e.target.closest('[data-inquire]');
    if (inq && inq.dataset.inquire) { e.preventDefault(); inquire(ART.find(a => a.id === inq.dataset.inquire)); }
  });

  function listFor(a) {
    if (a.status === 'sold') return ART.filter(x => x.status === 'sold');
    const visible = $$('#gallery-available .piece:not(.is-hidden)').map(li => li.dataset.id);
    const list = visible.includes(a.id) ? visible : sortList(ART.filter(x => x.status !== 'sold')).map(x => x.id);
    return list.map(id => ART.find(x => x.id === id));
  }

  function openArt(id) {
    const a = ART.find(x => x.id === id);
    if (!a) return;
    if (lb.hidden) {
      lastFocus = document.activeElement;
      lb.hidden = false;
      document.documentElement.style.overflow = 'hidden';
      setTimeout(() => $('.lb-close', lb).focus(), 30);
    }
    lbList = listFor(a);
    lbIndex = lbList.indexOf(a);
    showArt(a);
  }

  function showArt(a) {
    unzoom();
    lbImg.classList.add('is-loading');
    const full = new Image();
    full.onload = () => { if (lbList[lbIndex] === a) { lbImg.src = full.src; lbImg.classList.remove('is-loading'); } };
    lbImg.src = imgSrc(a, 'thumb');
    full.src = imgSrc(a, 'full');
    lbImg.alt = altText(a);
    $('#lb-title').textContent = a.title;
    $('.lb-meta', lb).textContent = metaLine(a);
    const price = $('.lb-price', lb);
    const sold = a.status === 'sold';
    price.className = 'label-price lb-price' + (sold ? ' is-sold' : '');
    price.textContent = sold ? 'In a private collection' : a.price ? money(a.price) : 'Price on inquiry';
    $('.lb-inquire', lb).textContent = sold ? 'Ask about a similar piece' : 'Inquire about this piece';
    $('.lb-count', lb).textContent = `${sold ? 'Collected' : 'Available'} · ${lbIndex + 1} / ${lbList.length}`;
    const roomBtn = $('[data-view="room"]', lb);
    roomBtn.disabled = !dims(a);
    roomBtn.title = dims(a) ? '' : 'Size not listed for this painting';
    if (!dims(a) && view === 'room') setView('art');
    if (view === 'room') layoutRoom(a);
    if (view === 'mine') layoutMine(a);
    tint(a);
    document.title = `${a.title} — Joe Trimmeliti`;
  }

  function closeLB() {
    if (lb.hidden) return;
    lb.hidden = true;
    document.documentElement.style.overflow = '';
    document.title = baseTitle;
    if (location.hash.startsWith('#art/')) history.replaceState(null, '', location.pathname + location.search);
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }

  function step(d) {
    if (!lbList.length) return;
    lbIndex = (lbIndex + d + lbList.length) % lbList.length;
    history.replaceState(null, '', '#art/' + lbList[lbIndex].id);
    showArt(lbList[lbIndex]);
  }

  // Tint the lightbox with a deep version of the painting's own average colour.
  const tintCache = {};
  function tint(a) {
    const bg = $('.lb-bg', lb);
    if (tintCache[a.id]) { bg.style.setProperty('--tint', tintCache[a.id]); return; }
    const im = new Image();
    im.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 12;
        const x = c.getContext('2d'); x.drawImage(im, 0, 0, 12, 12);
        const d = x.getImageData(0, 0, 12, 12).data;
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        const n = d.length / 4, k = .32;
        tintCache[a.id] = `rgb(${Math.round(r / n * k)},${Math.round(g / n * k)},${Math.round(b / n * k)})`;
        bg.style.setProperty('--tint', tintCache[a.id]);
      } catch (_) { /* tint is decoration only */ }
    };
    im.src = imgSrc(a, 'thumb');
  }

  // Zoom into the paint — the cursor steers the magnified area.
  function unzoom() { lbZoom.classList.remove('is-zoomed'); }
  function aim(e) {
    const r = lbZoom.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    lbZoom.style.setProperty('--zx', ((p.clientX - r.left) / r.width * 100).toFixed(1) + '%');
    lbImg.style.setProperty('--zx', ((p.clientX - r.left) / r.width * 100).toFixed(1) + '%');
    lbImg.style.setProperty('--zy', ((p.clientY - r.top) / r.height * 100).toFixed(1) + '%');
  }
  lbZoom.addEventListener('click', e => { aim(e); lbZoom.classList.toggle('is-zoomed'); });
  lbZoom.addEventListener('mousemove', e => { if (lbZoom.classList.contains('is-zoomed')) aim(e); });
  lbZoom.addEventListener('touchmove', e => { if (lbZoom.classList.contains('is-zoomed')) { e.preventDefault(); aim(e); } }, { passive: false });
  lbZoom.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); lbZoom.classList.toggle('is-zoomed'); } });

  // "On a wall": painting and an 84-inch sofa drawn at the same scale.
  const SOFA_IN = 84, WALL_IN = 160;
  function layoutRoom(a) {
    const d = dims(a); if (!d) return;
    const wall = $('.room-wall', lb);
    const W = wall.clientWidth, H = wall.clientHeight;
    const px = W / WALL_IN;
    const sofa = $('.room-sofa', lb);
    sofa.style.width = SOFA_IN * px + 'px';
    const sofaTop = H * .88 - (SOFA_IN * px) * (300 / 840);
    const art = $('.room-art', lb);
    art.src = imgSrc(a, 'thumb');
    art.alt = a.title + ' shown to scale above a sofa';
    art.style.width = d.w * px + 'px';
    art.style.height = d.h * px + 'px';
    art.style.top = Math.max(H * .05, sofaTop - 10 * px - d.h * px) + 'px';
  }
  function setView(v) {
    view = v;
    $$('.lb-toggle button', lb).forEach(b => b.classList.toggle('is-on', b.dataset.view === v));
    $('.lb-view-art', lb).hidden = v !== 'art';
    $('.lb-view-room', lb).hidden = v !== 'room';
    $('.lb-view-mine', lb).hidden = v !== 'mine';
    $('.lb-hint', lb).textContent = {
      art: 'Click the painting to zoom into the paint.',
      room: 'Sizes are approximate.',
      mine: 'Drag the painting to place it, or tap your photo to move it there. Your photo never leaves your device.'
    }[v];
    if (v === 'room') layoutRoom(lbList[lbIndex]);
    if (v === 'mine') layoutMine(lbList[lbIndex]);
  }

  // "Your wall": the visitor's own photo, kept only in this browser tab.
  // Size comes from the painting's real inches versus the wall width they enter.
  const mine = { url: null, x: .5, y: .4, frac: 30 };
  const mw = sel => $(sel, lb);
  const mwArt = mw('.mywall-art'), mwStage = mw('.mywall-stage'), mwPhoto = mw('.mywall-photo');
  const mwFt = mw('.mywall-ft input'), mwSize = mw('.mywall-size input');
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const wallInches = () => clamp(parseFloat(mwFt.value) || 10, 2, 60) * 12;

  function layoutMine(a) {
    const has = !!mine.url;
    mw('.mywall-drop').hidden = has;
    mw('.mywall-work').hidden = !has;
    if (!has || !a) return;
    if (mwArt.dataset.id !== a.id) { mwArt.src = imgSrc(a, 'full'); mwArt.dataset.id = a.id; }
    mwArt.alt = a.title + ' placed on your wall';
    const d = dims(a);
    mw('.mywall-ft').hidden = !d;
    if (d) mine.frac = clamp(d.w / wallInches() * 100, 3, 95);
    applyMine();
  }
  function applyMine() {
    mwArt.style.width = mine.frac + '%';
    mwArt.style.left = mine.x * 100 + '%';
    mwArt.style.top = mine.y * 100 + '%';
    mwSize.value = mine.frac;
  }

  function loadWall(file) {
    const msg = mw('.mywall-drop span');
    if (!file) return;
    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () => {
      if (mine.url) URL.revokeObjectURL(mine.url);
      mine.url = url; mine.x = .5; mine.y = .4;
      mwPhoto.src = url;
      msg.classList.remove('is-err');
      layoutMine(lbList[lbIndex]);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      msg.textContent = 'That photo couldn’t be opened here. Please try a JPG or PNG.';
      msg.classList.add('is-err');
    };
    probe.src = url;
  }
  const mwFile = mw('.mywall-file'), mwDrop = mw('.mywall-drop');
  mwFile.addEventListener('change', () => { loadWall(mwFile.files[0]); mwFile.value = ''; });
  ['dragenter', 'dragover'].forEach(t => mwDrop.addEventListener(t, () => mwDrop.classList.add('is-over')));
  ['dragleave', 'drop'].forEach(t => mwDrop.addEventListener(t, () => mwDrop.classList.remove('is-over')));
  mw('.mywall-change').addEventListener('click', () => { mine.url = null; layoutMine(lbList[lbIndex]); });

  // Wall width typed in: resize. Slider moved: work out the wall width it implies,
  // so the scale stays true when browsing to a different painting.
  mwFt.addEventListener('input', () => layoutMine(lbList[lbIndex]));
  mwSize.addEventListener('input', () => {
    mine.frac = parseFloat(mwSize.value);
    const d = dims(lbList[lbIndex]);
    if (d) mwFt.value = Math.round(d.w / (mine.frac / 100) / 12 * 2) / 2;
    applyMine();
  });

  let drag = null;
  const stagePoint = e => { const r = mwStage.getBoundingClientRect(); return { r, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  mwArt.addEventListener('pointerdown', e => {
    e.preventDefault();
    mwArt.setPointerCapture(e.pointerId);
    const p = stagePoint(e);
    drag = { dx: p.x - mine.x, dy: p.y - mine.y };
    mwArt.classList.add('is-dragging');
  });
  mwArt.addEventListener('pointermove', e => {
    if (!drag) return;
    const p = stagePoint(e);
    mine.x = clamp(p.x - drag.dx, 0, 1); mine.y = clamp(p.y - drag.dy, 0, 1);
    applyMine();
  });
  ['pointerup', 'pointercancel'].forEach(t => mwArt.addEventListener(t, () => { drag = null; mwArt.classList.remove('is-dragging'); }));
  mwPhoto.addEventListener('click', e => { const p = stagePoint(e); mine.x = p.x; mine.y = p.y; applyMine(); });

  // Save the mock-up as a JPG, with a small credit line so it travels well when shared.
  mw('.mywall-save').addEventListener('click', async () => {
    const a = lbList[lbIndex];
    const s = Math.min(1, 2400 / Math.max(mwPhoto.naturalWidth, mwPhoto.naturalHeight));
    const W = Math.round(mwPhoto.naturalWidth * s), H = Math.round(mwPhoto.naturalHeight * s);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.drawImage(mwPhoto, 0, 0, W, H);
    const art = new Image(); art.src = imgSrc(a, 'full');
    try { await art.decode(); } catch (_) { return; }
    const aw = W * mine.frac / 100, ah = aw * art.naturalHeight / art.naturalWidth;
    const ax = mine.x * W - aw / 2, ay = mine.y * H - ah / 2;
    x.save();
    x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = aw * .06; x.shadowOffsetY = aw * .03;
    x.fillStyle = '#000'; x.fillRect(ax, ay, aw, ah);
    x.restore();
    x.drawImage(art, ax, ay, aw, ah);
    const fs = Math.max(14, Math.round(W * .016));
    x.font = `500 ${fs}px "Hanken Grotesk", system-ui, sans-serif`;
    x.shadowColor = 'rgba(0,0,0,.7)'; x.shadowBlur = fs * .4;
    x.fillStyle = 'rgba(255,255,255,.92)';
    x.fillText(`“${a.title}” by Joe Trimmeliti · joetrimmeliti.com`, fs, H - fs);
    c.toBlob(b => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(b);
      link.download = `${a.id}-on-my-wall.jpg`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    }, 'image/jpeg', .9);
  });
  $$('.lb-toggle button', lb).forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  addEventListener('resize', () => { if (!lb.hidden && view === 'room') layoutRoom(lbList[lbIndex]); });

  $('.lb-close', lb).addEventListener('click', closeLB);
  $('.lb-bg', lb).addEventListener('click', closeLB);
  $('.lb-prev', lb).addEventListener('click', () => step(-1));
  $('.lb-next', lb).addEventListener('click', () => step(1));
  $('.lb-inquire', lb).addEventListener('click', () => inquire(lbList[lbIndex]));
  document.addEventListener('keydown', e => {
    if (lb.hidden) return;
    if (e.key === 'Escape') closeLB();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'Tab') { // keep focus inside the dialog
      const f = $$('button:not([disabled]), [tabindex="0"]', lb).filter(el => el.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  // swipe between paintings
  let sx = null;
  $('.lb-stage', lb).addEventListener('touchstart', e => { sx = lbZoom.classList.contains('is-zoomed') || view === 'mine' ? null : e.touches[0].clientX; }, { passive: true });
  $('.lb-stage', lb).addEventListener('touchend', e => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    sx = null;
  });

  const baseTitle = document.title;
  function route() {
    const m = location.hash.match(/^#art\/(.+)$/);
    if (m) openArt(decodeURIComponent(m[1]));
    else closeLB();
  }
  addEventListener('hashchange', route);

  /* ---------- inquiries ---------- */
  function inquire(a) {
    closeLB();
    if (a) {
      const sold = a.status === 'sold';
      $('#f-subject').value = sold ? `A piece like "${a.title}"` : `Inquiry: "${a.title}"`;
      const msg = $('textarea[name="message"]');
      if (!msg.value.trim()) msg.value = sold
        ? `Hi Joe, I love "${a.title}". Would you consider a commission in a similar spirit?`
        : `Hi Joe, I'm interested in "${a.title}"${a.size ? ' (' + a.size + ')' : ''}${a.price ? ' listed at ' + money(a.price) : ''}. Is it still available?`;
    }
    $('#contact').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    setTimeout(() => $('input[name="first_name"]').focus({ preventScroll: true }), 700);
  }

  const form = $('#contact-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const status = $('.form-status', form);
    status.className = 'form-status';
    let ok = true;
    $$('input[required], textarea[required]', form).forEach(el => {
      const bad = !el.value.trim() || (el.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value.trim()));
      el.closest('.field').classList.toggle('is-bad', bad);
      if (bad && ok) { el.focus(); ok = false; }
    });
    if (!ok) { status.textContent = 'Please fill in each field with a valid email address.'; status.classList.add('is-err'); return; }
    if (form._honey.value) return; // bots fill hidden fields

    const fd = Object.fromEntries(new FormData(form));
    const btn = $('button[type="submit"]', form);
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const res = await fetch(FORM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: `${fd.first_name} ${fd.last_name}`.trim(),
          email: fd.email,
          subject: fd.subject,
          message: fd.message,
          _subject: `Website inquiry: ${fd.subject}`,
          _template: 'table',
          _replyto: fd.email
        })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || String(out.success) === 'false') throw new Error(out.message || 'Send failed');
      form.reset();
      status.textContent = 'Thank you — your message is on its way to Joe. He’ll be in touch soon.';
      status.classList.add('is-ok');
    } catch (err) {
      status.innerHTML = `Sorry, that didn’t send. Please email <a href="mailto:${INBOX}">${INBOX}</a> or call (416) 569-9668.`;
      status.classList.add('is-err');
    } finally {
      btn.disabled = false; btn.textContent = 'Send message';
    }
  });
  $$('input, textarea', form).forEach(el => el.addEventListener('input', () => el.closest('.field')?.classList.remove('is-bad')));

  /* ---------- chrome: header, menu, reveals, hero lamp ---------- */
  const head = $('.site-head');
  const onScroll = () => head.classList.toggle('is-solid', scrollY > innerHeight * .75);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  const toggle = $('.nav-toggle'), navList = $('#nav-list');
  const setMenu = open => {
    toggle.setAttribute('aria-expanded', open); navList.classList.toggle('is-open', open);
    head.classList.toggle('menu-open', open); document.documentElement.style.overflow = open ? 'hidden' : '';
  };
  toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
  $$('a', navList).forEach(a => a.addEventListener('click', () => setMenu(false)));

  const io = new IntersectionObserver(entries => entries.forEach(en => {
    if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
  }), { rootMargin: '0px 0px -12% 0px' });
  $$('.reveal, .section-head').forEach(el => io.observe(el));

  // highlight the nav link for the section in view
  const navLinks = $$('#nav-list a[href^="#"]');
  const spy = new IntersectionObserver(entries => entries.forEach(en => {
    if (en.isIntersecting) navLinks.forEach(l => l.classList.toggle('is-current', l.getAttribute('href') === '#' + en.target.id));
  }), { rootMargin: '-45% 0px -50% 0px' });
  ['works', 'collected', 'about', 'events', 'contact'].forEach(id => spy.observe(document.getElementById(id)));

  // A gallery lamp that follows the pointer across the dimmed hero painting (drifts by itself on touch screens).
  const lit = $('.hero-lit'), hero = $('.hero');
  if (lit && !reduceMotion) {
    let tx = 70, ty = 40, cx = 70, cy = 40, pointer = false, t0 = performance.now();
    hero.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      const r = hero.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width * 100; ty = (e.clientY - r.top) / r.height * 100; pointer = true;
    });
    hero.addEventListener('pointerleave', () => { pointer = false; });
    const tick = now => {
      if (!pointer) { const t = (now - t0) / 1000; tx = 58 + Math.sin(t * .35) * 26; ty = 42 + Math.cos(t * .27) * 18; }
      cx += (tx - cx) * .07; cy += (ty - cy) * .07;
      lit.style.setProperty('--x', cx.toFixed(2) + '%'); lit.style.setProperty('--y', cy.toFixed(2) + '%');
      if (scrollY < innerHeight) requestAnimationFrame(tick); else waiting = true;
    };
    let waiting = false;
    addEventListener('scroll', () => { if (waiting && scrollY < innerHeight) { waiting = false; requestAnimationFrame(tick); } }, { passive: true });
    requestAnimationFrame(tick);
  }

  $('#year').textContent = new Date().getFullYear();

  /* ---------- boot ---------- */
  fetch('data/art.json?v=' + Date.now(), { cache: 'no-store' })
    .then(r => r.json())
    .then(data => {
      ART = (data.artworks || []).filter(a => !a.hidden);
      renderGalleries();
      renderFeatured();
      renderEvents(data.events || []);
      injectArtSchema();
      route();
    })
    .catch(() => {
      $('#gallery-available').innerHTML = '<li>The gallery could not load. Please refresh the page.</li>';
    });
})();
