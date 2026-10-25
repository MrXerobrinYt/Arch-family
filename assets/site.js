import { supabase } from './supabase-client.js';
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const TYPE_LABELS = { partner: 'Партнёры', parent_child: 'Родитель → ребёнок', sibling: 'Брат / сестра', allied_family: 'Союзные семьи', other: 'Другая связь' };
  const KIND_LABELS = { founder: 'Основатель', deputy: 'Заместитель', senior: 'Старший участник', family: 'Семья', allied: 'Союзная семья', other: 'Другие' };
  let model = { settings: {}, members: [], relations: [], layout: [] };
  let zoom = 1;
  let positionMap = new Map();
  let resizeObserver;

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function initials(name) { return (String(name || '?').trim().split(/\s+/).slice(0,2).map(x => x[0] || '').join('').toUpperCase() || '?'); }
  function safeImage(url) { try { const u = new URL(url); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } }
  function showToast(message) { const t = $('toast'); t.textContent = message; t.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => t.classList.remove('show'), 2600); }
  function setConnection(state, text) { const el = $('connectionState'); el.dataset.state = state; el.lastElementChild.textContent = text; }

  async function fetchBoard() {
    $('boardLoading').hidden = false;
    try {
      const [membersRes, layoutRes, relationsRes, settingsRes] = await Promise.all([
        supabase.from('site_family_members').select('id,display_name,avatar_url,primary_role_name,member_kind,bio,is_active,created_at,joined_at').eq('is_active', true).order('created_at', { ascending: true }),
        supabase.from('board_layout').select('member_id,x,y,width,height,z_index').order('z_index', { ascending: true }),
        supabase.from('family_relations').select('id,from_member_id,to_member_id,relation_type,label'),
        supabase.from('board_settings').select('zoom,background_key,settings').eq('id', 1).maybeSingle()
      ]);
      for (const result of [membersRes, layoutRes, relationsRes, settingsRes]) {
        if (result.error) throw result.error;
      }
      const row = settingsRes.data || {};
      const settings = { ...(row.settings || {}) };
      if (row.zoom != null && settings.initialZoom == null) settings.initialZoom = Number(row.zoom);
      if (row.background_key && settings.theme == null) settings.theme = row.background_key === 'sakura' ? 'forest-sakura' : row.background_key;
      const members = (membersRes.data || []).map(m => {
        const item = { id: m.id, name: m.display_name || 'Участник', kind: m.member_kind || 'family' };
        if (settings.publicRoleNames !== false) item.role = m.primary_role_name || m.member_kind || 'Arch';
        if (settings.publicAvatars !== false) item.avatar = m.avatar_url || '';
        if (settings.publicProfileDescription !== false) item.description = m.bio || '';
        if (settings.showJoined && m.joined_at) item.joined = new Date(m.joined_at).toLocaleDateString('ru-RU', { year: 'numeric', month: 'short', day: 'numeric' });
        return item;
      });
      const memberIds = new Set(members.map(m => m.id));
      model = {
        settings,
        members,
        relations: (relationsRes.data || []).map(r => ({ id:r.id, from:r.from_member_id, to:r.to_member_id, type:r.relation_type || 'other', label:r.label || '' })).filter(r => memberIds.has(r.from) && memberIds.has(r.to)),
        layout: (layoutRes.data || []).filter(p => memberIds.has(p.member_id)).map(p => ({ memberId:p.member_id, x:Number(p.x), y:Number(p.y), width:Number(p.width || settings.cardWidth || 210), height:Number(p.height || 226), zIndex:Number(p.z_index || 1) }))
      };
      model.members ||= []; model.relations ||= []; model.layout ||= [];
      applySettings(); calculatePositions(); render();
      setConnection('connected', 'Состав синхронизирован');
      $('footerStatus').textContent = `Источник данных: Supabase · ${model.members.length} участников`;
      if (!model.members.length) { $('emptyTitle').textContent = 'Семейная доска пока пуста'; $('emptyText').textContent = 'Когда бот синхронизирует участников Discord, они появятся здесь.'; }
    } catch (error) {
      model = { settings: {}, members: [], relations: [], layout: [] };
      $('cardsLayer').innerHTML = ''; $('relationLayer').innerHTML = '';
      $('emptyState').hidden = false;
      $('emptyTitle').textContent = 'Не удалось загрузить семейную доску';
      $('emptyText').textContent = error.message || 'Проверьте настройки Supabase и RLS.';
      $('memberCount').textContent = '—'; $('relationCount').textContent = '—';
      setConnection('error', 'Нет связи с Supabase');
      $('footerStatus').textContent = 'Нет данных · проверьте подключение';
      console.error('Arch Family board load error:', error);
    } finally { $('boardLoading').hidden = true; }
  }

  function applySettings() {
    const s = model.settings || {};
    document.title = `${s.siteTitle || 'Arch Family'} — семейная доска`;
    $('brandTitle').textContent = s.siteTitle || 'Arch Family';
    $('brandSubtitle').textContent = s.siteSubtitle || 'Семейная доска';
    $('boardHeading').textContent = s.siteSubtitle || 'Семейная доска';
    document.body.dataset.theme = s.theme || 'forest-sakura';
    const root = document.body.style;
    if (s.accentColor) root.setProperty('--accent', s.accentColor);
    if (s.woodColor) root.setProperty('--wood', s.woodColor);
    if (s.paperColor) root.setProperty('--paper', s.paperColor);
    if (s.inkColor) root.setProperty('--ink', s.inkColor);
    if (s.mutedColor) root.setProperty('--muted', s.mutedColor);
    if (s.fontFamily) document.body.style.fontFamily = s.fontFamily;
    root.setProperty('--card-width', `${Number(s.cardWidth) || 210}px`);
    root.setProperty('--card-radius', `${Number(s.cardRadius) || 14}px`);
    $('searchInput').closest('.search-control').hidden = s.showSearch === false;
    $('roleSelect').hidden = s.showRoleFilter === false;
    $('relationLegend').hidden = s.showRelations === false;
    $('boardHint').textContent = s.showRelations === false ? 'Нажмите на карточку, чтобы открыть профиль.' : 'Нажмите на карточку, чтобы открыть профиль. Линии показывают типы связей.';
    zoom = Number(s.initialZoom) || 0.9;
    if (s.boardBackground === 'forest') {
      $('boardViewport').style.backgroundColor = '#9caa8a';
      $('boardViewport').style.backgroundImage = 'radial-gradient(ellipse at 20% 20%,#dce7c3 0,transparent 45%),repeating-linear-gradient(45deg,#73836c22 0,#73836c22 2px,transparent 2px,transparent 11px)';
    } else if (s.boardBackground === 'cork') {
      $('boardViewport').style.backgroundColor = '#b8a27c';
      $('boardViewport').style.backgroundImage = 'radial-gradient(#735c4030 .75px,transparent .9px),repeating-linear-gradient(4deg,#684b2c0c 0,#684b2c0c 1px,transparent 1px,transparent 4px)';
    } else if (s.boardBackground === 'wood') {
      $('boardViewport').style.backgroundColor = '#a98053';
      $('boardViewport').style.backgroundImage = 'repeating-linear-gradient(3deg,#5d3c211a 0,#5d3c211a 1px,transparent 1px,transparent 4px),repeating-linear-gradient(91deg,#f2d9ac22 0,#f2d9ac22 2px,transparent 2px,transparent 11px)';
    } else {
      $('boardViewport').style.backgroundColor = '#bca17b';
      $('boardViewport').style.backgroundImage = 'radial-gradient(ellipse at 12% 18%,#f3d7a04d,transparent 35%),radial-gradient(ellipse at 82% 76%,#57412d1c,transparent 42%),repeating-linear-gradient(4deg,#684b2c0c 0,#684b2c0c 1px,transparent 1px,transparent 4px),repeating-linear-gradient(92deg,#fff3cf18 0,#fff3cf18 2px,transparent 2px,transparent 13px)';
    }
  }

  function calculatePositions() {
    const s = model.settings || {};
    const cw = Number(s.cardWidth) || 210;
    const gapX = Math.max(22, Number(s.boardPadding) || 38);
    const gapY = Math.max(30, Math.round(gapX * 1.15));
    // Use a logical board width, not the browser viewport, so the initial layout
    // is identical on phones, tablets and desktops until an admin saves positions.
    const logicalWidth = 1280;
    const cols = Math.max(1, Math.floor((logicalWidth - gapX) / (cw + gapX)));
    const allLayout = model.layout || [];
    const has = new Map(allLayout.map(p => [p.memberId, p]));
    const members = model.members || [];
    positionMap = new Map();
    const savedBottom = allLayout.reduce((bottom, p) => Math.max(bottom, (Number(p.y) || 0) + Math.max(Number(p.height) || 226, 226)), 0);
    const fallbackStartY = allLayout.length ? savedBottom + gapY : gapY;
    let newIndex = 0;
    members.forEach(m => {
      const saved = has.get(m.id);
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        positionMap.set(m.id, { x: Math.max(0, saved.x), y: Math.max(0, saved.y), width: Number(saved.width) || cw, height: Number(saved.height) || 226, zIndex: Number(saved.zIndex) || 1 });
      } else {
        const idx = newIndex++;
        const col = idx % cols, row = Math.floor(idx / cols);
        positionMap.set(m.id, { x: gapX + col * (cw + gapX), y: fallbackStartY + row * (226 + gapY), width: cw, height: 226, zIndex: 1 });
      }
    });
  }

  function createCard(member) {
    const s = model.settings || {};
    const p = positionMap.get(member.id) || { x: 24, y: 24, width: s.cardWidth || 210, height: 226, zIndex: 1 };
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'member-card'; card.dataset.memberId = member.id;
    card.style.left = `${p.x}px`; card.style.top = `${p.y}px`; card.style.width = `${p.width || s.cardWidth || 210}px`; card.style.zIndex = String(p.zIndex || 1);
    card.dataset.shadow = s.cardShadow === false ? 'false' : 'true';
    card.setAttribute('aria-label', `Открыть профиль ${member.name || 'участника'}`);
    const avatarHtml = (s.showAvatar !== false && member.avatar && safeImage(member.avatar))
      ? `<img src="${esc(safeImage(member.avatar))}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<span>${esc(initials(member.name))}</span>`;
    card.innerHTML = `<span class="pin" aria-hidden="true">✿</span>${s.showAvatar === false ? '' : `<span class="member-avatar">${avatarHtml}</span>`}<span class="member-name">${esc(member.name || 'Участник')}</span>${s.showRole !== false && member.role ? `<span class="member-role">${esc(member.role)}</span>` : ''}${s.showBio !== false && member.description ? `<span class="member-bio">${esc(member.description)}</span>` : ''}${s.showJoined && member.joined ? `<span class="member-date">С нами с ${esc(member.joined)}</span>` : ''}`;
    card.addEventListener('click', () => openProfile(member.id));
    return card;
  }

  function renderRelations(visibleIds, stageWidth, stageHeight) {
    const svg = $('relationLayer');
    svg.replaceChildren(); svg.style.width = `${stageWidth}px`; svg.style.height = `${stageHeight}px`; svg.setAttribute('viewBox', `0 0 ${stageWidth} ${stageHeight}`);
    if (model.settings?.showRelations === false) return;
    const ns = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(ns, 'defs');
    const marker = document.createElementNS(ns, 'marker'); marker.setAttribute('id','relationArrow'); marker.setAttribute('viewBox','0 0 10 10'); marker.setAttribute('refX','8'); marker.setAttribute('refY','5'); marker.setAttribute('markerWidth','6'); marker.setAttribute('markerHeight','6'); marker.setAttribute('orient','auto-start-reverse');
    const arrow = document.createElementNS(ns,'path'); arrow.setAttribute('d','M 0 0 L 10 5 L 0 10 z'); arrow.setAttribute('fill','#4b8660'); marker.append(arrow); defs.append(marker); svg.append(defs);
    const members = new Map(model.members.map(m => [m.id, m])); const done = new Set();
    for (const r of model.relations) {
      if (!visibleIds.has(r.from) || !visibleIds.has(r.to)) continue;
      const a = positionMap.get(r.from), b = positionMap.get(r.to); if (!a || !b) continue;
      const symmetric = ['partner','sibling','allied_family'].includes(r.type);
      const canonical = [r.type, ...[r.from, r.to].sort()].join(':'); if (symmetric && done.has(canonical)) continue; if (symmetric) done.add(canonical);
      const x1 = a.x + (a.width || 210)/2, y1 = a.y + 108, x2 = b.x + (b.width || 210)/2, y2 = b.y + 108;
      const dx = x2 - x1, dy = y2 - y1; const bend = Math.max(28, Math.min(100, Math.abs(dx)*.16));
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', `M ${x1} ${y1} C ${x1 + (dx >= 0 ? bend : -bend)} ${y1 + dy*.16}, ${x2 - (dx >= 0 ? bend : -bend)} ${y2 - dy*.16}, ${x2} ${y2}`);
      path.setAttribute('class', `relation-path ${r.type}`); if (r.type === 'parent_child') path.setAttribute('marker-end','url(#relationArrow)'); svg.append(path);
      if (r.label && r.label.length < 36) {
        const text = document.createElementNS(ns,'text'); text.setAttribute('x',String((x1+x2)/2)); text.setAttribute('y',String((y1+y2)/2 - 6)); text.setAttribute('text-anchor','middle'); text.setAttribute('class','relation-label'); text.textContent = r.label; svg.append(text);
      }
    }
  }

  function render() {
    const layer = $('cardsLayer'); layer.replaceChildren();
    const query = $('searchInput').value.trim().toLocaleLowerCase('ru'); const role = $('roleSelect').value;
    const roles = [...new Set(model.members.map(m => m.role).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ru'));
    const old = role;
    $('roleSelect').replaceChildren(new Option('Все роли',''));
    roles.forEach(r => $('roleSelect').add(new Option(r,r)));
    if (roles.includes(old)) $('roleSelect').value = old;
    const visible = new Set();
    for (const member of model.members) {
      const searchable = `${member.name || ''} ${member.role || ''} ${member.description || ''}`.toLocaleLowerCase('ru');
      if ((!query || searchable.includes(query)) && (!role || role === member.role)) visible.add(member.id);
      const card = createCard(member); card.hidden = !visible.has(member.id); layer.append(card);
    }
    $('clearSearch').hidden = !$('searchInput').value;
    $('memberCount').textContent = String(model.members.length);
    const activeRels = model.relations.filter(r => model.members.some(m => m.id === r.from) && model.members.some(m => m.id === r.to));
    $('relationCount').textContent = String(activeRels.length);
    $('emptyState').hidden = model.members.length > 0;
    let maxX = $('boardViewport').clientWidth, maxY = $('boardViewport').clientHeight;
    positionMap.forEach(p => { maxX = Math.max(maxX, p.x + p.width + 60); maxY = Math.max(maxY, p.y + Math.max(p.height, 230) + 60); });
    const width = Math.max(maxX, $('boardViewport').clientWidth), height = Math.max(maxY, $('boardViewport').clientHeight);
    $('boardStage').style.width = `${width}px`; $('boardStage').style.height = `${height}px`;
    $('cardsLayer').style.width = `${width}px`; $('cardsLayer').style.height = `${height}px`;
    renderRelations(visible, width, height);
    applyZoom();
  }

  function applyZoom() {
    const stage = $('boardStage'); stage.style.zoom = String(zoom);
    $('zoomLabel').textContent = `${Math.round(zoom*100)}%`;
  }
  function fitBoard() {
    const vp = $('boardViewport');
    const baseWidth = Math.max(1, parseFloat($('boardStage').style.width) || vp.clientWidth);
    const baseHeight = Math.max(1, parseFloat($('boardStage').style.height) || vp.clientHeight);
    zoom = Math.min(1, (vp.clientWidth - 36) / baseWidth, (vp.clientHeight - 36) / baseHeight);
    zoom = Math.max(.35, zoom); applyZoom(); vp.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
  }

  function openProfile(memberId) {
    const m = model.members.find(x => x.id === memberId); if (!m) return;
    $('profileName').textContent = m.name || 'Участник';
    const roleVisible = model.settings?.publicRoleNames !== false && model.settings?.showRole !== false;
    $('profileKind').textContent = roleVisible ? (KIND_LABELS[m.kind] || 'УЧАСТНИК').toLocaleUpperCase('ru') : 'УЧАСТНИК';
    $('profileRole').textContent = roleVisible ? (m.role || KIND_LABELS[m.kind] || 'Участник семьи') : '';
    $('profileRole').hidden = !roleVisible;
    $('profileBio').textContent = m.description || 'Описание профиля пока не добавлено.';
    $('profileBio').hidden = model.settings?.publicProfileDescription === false || !m.description;
    const avatar = $('profileAvatar'); avatar.replaceChildren();
    if (model.settings?.publicAvatars !== false && m.avatar && safeImage(m.avatar)) {
      const img = document.createElement('img'); img.src = safeImage(m.avatar); img.alt = ''; img.referrerPolicy = 'no-referrer'; avatar.append(img);
    } else avatar.textContent = initials(m.name);
    const details = [];
    if (m.joined) details.push(['В семье с', m.joined]);
    if (roleVisible) details.push(['Категория', KIND_LABELS[m.kind] || 'Участник']);
    $('profileDetails').innerHTML = details.map(([k,v]) => `<div class="detail-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('');
    const rawRelations = model.relations.filter(r => r.from === memberId || r.to === memberId);
    const seenRelations = new Set();
    const relations = rawRelations.filter(r => {
      const otherId = r.from === memberId ? r.to : r.from;
      const key = ['partner','sibling','allied_family'].includes(r.type) ? `${r.type}:${[memberId,otherId].sort().join(':')}` : `${r.type}:${r.from}:${r.to}`;
      if (seenRelations.has(key)) return false; seenRelations.add(key); return true;
    });
    const relationBox = $('profileRelations'); relationBox.replaceChildren();
    if (!relations.length) relationBox.innerHTML = '<p class="muted">Нет указанных связей.</p>';
    relations.forEach(r => {
      const other = model.members.find(x => x.id === (r.from === memberId ? r.to : r.from)); if (!other) return;
      const item = document.createElement('div'); item.className = 'relation-chip';
      const name = document.createElement('strong'); name.textContent = other.name || 'Участник';
      const type = document.createElement('span'); type.textContent = TYPE_LABELS[r.type] || 'Другая связь';
      item.append(name,type); relationBox.append(item);
    });
    $('drawerScrim').hidden = false; $('profileDrawer').classList.add('open'); $('profileDrawer').setAttribute('aria-hidden','false'); $('closeDrawer').focus();
  }
  function closeProfile() { $('profileDrawer').classList.remove('open'); $('profileDrawer').setAttribute('aria-hidden','true'); $('drawerScrim').hidden = true; }

  $('zoomIn').addEventListener('click', () => { zoom = Math.min(1.6, Math.round((zoom + .1)*100)/100); applyZoom(); });
  $('zoomOut').addEventListener('click', () => { zoom = Math.max(.35, Math.round((zoom - .1)*100)/100); applyZoom(); });
  $('fitBoard').addEventListener('click', fitBoard);
  $('searchInput').addEventListener('input', render);
  $('clearSearch').addEventListener('click', () => { $('searchInput').value = ''; render(); $('searchInput').focus(); });
  $('roleSelect').addEventListener('change', render);
  $('closeDrawer').addEventListener('click', closeProfile);
  $('drawerScrim').addEventListener('click', closeProfile);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeProfile(); });
  window.addEventListener('resize', () => { calculatePositions(); render(); }, { passive: true });
  fetchBoard().then(() => { if (model.settings?.autoFit !== false) fitBoard(); });
})();
