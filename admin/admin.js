/* Joe's studio — private admin for the gallery.
   How it is protected: the GitHub access token that can edit the site is stored only
   inside admin/vault.json, encrypted (AES-GCM, key from the password via PBKDF2).
   Without the password the vault is useless, and nothing on the public site links here. */
(() => {
  'use strict';

  const PBKDF2_ITER = 600000;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = n => '$' + Number(n).toLocaleString('en-CA');

  let vault = null;          // contents of admin/vault.json
  let token = null, repo = null, branch = 'main';
  let data = null;           // the working copy of data/art.json
  const staged = new Map();  // repo path -> base64 file content waiting to publish
  const deletions = new Set();
  const previews = {};       // image id -> data URL, for pictures not yet on the live site
  const log = [];            // human-readable list of edits, used as the commit message

  /* ---------- small helpers ---------- */
  const b64 = buf => { let s = ''; new Uint8Array(buf).forEach(b => (s += String.fromCharCode(b))); return btoa(s); };
  const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
  const b64utf8 = str => b64(enc.encode(str));
  const show = id => $$('.screen').forEach(s => (s.hidden = s.id !== id));
  function setStatus(el, msg, kind) { el.textContent = msg; el.className = 'status' + (kind ? ' ' + kind : ''); }
  let toastT;
  function toast(msg, bad) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastT); toastT = setTimeout(() => (t.className = 'toast'), bad ? 6000 : 3500);
  }
  function guessRepo() {
    // On GitHub Pages the address tells us owner/repo; on a custom domain the vault says.
    if (location.hostname.endsWith('.github.io')) {
      const owner = location.hostname.split('.')[0];
      const name = location.pathname.split('/').filter(Boolean)[0];
      if (name && name !== 'admin') return owner + '/' + name;
    }
    return 'jdix22/joetrimmeliti';
  }
  const slugify = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'painting';

  /* ---------- crypto ---------- */
  async function keyFrom(pw, salt, iter) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(pw, secret) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFrom(pw, salt, PBKDF2_ITER);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(secret)));
    return { v: 1, repo, branch, iter: PBKDF2_ITER, salt: b64(salt), iv: b64(iv), data: b64(ct) };
  }
  async function unseal(pw, v) {
    const key = await keyFrom(pw, unb64(v.salt), v.iter);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) }, key, unb64(v.data));
    return JSON.parse(dec.decode(pt));
  }

  /* ---------- GitHub ---------- */
  async function gh(path, opts = {}) {
    const res = await fetch('https://api.github.com' + path, {
      ...opts,
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {})
      }
    });
    if (!res.ok) {
      let detail = ''; try { detail = (await res.json()).message; } catch (_) {}
      const err = new Error(`GitHub said ${res.status}${detail ? ': ' + detail : ''}`); err.status = res.status; throw err;
    }
    if (res.status === 204) return null;
    return opts.raw ? res.text() : res.json();
  }

  // One commit containing every staged file and deletion.
  async function commit(files, removals, message) {
    const R = `/repos/${repo}`;
    const ref = await gh(`${R}/git/ref/heads/${branch}`);
    const head = await gh(`${R}/git/commits/${ref.object.sha}`);
    const tree = [];
    for (const [path, content] of files) {
      const blob = await gh(`${R}/git/blobs`, { method: 'POST', body: JSON.stringify({ content, encoding: 'base64' }) });
      tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    if (removals.size) {
      const existing = await gh(`${R}/git/trees/${head.tree.sha}?recursive=1`);
      const have = new Set(existing.tree.map(t => t.path));
      removals.forEach(p => { if (have.has(p) && !files.has(p)) tree.push({ path: p, mode: '100644', type: 'blob', sha: null }); });
    }
    const newTree = await gh(`${R}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: head.tree.sha, tree }) });
    const c = await gh(`${R}/git/commits`, { method: 'POST', body: JSON.stringify({ message, tree: newTree.sha, parents: [ref.object.sha] }) });
    await gh(`${R}/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) });
  }

  async function loadData() {
    const txt = await gh(`/repos/${repo}/contents/data/art.json?ref=${encodeURIComponent(branch)}`, { raw: true, headers: { Accept: 'application/vnd.github.raw+json' } });
    data = JSON.parse(txt);
    data.artworks ||= []; data.events ||= [];
  }

  /* ---------- boot ---------- */
  async function fetchVault() {
    const tries = ['vault.json?t=' + Date.now(), `https://raw.githubusercontent.com/${guessRepo()}/main/admin/vault.json?t=${Date.now()}`];
    for (const url of tries) {
      try { const r = await fetch(url, { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (_) {}
    }
    return null;
  }

  async function boot() {
    if (!window.crypto?.subtle) { show('screen-loading'); $('#screen-loading p').textContent = 'This page must be opened over https.'; return; }
    vault = await fetchVault();
    if (!vault) {
      show('screen-setup');
      $('#setup-form').repo.value = guessRepo();
      return;
    }
    repo = vault.repo; branch = vault.branch || 'main';
    const saved = sessionStorage.getItem('jt-studio');
    if (saved) { token = saved; return enterApp(); }
    show('screen-login');
    $('#login-form').pw.focus();
  }

  /* ---------- setup ---------- */
  $('#setup-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, st = $('.status', f), btn = $('button', f);
    if (f.pw.value.length < 10) return setStatus(st, 'Password needs at least 10 characters.', 'bad');
    if (f.pw.value !== f.pw2.value) return setStatus(st, 'The two passwords don’t match.', 'bad');
    repo = f.repo.value.trim(); branch = f.branch.value.trim() || 'main'; token = f.token.value.trim();
    btn.disabled = true; setStatus(st, 'Checking the token…');
    try {
      await loadData();
      setStatus(st, 'Encrypting and saving…');
      vault = await seal(f.pw.value, { token });
      await commit(new Map([['admin/vault.json', b64utf8(JSON.stringify(vault, null, 2) + '\n')]]), new Set(), 'Studio: set up admin password');
      sessionStorage.setItem('jt-studio', token);
      f.reset();
      toast('Studio is ready. Use the password you just chose to sign in from now on.');
      enterApp();
    } catch (err) {
      token = null;
      setStatus(st, err.status === 401 ? 'That token was not accepted.' : err.status === 403 || err.status === 404 ? 'The token can’t write to that repository. It needs Contents: Read and write.' : err.message, 'bad');
    } finally { btn.disabled = false; }
  });

  /* ---------- login ---------- */
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, st = $('.status', f), btn = $('button', f);
    btn.disabled = true; setStatus(st, 'Unlocking…');
    try {
      const secret = await unseal(f.pw.value, vault);
      token = secret.token;
      sessionStorage.setItem('jt-studio', token);
      f.reset();
      enterApp();
    } catch (_) {
      await new Promise(r => setTimeout(r, 900));
      setStatus(st, 'That password isn’t right.', 'bad');
      f.pw.select();
    } finally { btn.disabled = false; }
  });

  $('#logout').addEventListener('click', () => {
    if (log.length && !confirm('You have unpublished changes. Sign out and lose them?')) return;
    log.length = 0;
    sessionStorage.removeItem('jt-studio');
    location.reload();
  });

  async function enterApp() {
    show('screen-loading');
    $('#screen-loading p').textContent = 'Loading your paintings…';
    try { await loadData(); }
    catch (err) {
      sessionStorage.removeItem('jt-studio');
      if (err.status === 401) { show('screen-login'); setStatus($('#login-form .status'), 'The site’s GitHub token has expired or was revoked. Ask your site manager to renew it.', 'bad'); return; }
      show('screen-login'); setStatus($('#login-form .status'), 'Could not load the gallery: ' + err.message, 'bad'); return;
    }
    show('screen-app');
    renderAll();
  }

  /* ---------- tabs ---------- */
  $$('.tabs button').forEach(b => b.addEventListener('click', () => {
    $$('.tabs button').forEach(x => x.classList.toggle('is-on', x === b));
    $$('.tab-panel').forEach(p => (p.hidden = p.id !== 'tab-' + b.dataset.tab));
  }));

  /* ---------- rendering ---------- */
  const thumbFor = (id, v) => previews[id] || `../img/art/thumb/${id}.jpg${v ? '?v=' + v : ''}`;

  function renderAll() { renderArt(); renderEvents(); renderBar(); }

  function renderArt() {
    const list = data.artworks;
    const avail = list.filter(a => a.status !== 'sold' && !a.hidden).length;
    const sold = list.filter(a => a.status === 'sold' && !a.hidden).length;
    $('#count-line').textContent = `${list.length} paintings · ${avail} available · ${sold} sold`;
    $('#art-list').innerHTML = list.map((a, i) => `
      <li class="art-row${a.hidden ? ' is-hidden-art' : ''}${previews[a.id] ? ' is-new' : ''}" data-i="${i}">
        <div class="order">
          <button data-act="up" aria-label="Move ${esc(a.title)} up" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button data-act="down" aria-label="Move ${esc(a.title)} down" ${i === list.length - 1 ? 'disabled' : ''}>▼</button>
        </div>
        <img class="thumb" src="${thumbFor(a.id, a.v)}" alt="" loading="lazy">
        <div class="art-info">
          <b>${esc(a.title)}</b>
          <small>${esc([a.medium, a.size].filter(Boolean).join(' · ') || 'No details yet')}</small>
          <div class="badges">
            <span class="badge ${a.status === 'sold' ? 'sold' : 'avail'}">${a.status === 'sold' ? 'Sold' : a.price ? money(a.price) : 'Available · Inquire'}</span>
            ${a.featured ? '<span class="badge star">★ Featured</span>' : ''}
            ${a.hidden ? '<span class="badge">Hidden</span>' : ''}
          </div>
        </div>
        <div class="row-actions">
          <button data-act="edit">Edit</button>
          <button data-act="sold">${a.status === 'sold' ? 'Mark available' : 'Mark sold'}</button>
          <button data-act="del" class="del">Delete</button>
        </div>
      </li>`).join('');
  }

  function renderEvents() {
    const list = [...data.events].sort((a, b) => b.date.localeCompare(a.date));
    $('#event-list').innerHTML = list.length ? list.map(e => `
      <li class="event-row" data-id="${esc(e.id)}">
        ${e.image ? `<img class="thumb" src="${thumbFor(e.image)}" alt="">` : '<span class="thumb"></span>'}
        <div class="art-info"><b>${esc(e.title)}</b><small>${esc(e.date)}${e.time ? ' · ' + esc(e.time) : ''} · ${esc(e.venue)}</small></div>
        <div class="row-actions"><button data-act="edit">Edit</button><button data-act="del" class="del">Delete</button></div>
      </li>`).join('') : '<li class="muted">No events yet.</li>';
  }

  function renderBar() {
    $('#publish-bar').hidden = !log.length;
    $('#pending-count').textContent = log.length;
  }

  function changed(what) { log.push(what); renderAll(); }

  /* ---------- painting actions ---------- */
  $('#art-list').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    const i = +btn.closest('.art-row').dataset.i, list = data.artworks, a = list[i];
    switch (btn.dataset.act) {
      case 'up': [list[i - 1], list[i]] = [list[i], list[i - 1]]; changed(`Reorder ${a.title}`); break;
      case 'down': [list[i + 1], list[i]] = [list[i], list[i + 1]]; changed(`Reorder ${a.title}`); break;
      case 'sold':
        a.status = a.status === 'sold' ? 'available' : 'sold';
        if (a.status === 'sold') a.featured = false;
        changed(`Mark ${a.title} ${a.status}`); break;
      case 'edit': openArtEditor(a); break;
      case 'del':
        if (!confirm(`Delete “${a.title}” from the website? This removes the painting and its photo.`)) return;
        list.splice(i, 1);
        ['full', 'thumb'].forEach(k => { const p = `img/art/${k}/${a.id}.jpg`; staged.delete(p); deletions.add(p); });
        delete previews[a.id];
        changed(`Delete ${a.title}`); break;
    }
  });

  // Resize a photo in the browser so uploads stay fast and the site stays quick.
  function loadImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('That file could not be read as an image. Try a JPG or PNG.'));
      im.src = url;
    });
  }
  function resized(im, max, q) {
    const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const w = Math.round(im.naturalWidth * s), h = Math.round(im.naturalHeight * s);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0, w, h);
    const url = c.toDataURL('image/jpeg', q);
    return { w, h, url, b64: url.split(',')[1] };
  }

  const artDlg = $('#art-editor'), artForm = $('#art-form');
  let editing = null, pendingImg = null;

  function dropZone(zone, input, onFile) {
    ['dragenter', 'dragover'].forEach(t => zone.addEventListener(t, e => { e.preventDefault(); zone.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach(t => zone.addEventListener(t, () => zone.classList.remove('is-over')));
    zone.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); });
    input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); });
  }

  dropZone($('#drop'), $('#art-file'), async file => {
    const st = $('#art-status');
    setStatus(st, 'Preparing photo…');
    try {
      const im = await loadImage(file);
      pendingImg = { full: resized(im, 2000, .85), thumb: resized(im, 900, .8) };
      $('#art-preview').src = pendingImg.thumb.url; $('#art-preview').hidden = false;
      $('#drop-msg').innerHTML = '<b>Change photo</b>';
      setStatus(st, '');
    } catch (err) { setStatus(st, err.message, 'bad'); }
  });

  function openArtEditor(a) {
    editing = a || null; pendingImg = null;
    artForm.reset(); $('#art-file').value = '';
    $('#art-editor-title').textContent = a ? 'Edit painting' : 'Add a painting';
    setStatus($('#art-status'), '');
    const pv = $('#art-preview');
    if (a) {
      pv.src = thumbFor(a.id, a.v); pv.hidden = false; $('#drop-msg').innerHTML = '<b>Replace photo</b>';
      artForm.title.value = a.title; artForm.medium.value = a.medium || '';
      const n = (a.size || '').match(/\d+(\.\d+)?/g) || [];
      artForm.sw.value = n[0] || ''; artForm.sh.value = n[1] || '';
      artForm.price.value = a.price ?? ''; artForm.status.value = a.status || 'available';
      artForm.featured.checked = !!a.featured; artForm.hidden.checked = !!a.hidden;
    } else {
      pv.hidden = true; pv.removeAttribute('src');
      $('#drop-msg').innerHTML = '<b>Choose a photo</b> or drag it here<br><small>JPG or PNG. It will be resized automatically.</small>';
    }
    artDlg.showModal();
  }
  $('#add-art').addEventListener('click', () => openArtEditor(null));

  artForm.addEventListener('submit', e => {
    if (e.submitter?.value !== 'save') return;
    const f = artForm, st = $('#art-status');
    const title = f.title.value.trim();
    if (!title) { e.preventDefault(); setStatus(st, 'Please give the painting a title.', 'bad'); f.title.focus(); return; }
    if (!editing && !pendingImg) { e.preventDefault(); setStatus(st, 'Please add a photo of the painting.', 'bad'); return; }
    const sw = parseFloat(f.sw.value), sh = parseFloat(f.sh.value);
    const fields = {
      title,
      medium: f.medium.value.trim(),
      size: sw && sh ? `${sw} × ${sh} in` : '',
      price: f.price.value === '' ? null : Math.round(Number(f.price.value)),
      status: f.status.value
    };
    let a = editing;
    if (!a) {
      const taken = new Set(data.artworks.map(x => x.id));
      let id = slugify(title), n = 2;
      while (taken.has(id)) id = slugify(title) + '-' + n++;
      a = { id, ...fields };
      data.artworks.unshift(a);
    } else Object.assign(a, fields);
    if (f.featured.checked) data.artworks.forEach(x => (x.featured = x === a)); else delete a.featured;
    if (f.hidden.checked) a.hidden = true; else delete a.hidden;
    if (pendingImg) {
      ['full', 'thumb'].forEach(k => {
        const p = `img/art/${k}/${a.id}.jpg`;
        staged.set(p, pendingImg[k].b64); deletions.delete(p);
      });
      a.w = pendingImg.full.w; a.h = pendingImg.full.h;
      if (editing) a.v = Date.now().toString(36); // new photo, so browsers must not use the old cached one
      previews[a.id] = pendingImg.thumb.url;
    }
    changed(`${editing ? 'Edit' : 'Add'} ${title}`);
  });

  /* ---------- events ---------- */
  const evDlg = $('#event-editor'), evForm = $('#event-form');
  let editingEv = null, pendingPoster = null;

  dropZone($('#ev-drop'), $('#ev-file'), async file => {
    try {
      const im = await loadImage(file);
      pendingPoster = resized(im, 900, .82);
      $('#ev-preview').src = pendingPoster.url; $('#ev-preview').hidden = false;
      $('#ev-drop-msg').innerHTML = '<b>Change poster</b>';
    } catch (err) { setStatus($('.status', evForm), err.message, 'bad'); }
  });

  function openEventEditor(ev) {
    editingEv = ev || null; pendingPoster = null;
    evForm.reset(); $('#ev-file').value = ''; setStatus($('.status', evForm), '');
    $('#event-editor-title').textContent = ev ? 'Edit event' : 'Add an event';
    const pv = $('#ev-preview');
    if (ev) {
      ['title', 'date', 'time', 'venue', 'address'].forEach(k => (evForm[k].value = ev[k] || ''));
      if (ev.image) { pv.src = thumbFor(ev.image); pv.hidden = false; $('#ev-drop-msg').innerHTML = '<b>Change poster</b>'; }
      else { pv.hidden = true; $('#ev-drop-msg').innerHTML = '<b>Poster</b> (optional)'; }
    } else { pv.hidden = true; $('#ev-drop-msg').innerHTML = '<b>Poster</b> (optional)'; }
    evDlg.showModal();
  }
  $('#add-event').addEventListener('click', () => openEventEditor(null));

  evForm.addEventListener('submit', e => {
    if (e.submitter?.value !== 'save') return;
    const f = evForm;
    if (!f.title.value.trim() || !f.date.value || !f.venue.value.trim()) {
      e.preventDefault(); setStatus($('.status', f), 'Name, date and venue are needed.', 'bad'); return;
    }
    let ev = editingEv;
    if (!ev) {
      const taken = new Set(data.events.map(x => x.id));
      let id = slugify(f.title.value) + '-' + f.date.value.slice(0, 4), n = 2;
      while (taken.has(id)) id = slugify(f.title.value) + '-' + n++;
      ev = { id }; data.events.push(ev);
    }
    ['title', 'date', 'time', 'venue', 'address'].forEach(k => (ev[k] = f[k].value.trim()));
    if (pendingPoster) {
      ev.image = '_ev-' + ev.id + '-' + Date.now().toString(36);
      const p = `img/art/thumb/${ev.image}.jpg`;
      staged.set(p, pendingPoster.b64); deletions.delete(p);
      previews[ev.image] = pendingPoster.url;
    }
    changed(`${editingEv ? 'Edit' : 'Add'} event ${ev.title}`);
  });

  $('#event-list').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    const id = btn.closest('.event-row').dataset.id, ev = data.events.find(x => x.id === id);
    if (btn.dataset.act === 'edit') return openEventEditor(ev);
    if (!confirm(`Delete the event “${ev.title}”?`)) return;
    data.events = data.events.filter(x => x !== ev);
    if (ev.image) { const p = `img/art/thumb/${ev.image}.jpg`; staged.delete(p); deletions.add(p); }
    changed(`Delete event ${ev.title}`);
  });

  /* ---------- publish ---------- */
  async function publish(extra) {
    const btn = $('#publish');
    btn.disabled = true; btn.textContent = 'Publishing…';
    try {
      const files = new Map(staged);
      files.set('data/art.json', b64utf8(JSON.stringify(data, null, 2) + '\n'));
      if (extra) extra.forEach((v, k) => files.set(k, v));
      const summary = [...new Set(log)];
      const message = 'Studio: ' + (summary.slice(0, 3).join('; ') || 'update') + (summary.length > 3 ? ` (+${summary.length - 3} more)` : '');
      await commit(files, deletions, message);
      staged.clear(); deletions.clear(); log.length = 0;
      renderAll();
      toast('Published! The website will show your changes in a minute or two.');
      return true;
    } catch (err) {
      toast((err.status === 409 || err.status === 422 ? 'The site changed somewhere else. Reload this page and try again. ' : 'Publishing failed. ') + err.message, true);
      return false;
    } finally { btn.disabled = false; btn.textContent = 'Publish to website'; }
  }
  $('#publish').addEventListener('click', () => publish());

  $('#discard').addEventListener('click', async () => {
    if (!confirm('Throw away all unpublished changes?')) return;
    staged.clear(); deletions.clear(); log.length = 0;
    Object.keys(previews).forEach(k => delete previews[k]);
    await loadData(); renderAll();
    toast('Changes discarded.');
  });

  addEventListener('beforeunload', e => { if (log.length) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- change password ---------- */
  $('#pw-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, st = $('.status', f), btn = $('button', f);
    if (f.pw.value.length < 10) return setStatus(st, 'At least 10 characters, please.', 'bad');
    if (f.pw.value !== f.pw2.value) return setStatus(st, 'The two passwords don’t match.', 'bad');
    btn.disabled = true; setStatus(st, 'Saving…');
    try {
      const nv = await seal(f.pw.value, { token });
      log.push('Change password');
      const ok = await publish(new Map([['admin/vault.json', b64utf8(JSON.stringify(nv, null, 2) + '\n')]]));
      if (ok) { vault = nv; f.reset(); setStatus(st, 'Password changed. Use the new one next time you sign in.', 'ok'); }
      else setStatus(st, 'Could not save the new password.', 'bad');
    } finally { btn.disabled = false; }
  });

  boot();
})();
