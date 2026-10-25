import { supabase } from '../assets/supabase-client.js';
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const TYPE_LABELS = { partner: 'Партнёры', parent_child: 'Родитель → ребёнок', sibling: 'Брат / сестра', allied_family: 'Союзные семьи', other: 'Другая связь' };
  const KIND_LABELS = { founder: 'Основатель', deputy: 'Заместитель', senior: 'Старший участник', family: 'Участник семьи', allied: 'Союзная семья', other: 'Другие' };
  const THEME_PALETTES = {
    'forest-sakura': { accentColor:'#7ca17a', woodColor:'#5c4430', paperColor:'#f6f0e4', inkColor:'#263328', mutedColor:'#687367' },
    walnut: { accentColor:'#b78b5d', woodColor:'#513820', paperColor:'#f8ebd9', inkColor:'#392b1d', mutedColor:'#87715a' },
    cork: { accentColor:'#9eac72', woodColor:'#8d7452', paperColor:'#fbf3df', inkColor:'#3f3a2c', mutedColor:'#807b67' },
    midnight: { accentColor:'#8aa6b5', woodColor:'#334e55', paperColor:'#edf1ed', inkColor:'#23363b', mutedColor:'#62777b' }
  };
  const VIEW_LABELS = {
    overview: ['Главная панель','Состояние сайта, базы и Discord-интеграции.'],
    appearance: ['Оформление','Название, тема, цвета и типографика сайта.'],
    board: ['Доска и карточки','Фон, расстояния, размеры карточек и виджеты доски.'],
    layout: ['Расположение','Общая раскладка карточек, которая сохраняется для всех.'],
    visibility: ['Публичность','Настройки публичных полей и отображения персональных данных.'],
    relations: ['Связи','Создание и удаление типизированных связей между участниками.'],
    discord: ['Discord-бот','Состояние синхронизации и настройка Discord-интеграции.'],
    roles: ['Роли Discord','Сопоставление Discord Role ID с категориями Arch Family.'],
    database: ['Supabase','Состояние базы данных и используемые таблицы.'],
    backup: ['Резервные копии','Экспорт настроек, раскладки, участников, связей и сопоставлений.'],
    security: ['Безопасность','Пароли, серверные секреты и публичный доступ.']
  };
  const state = { settings: {}, members: [], relations: [], layout: [], roles: [], status: null, dirty: false, view: 'overview', file: null, dragging: null };

  function escapeHtml(str) { return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function toast(message, error = false) { const el = $('adminToast'); el.textContent = message; el.classList.toggle('error', error); el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3300); }
  function markDirty() { state.dirty = true; const el = $('saveIndicator'); el.classList.add('unsaved'); el.classList.remove('saving'); el.innerHTML = '<i></i> Есть несохранённые изменения'; }
  function markSaving() { const el = $('saveIndicator'); el.classList.remove('unsaved'); el.classList.add('saving'); el.innerHTML = '<i></i> Сохранение…'; }
  function markSaved() { state.dirty = false; const el = $('saveIndicator'); el.classList.remove('unsaved','saving'); el.innerHTML = '<i></i> Все настройки сохранены'; }
  function setLoginVisible(visible) { $('loginGate').hidden = !visible; $('adminApp').hidden = visible; if (visible) setTimeout(() => $('adminEmail').focus(), 30); }

  const DEFAULT_SETTINGS = {
    siteTitle:'Arch Family', siteSubtitle:'Семейная доска', theme:'forest-sakura', boardBackground:'sakura',
    accentColor:'#7ca17a', woodColor:'#5c4430', paperColor:'#f6f0e4', inkColor:'#263328', mutedColor:'#687367',
    fontFamily:'Georgia', cardWidth:210, cardRadius:14, cardShadow:true, showAvatar:true, showRole:true,
    showBio:true, showJoined:false, showRelations:true, showSearch:true, showRoleFilter:true, autoFit:true,
    snapGrid:12, initialZoom:0.9, boardPadding:38, publicProfileDescription:true, publicRoleNames:true, publicAvatars:true
  };
  const TYPES = new Set(['partner','parent_child','sibling','allied_family','other']);
  const KINDS = new Set(['founder','deputy','senior','family','allied','other']);
  function normalizeSettings(input = {}) {
    const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const s = { ...DEFAULT_SETTINGS };
    for (const key of ['siteTitle','siteSubtitle']) if (typeof src[key] === 'string') s[key] = src[key].trim().slice(0,key==='siteTitle'?64:120) || DEFAULT_SETTINGS[key];
    if (['forest-sakura','walnut','cork','midnight','custom'].includes(src.theme)) s.theme = src.theme;
    if (['sakura','wood','cork','forest'].includes(src.boardBackground)) s.boardBackground = src.boardBackground;
    if (['Georgia','system-ui','Arial','Trebuchet MS','Verdana'].includes(src.fontFamily)) s.fontFamily = src.fontFamily;
    for (const key of ['accentColor','woodColor','paperColor','inkColor','mutedColor']) if (typeof src[key] === 'string' && /^#[0-9a-f]{6}$/i.test(src[key])) s[key] = src[key];
    for (const [key,min,max] of [['cardWidth',170,300],['cardRadius',0,28],['snapGrid',0,48],['initialZoom',0.45,1.3],['boardPadding',8,100]]) if (Number.isFinite(Number(src[key]))) s[key] = Math.max(min,Math.min(max,Number(src[key])));
    for (const key of ['cardShadow','showAvatar','showRole','showBio','showJoined','showRelations','showSearch','showRoleFilter','autoFit','publicProfileDescription','publicRoleNames','publicAvatars']) if (typeof src[key] === 'boolean') s[key] = src[key];
    return s;
  }
  const no = (data,error) => { if(error) throw new Error(error.message || String(error)); return data; };
  const result = async q => { const r = await q; return no(r.data, r.error); };
  async function currentAdmin(required = true) {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!session) { if (required) throw new Error('Войдите в панель администратора.'); return null; }
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) { if (required) throw new Error('Не удалось проверить сессию.'); return null; }
    if (user.app_metadata?.role !== 'admin') {
      await supabase.auth.signOut();
      if (required) throw new Error('У этой учётной записи нет роли admin в app_metadata.');
      return null;
    }
    return user;
  }
  async function loadDashboardData() {
    await currentAdmin(true);
    const [members, relations, layout, settingsRow, roles] = await Promise.all([
      result(supabase.from('site_family_members').select('id,display_name,avatar_url,primary_role_name,member_kind,bio,is_active,created_at,joined_at').eq('is_active', true).order('created_at')),
      result(supabase.from('family_relations').select('id,from_member_id,to_member_id,relation_type,label,created_at')),
      result(supabase.from('board_layout').select('member_id,x,y,width,height,z_index').order('z_index')),
      result(supabase.from('board_settings').select('zoom,background_key,settings').eq('id',1).maybeSingle()),
      result(supabase.from('role_mapping').select('discord_role_id,discord_role_name,member_kind,display_priority,is_enabled,updated_at').order('display_priority'))
    ]);
    const row = settingsRow || {};
    const settings = normalizeSettings(row.settings || {});
    if (row.zoom != null && row.settings?.initialZoom == null) settings.initialZoom = Number(row.zoom);
    if (row.background_key && !row.settings?.theme) settings.theme = row.background_key === 'sakura' ? 'forest-sakura' : row.background_key;
    const memberIds = new Set(members.map(m=>m.id));
    return {
      settings,
      members,
      relations: relations.filter(r=>memberIds.has(r.from_member_id)&&memberIds.has(r.to_member_id)),
      layout: layout.filter(p=>memberIds.has(p.member_id)).map(p=>({memberId:p.member_id,x:Number(p.x),y:Number(p.y),width:Number(p.width)||settings.cardWidth,height:Number(p.height)||226,zIndex:Number(p.z_index)||1})),
      roles
    };
  }
  async function readStatus(dashboard = null) {
    await currentAdmin(true);
    let db = {state:'error',message:'Supabase недоступен.',members:null};
    try {
      const { count, error } = await supabase.from('family_members').select('id',{count:'exact',head:true}).eq('is_active',true);
      if (error) throw error;
      db={state:'connected',message:'Supabase отвечает напрямую из браузера с применением RLS.',members:count??0};
    } catch(e) { db={state:'error',message:String(e.message||e).slice(0,200),members:null}; }
    let bot={state:'offline',message:'Бот запускается отдельно. Статус обновляется его heartbeat-записью в Supabase.',guildIdConfigured:false,clientConfigured:false,tokenConfigured:false};
    try {
      const row=await result(supabase.from('integration_status').select('state,message,metadata,updated_at').eq('service_name','discord-bot').maybeSingle());
      if(row){const recent=Date.now()-new Date(row.updated_at).getTime()<90000;const meta=row.metadata||{};bot={state:recent?row.state:'offline',message:recent?(row.message||'Бот сообщает статус.'):'Последний heartbeat старше 90 секунд или отсутствует.',guildIdConfigured:Boolean(meta.guildIdConfigured),clientConfigured:Boolean(meta.clientConfigured),tokenConfigured:Boolean(meta.tokenConfigured),guildId:meta.guildId||''};}
    } catch(e) { bot={state:'offline',message:'Нет записи статуса бота. Проверьте миграцию и отдельный процесс Discord.',guildIdConfigured:false,clientConfigured:false,tokenConfigured:false}; }
    return {database:db,bot,admin:{sessionHours:null,secureCookie:location.protocol==='https:',passwordConfigured:true,sessionSecretConfigured:true,authProvider:'Supabase Auth'}};
  }
  async function api(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : {};
    const fail = (message) => { throw new Error(message); };
    // Authentication endpoints are handled through Supabase Auth, not a site server.
    if (path === '/api/admin/session' && method === 'GET') {
      const user = await currentAdmin(false); return {authenticated:Boolean(user)};
    }
    if (path === '/api/admin/login' && method === 'POST') {
      const {data,error}=await supabase.auth.signInWithPassword({email:String(body.email||''),password:String(body.password||'')});
      if(error) fail(error.message || 'Не удалось войти.');
      if(data.user?.app_metadata?.role!=='admin') { await supabase.auth.signOut(); fail('Вход выполнен, но учётная запись не имеет app_metadata.role = admin.'); }
      return {ok:true};
    }
    if (path === '/api/admin/logout' && method === 'POST') { const {error}=await supabase.auth.signOut(); if(error) throw error; return {ok:true}; }
    await currentAdmin(true);

    if (path === '/api/admin/status' && method === 'GET') {
      const dash=await loadDashboardData(); return readStatus(dash);
    }
    if (path === '/api/admin/dashboard' && method === 'GET') return loadDashboardData();
    if (path === '/api/admin/settings' && method === 'GET') return (await loadDashboardData()).settings;
    if (path === '/api/admin/settings' && method === 'PUT') {
      const incoming=body.settings||body; const settings=normalizeSettings(incoming);
      const record={id:1,zoom:Number(settings.initialZoom)||0.9,background_key:String(settings.theme||'forest-sakura'),settings,updated_at:new Date().toISOString()};
      const {error}=await supabase.from('board_settings').upsert(record,{onConflict:'id'}); if(error) throw error;
      return {ok:true,settings};
    }
    if (path === '/api/admin/layout' && method === 'PUT') {
      const rows=body.layout;
      if(!Array.isArray(rows)||rows.length>500) fail('Ожидается массив раскладки до 500 карточек.');
      const clean=rows.map(p=>{
        if(!p.memberId || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y)) || Number(p.x)<0 || Number(p.y)<0 || Number(p.x)>10000 || Number(p.y)>10000) fail('Некорректные координаты карточки.');
        return {member_id:p.memberId,x:Math.min(10000,Number(p.x)),y:Math.min(10000,Number(p.y)),width:Math.min(400,Math.max(140,Number(p.width)||210)),height:Math.min(650,Math.max(150,Number(p.height)||226)),z_index:Math.min(10000,Math.max(1,Math.round(Number(p.zIndex)||1))),updated_at:new Date().toISOString()};
      });
      if(clean.length){const {error}=await supabase.from('board_layout').upsert(clean,{onConflict:'member_id'});if(error)throw error;}
      return {ok:true,saved:clean.length};
    }
    if (path === '/api/admin/test-supabase' && method === 'POST') {
      const start=performance.now();const {count,error}=await supabase.from('family_members').select('id',{count:'exact',head:true}).eq('is_active',true);if(error)throw error;return {ok:true,count:count||0,durationMs:Math.round(performance.now()-start)};
    }
    if (path === '/api/admin/relations' && method === 'POST') {
      const {fromMemberId,toMemberId,type,label=''}=body;
      if(!fromMemberId||!toMemberId||fromMemberId===toMemberId||!TYPES.has(type)) fail('Проверьте участников и тип связи.');
      if(typeof label!=='string'||label.length>120) fail('Подпись связи должна быть короче 120 символов.');
      const rows=[{from_member_id:fromMemberId,to_member_id:toMemberId,relation_type:type,label:label.trim()||null}];
      if(['partner','sibling','allied_family'].includes(type))rows.push({from_member_id:toMemberId,to_member_id:fromMemberId,relation_type:type,label:label.trim()||null});
      const {error}=await supabase.from('family_relations').upsert(rows,{onConflict:'from_member_id,to_member_id,relation_type'});if(error)throw error;return {ok:true};
    }
    const relationDel=path.match(/^\/api\/admin\/relations\/([^/]+)$/);
    if(relationDel&&method==='DELETE'){
      const id=decodeURIComponent(relationDel[1]);
      const rel=await result(supabase.from('family_relations').select('id,from_member_id,to_member_id,relation_type').eq('id',id).maybeSingle());
      if(!rel)fail('Связь не найдена.');
      let q=supabase.from('family_relations').delete().eq('id',id);
      if(['partner','sibling','allied_family'].includes(rel.relation_type)) q=supabase.from('family_relations').delete().eq('relation_type',rel.relation_type).or(`and(from_member_id.eq.${rel.from_member_id},to_member_id.eq.${rel.to_member_id}),and(from_member_id.eq.${rel.to_member_id},to_member_id.eq.${rel.from_member_id})`);
      const {error}=await q;if(error)throw error;return {ok:true};
    }
    if (path === '/api/admin/roles' && method === 'POST') {
      const r=body;if(!/^\d{10,25}$/.test(String(r.discord_role_id||'')))fail('Discord Role ID должен состоять из 10–25 цифр.');
      if(!String(r.discord_role_name||'').trim()||String(r.discord_role_name).length>100)fail('Укажите название Discord-роли.');if(!KINDS.has(r.member_kind))fail('Недопустимая категория роли.');
      const {error}=await supabase.from('role_mapping').upsert({discord_role_id:String(r.discord_role_id),discord_role_name:String(r.discord_role_name).trim(),member_kind:r.member_kind,display_priority:Math.min(9999,Math.max(1,Math.round(Number(r.display_priority)||100))),is_enabled:Boolean(r.is_enabled),updated_at:new Date().toISOString()},{onConflict:'discord_role_id'});if(error)throw error;return {ok:true};
    }
    const roleDel=path.match(/^\/api\/admin\/roles\/([^/]+)$/);
    if(roleDel&&method==='DELETE'){const id=decodeURIComponent(roleDel[1]);const {error}=await supabase.from('role_mapping').delete().eq('discord_role_id',id);if(error)throw error;return {ok:true};}
    if(path==='/api/admin/backup'&&method==='POST'){
      const d=await loadDashboardData();return {format:'arch-family-backup-v2',createdAt:new Date().toISOString(),settings:d.settings,members:d.members.map(m=>({id:m.id,display_name:m.display_name,member_kind:m.member_kind,primary_role_name:m.primary_role_name,avatar_url:m.avatar_url,bio:m.bio,is_active:m.is_active,joined_at:m.joined_at})),relations:d.relations.map(r=>({from_member_id:r.from_member_id,to_member_id:r.to_member_id,relation_type:r.relation_type,label:r.label})),layout:d.layout,roles:d.roles};
    }
    if(path==='/api/admin/restore-settings'&&method==='POST'){
      if(!body||body.format!=='arch-family-backup-v2'||!body.settings||typeof body.settings!=='object')fail('Это не резервная копия Arch Family v2.');
      const settings=normalizeSettings(body.settings);const {error}=await supabase.from('board_settings').upsert({id:1,zoom:Number(settings.initialZoom)||0.9,background_key:String(settings.theme||'forest-sakura'),settings,updated_at:new Date().toISOString()},{onConflict:'id'});if(error)throw error;
      let restoredLayout=0;if(Array.isArray(body.layout)){const clean=body.layout.filter(p=>p.memberId&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y))).slice(0,500).map(p=>({member_id:p.memberId,x:Math.max(0,Math.min(10000,Number(p.x))),y:Math.max(0,Math.min(10000,Number(p.y))),width:Math.max(140,Math.min(400,Number(p.width)||settings.cardWidth||210)),height:Math.max(150,Math.min(650,Number(p.height)||226)),z_index:Math.max(1,Math.min(10000,Math.round(Number(p.zIndex)||1))),updated_at:new Date().toISOString()}));if(clean.length){const r=await supabase.from('board_layout').upsert(clean,{onConflict:'member_id'});if(r.error)throw r.error;restoredLayout=clean.length;}}
      return {ok:true,restoredLayout,settings};
    }
    fail(`Неизвестная операция панели: ${method} ${path}`);
  }
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
  const put = (path, body) => api(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
  const remove = path => api(path, { method: 'DELETE' });

  function showView(id) {
    if (!VIEW_LABELS[id]) return;
    state.view = id;
    document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === `view-${id}`));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === id));
    $('breadcrumbCurrent').textContent = VIEW_LABELS[id][0]; $('pageTitle').textContent = VIEW_LABELS[id][0]; $('pageDescription').textContent = VIEW_LABELS[id][1];
    if (id === 'layout') renderLayout();
    if (id === 'relations') renderRelations();
    if (id === 'roles') renderRoles();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function readSettingsFromForm() {
    const result = { ...state.settings };
    document.querySelectorAll('.setting[data-setting]').forEach(el => {
      const key = el.dataset.setting;
      if (el.type === 'radio') { if (el.checked) result[key] = el.value; }
      else if (el.type === 'checkbox') result[key] = el.checked;
      else if (el.type === 'range' || el.type === 'number') result[key] = Number(el.value);
      else result[key] = el.value;
    });
    return result;
  }
  function fillSettings(settings) {
    state.settings = { ...settings };
    document.querySelectorAll('.setting[data-setting]').forEach(el => {
      const key = el.dataset.setting; const value = settings[key];
      if (el.type === 'radio') el.checked = el.value === value;
      else if (el.type === 'checkbox') el.checked = Boolean(value);
      else if (value !== undefined && value !== null) el.value = String(value);
    });
    updateRangeLabels(); updatePreview();
  }
  function updateRangeLabels() {
    for (const [id, label, unit, multiplier=1] of [['initialZoom','initialZoomLabel','%',100],['boardPadding','boardPaddingLabel',' px',1],['snapGrid','snapGridLabel',' px',1],['cardWidth','cardWidthLabel',' px',1],['cardRadius','cardRadiusLabel',' px',1]]) {
      if ($(id) && $(label)) $(label).textContent = `${Math.round(Number($(id).value) * multiplier)}${unit}`;
    }
  }
  function updatePreview() {
    const s = readSettingsFromForm();
    $('previewTitle').textContent = (s.siteTitle || 'Arch Family').slice(0, 32);
    $('previewRole').textContent = 'Участник семьи';
    $('previewCard').style.background = `linear-gradient(145deg,#fffdf8,${s.paperColor || '#f6f0e4'})`;
    $('previewCard').style.color = s.inkColor || '#263328';
    $('previewCard').style.width = `${Math.max(170,Math.min(300,Number(s.cardWidth)||210))}px`;
    $('previewCard').style.borderRadius = `${Math.max(0,Math.min(28,Number(s.cardRadius)||14))}px`;
    $('previewCard').style.boxShadow = s.cardShadow === false ? '0 2px 9px #28372c16' : '0 17px 38px #38291b33';
    $('previewCard').querySelector('.preview-avatar').style.display = s.showAvatar === false ? 'none' : 'grid';
    $('previewCard').querySelector('p').style.display = s.showBio === false ? 'none' : 'block';
    $('previewRole').style.display = s.showRole === false ? 'none' : 'inline-block';
    const canvas = $('appearancePreview');
    canvas.style.backgroundColor = s.boardBackground === 'forest' ? '#a5b391' : s.boardBackground === 'cork' ? '#c0ae89' : s.boardBackground === 'wood' ? '#a98053' : '#bdab89';
    canvas.style.backgroundImage = s.theme === 'midnight' ? 'linear-gradient(135deg,#2c4447,#6c8080)' : 'repeating-linear-gradient(3deg,#5d3c211a 0,#5d3c211a 1px,transparent 1px,transparent 5px),radial-gradient(ellipse at 10% 10%,#ffeccf66,transparent 40%)';
    canvas.style.boxShadow = `inset 0 0 0 7px ${s.woodColor || '#5c4430'}`;
    $('previewCard').style.fontFamily = s.fontFamily || 'Georgia';
    document.documentElement.style.setProperty('--accent', s.accentColor || '#86a883');
    document.documentElement.style.setProperty('--paper', s.paperColor || '#f6f0e4');
    document.documentElement.style.setProperty('--ink', s.inkColor || '#263328');
  }

  async function saveSettings() {
    const settings = readSettingsFromForm(); markSaving();
    try {
      const result = await put('/api/admin/settings', { settings });
      fillSettings(result.settings || settings); markSaved(); toast('Настройки сайта сохранены в Supabase.');
      await loadDashboard(false);
    } catch (error) { markDirty(); toast(error.message, true); }
  }

  function setStatusTile(id, stateValue, text) {
    const el = $(id); el.textContent = text;
    el.style.color = stateValue === 'connected' || stateValue === 'online' ? '#5f8d60' : stateValue === 'error' || stateValue === 'degraded' ? '#b2655a' : '#a08049';
  }
  function renderStatus(status, dashboard = null) {
    state.status = status;
    const db = status.database || {}; const bot = status.bot || {};
    setStatusTile('overviewDbState', db.state, db.state === 'connected' ? 'Подключена' : db.state === 'not_configured' ? 'Не настроена' : 'Ошибка');
    $('overviewDbText').textContent = db.message || 'Состояние базы данных';
    setStatusTile('overviewBotState', bot.state, bot.state === 'online' ? 'Online' : bot.state === 'degraded' ? 'Частично' : bot.state === 'not_configured' ? 'Не настроен' : bot.state === 'error' ? 'Ошибка' : 'Ожидание');
    $('overviewBotText').textContent = bot.message || 'Отдельный сервис; статус приходит через heartbeat в Supabase';
    $('overviewMembers').textContent = db.members === null || db.members === undefined ? '—' : String(db.members);
    $('overviewRelations').textContent = dashboard ? String(dashboard.relations?.length || 0) : '—';
    $('dbStateBadge').textContent = db.state === 'connected' ? 'Подключена' : db.state === 'not_configured' ? 'Не настроена' : 'Проблема';
    $('dbStateBadge').className = `integration-state ${db.state === 'connected' ? 'good' : 'bad'}`;
    $('discordStateBadge').textContent = bot.state === 'online' ? 'Online' : bot.state === 'not_configured' ? 'Не настроен' : bot.state === 'degraded' ? 'Частично' : 'Offline';
    $('discordStateBadge').className = `integration-state ${bot.state === 'online' ? 'good' : 'bad'}`;
    $('dbConnectionList').innerHTML = connectionRow('good', 'Supabase API', db.message || 'Нет статуса', db.members === null ? '—' : `${db.members} записей`);
    const botRows = [
      connectionRow(bot.tokenConfigured ? 'good' : 'bad', 'Bot Token', bot.tokenConfigured ? 'Токен задан у отдельного процесса бота; сайт его не получает.' : 'Бот ещё не сообщил, что токен настроен.', bot.tokenConfigured ? 'Задан' : 'Нет'),
      connectionRow(bot.clientConfigured ? 'good' : 'bad', 'Client ID', bot.clientConfigured ? 'Приложение Discord указано.' : 'Укажите DISCORD_CLIENT_ID.', bot.clientConfigured ? 'Задан' : 'Нет'),
      connectionRow(bot.guildIdConfigured ? 'good' : 'bad', 'Guild ID', bot.guildIdConfigured ? `Сервер: ${bot.guildId || 'указан'}` : 'Укажите DISCORD_GUILD_ID.', bot.guildIdConfigured ? 'Задан' : 'Нет'),
      connectionRow(bot.state === 'online' ? 'good' : bot.state === 'degraded' ? 'pending' : 'bad', 'Состояние процесса', bot.message || 'Бот не подключён.', bot.state || '—')
    ];
    $('discordConnectionList').innerHTML = botRows.join('');
    const checks = [
      [db.state === 'connected', db.state === 'error' ? 'Supabase отвечает с ошибкой' : 'Соединение с Supabase', db.message || 'Проверка серверной базы'],
      [bot.state === 'online', 'Discord-бот подключён', bot.message || 'Статус интеграции'],
      [Boolean(status.admin?.authProvider), 'Вход в панель', status.admin?.authProvider ? 'Supabase Auth; доступ проверяется через app_metadata.role' : 'Требуется настроить Supabase Auth'],
      [Boolean(status.admin?.secureCookie), 'Защищённое соединение', status.admin?.secureCookie ? 'Сайт открыт по HTTPS.' : 'Перед публикацией используйте HTTPS.']
    ];
    $('overviewChecks').innerHTML = checks.map(([ok,label,small]) => `<div class="check-row"><span class="mini-state ${ok?'good':'bad'}"></span><span>${escapeHtml(label)}</span><small>${escapeHtml(small)}</small></div>`).join('');
    $('securityChecks').innerHTML = [
      [true, 'Секретный ключ Supabase не находится на сайте', 'В сайте только publishable key; серверный ключ хранится отдельно у Discord-бота.'],
      [Boolean(status.admin?.authProvider), 'Доступ к панели защищён', 'Supabase Auth + app_metadata.role = admin + RLS.'],
      [Boolean(status.admin?.secureCookie), 'Защищённое соединение', status.admin?.secureCookie ? 'Сайт открыт по HTTPS.' : 'Опубликуйте сайт по HTTPS.'],
      [db.state === 'connected', 'Supabase доступен по Data API', db.message || 'Проверка подключения.']
    ].map(([ok,label,small]) => `<div class="security-check ${ok?'':'warn'}"><span class="security-check-icon">${ok?'✓':'!'}</span><div><b>${escapeHtml(label)}</b><small>${escapeHtml(small)}</small></div></div>`).join('');
  }
  function connectionRow(stateName, name, desc, value) {
    return `<div class="connection-row"><span class="connection-indicator ${stateName}"></span><div><b>${escapeHtml(name)}</b><small>${escapeHtml(desc)}</small></div><span>${escapeHtml(value)}</span></div>`;
  }

  async function loadDashboard(showToastOnError = true) {
    try {
      const [status, dashboard] = await Promise.all([api('/api/admin/status'), api('/api/admin/dashboard')]);
      state.members = dashboard.members || []; state.relations = dashboard.relations || []; state.layout = dashboard.layout || []; state.roles = dashboard.roles || [];
      fillSettings(dashboard.settings || {});
      renderStatus(status, dashboard); fillRelationSelects(); renderRelations(); renderRoles(); renderLayout(); markSaved();
      if (showToastOnError) toast('Данные панели обновлены.');
      return dashboard;
    } catch (error) { if (showToastOnError) toast(error.message, true); throw error; }
  }
  async function refreshAll() {
    $('refreshButton').disabled = true; $('refreshButton').textContent = 'Проверяем…';
    try { await loadDashboard(true); } catch { /* visible toast */ }
    finally { $('refreshButton').disabled = false; $('refreshButton').textContent = '↻ Обновить статус'; }
  }

  function fillRelationSelects() {
    const selects = [$('relationFrom'), $('relationTo')];
    for (const select of selects) {
      const old = select.value;
      select.replaceChildren(new Option('Выберите участника…',''));
      state.members.slice().sort((a,b) => (a.display_name || '').localeCompare(b.display_name || '', 'ru')).forEach(m => select.add(new Option(m.display_name || 'Участник', m.id)));
      if (state.members.some(m => m.id === old)) select.value = old;
    }
  }
  function visibleRelationList() {
    const seen = new Set(); const output = [];
    for (const r of state.relations) {
      const type = r.type || r.relation_type || 'other'; const from = r.from || r.from_member_id; const to = r.to || r.to_member_id;
      const symmetric = ['partner','sibling','allied_family'].includes(type);
      const key = symmetric ? `${type}:${[from,to].sort().join(':')}` : `${type}:${from}:${to}`;
      if (seen.has(key)) continue; seen.add(key); output.push({ ...r, type, from, to, key });
    }
    return output;
  }
  function renderRelations() {
    fillRelationSelects();
    const box = $('relationsList'); if (!box) return;
    const list = visibleRelationList(); $('relationListCount').textContent = String(list.length);
    if (!list.length) { box.innerHTML = '<div class="list-empty">Связей пока нет. Добавьте первую связь слева или через Discord-команду.</div>'; return; }
    const names = new Map(state.members.map(m => [m.id, m.display_name || 'Участник']));
    box.innerHTML = list.map(r => `<div class="relation-item"><div class="relation-item-main"><b>${escapeHtml(names.get(r.from) || r.fromName || 'Участник')} <span class="relation-arrow">→</span> ${escapeHtml(names.get(r.to) || r.toName || 'Участник')}</b><small>${escapeHtml(r.label || TYPE_LABELS[r.type] || 'Связь')}</small></div><span class="type-pill ${escapeHtml(r.type)}">${escapeHtml(TYPE_LABELS[r.type] || r.type)}</span><button class="delete-button" type="button" data-delete-relation="${escapeHtml(r.id)}" aria-label="Удалить связь">Удалить</button></div>`).join('');
    box.querySelectorAll('[data-delete-relation]').forEach(btn => btn.addEventListener('click', async () => {
      const yes = await confirmAction('Удалить связь?', 'Эта связь и парное направление для симметричных типов будут удалены.'); if (!yes) return;
      try { await remove(`/api/admin/relations/${encodeURIComponent(btn.dataset.deleteRelation)}`); toast('Связь удалена.'); await loadDashboard(false); }
      catch (e) { toast(e.message, true); }
    }));
  }
  $('relationType').addEventListener('change', () => {
    $('relationDirectionHelp').textContent = $('relationType').value === 'parent_child' ? 'Направление важно: участник A — родитель, участник B — ребёнок.' : 'Партнёры, братья/сёстры и союзные семьи сохраняются в обоих направлениях.';
  });
  $('relationForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!$('relationFrom').value || !$('relationTo').value) return toast('Выберите обоих участников.', true);
    if ($('relationFrom').value === $('relationTo').value) return toast('Нельзя связать участника с самим собой.', true);
    try {
      await post('/api/admin/relations', { fromMemberId: $('relationFrom').value, toMemberId: $('relationTo').value, type: $('relationType').value, label: $('relationLabel').value.trim() });
      $('relationLabel').value = ''; toast('Связь сохранена.'); await loadDashboard(false);
    } catch (error) { toast(error.message, true); }
  });

  function renderRoles() {
    const box = $('rolesList'); if (!box) return;
    $('roleCount').textContent = String(state.roles.length);
    if (!state.roles.length) { box.innerHTML = '<div class="list-empty">Нет сопоставлений ролей. Добавьте Discord Role ID слева.</div>'; return; }
    const roles = state.roles.slice().sort((a,b) => Number(a.display_priority) - Number(b.display_priority));
    box.innerHTML = roles.map((r,i) => `<div class="role-item"><span class="role-order">${escapeHtml(r.display_priority ?? i+1)}</span><div class="role-item-main"><b>${escapeHtml(r.discord_role_name)}</b><small>ID: ${escapeHtml(r.discord_role_id)} · ${r.is_enabled?'активна':'отключена'}</small></div><span class="role-kind">${escapeHtml(KIND_LABELS[r.member_kind] || r.member_kind)}</span><button class="delete-button" type="button" data-delete-role="${escapeHtml(r.discord_role_id)}">Удалить</button></div>`).join('');
    box.querySelectorAll('[data-delete-role]').forEach(btn => btn.addEventListener('click', async () => {
      const yes = await confirmAction('Удалить сопоставление роли?', 'Роль Discord останется на сервере, удалится только её привязка к категории сайта.'); if (!yes) return;
      try { await remove(`/api/admin/roles/${encodeURIComponent(btn.dataset.deleteRole)}`); toast('Сопоставление удалено.'); await loadDashboard(false); }
      catch (error) { toast(error.message, true); }
    }));
  }
  $('roleForm').addEventListener('submit', async e => {
    e.preventDefault();
    const body = { discord_role_id: $('roleDiscordId').value.trim(), discord_role_name: $('roleDiscordName').value.trim(), member_kind: $('roleMemberKind').value, display_priority: Number($('rolePriority').value), is_enabled: $('roleEnabled').checked };
    try { await post('/api/admin/roles', body); $('roleForm').reset(); $('roleEnabled').checked = true; toast('Сопоставление роли сохранено.'); await loadDashboard(false); }
    catch (error) { toast(error.message, true); }
  });

  function effectiveLayout() {
    const saved = new Map(state.layout.map(p => [p.memberId || p.member_id, p]));
    const cw = Number(state.settings.cardWidth) || 210; const gap = Math.max(28, Number(state.settings.boardPadding) || 38);
    const cols = Math.max(1, Math.floor((1280 - gap) / (cw + gap)));
    const savedBottom = state.layout.reduce((bottom, p) => Math.max(bottom, (Number(p.y) || 0) + Math.max(Number(p.height) || 226, 226)), 0);
    const fallbackStartY = state.layout.length ? savedBottom + gap : gap;
    let nextIndex = 0;
    const layout = state.members.map(m => {
      const p = saved.get(m.id);
      if (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) return { memberId: m.id, x: Number(p.x), y: Number(p.y), width: Number(p.width) || cw, height: Number(p.height) || 226, zIndex: Number(p.zIndex ?? p.z_index) || 1 };
      const i = nextIndex++;
      return { memberId: m.id, x: gap + (i%cols)*(cw+gap), y: fallbackStartY + Math.floor(i/cols)*(226+gap), width: cw, height: 226, zIndex: 1 };
    });
    return layout;
  }
  function renderLayout() {
    if (!$('layoutBoard')) return;
    const board = $('layoutBoard'); const layer = $('layoutCards'); board.querySelector('#layoutLines')?.replaceChildren(); layer.replaceChildren();
    if (!state.members.length) { $('layoutEmpty').hidden = false; $('layoutCount').textContent = '0 карточек'; return; }
    $('layoutEmpty').hidden = true;
    let layout = effectiveLayout();
    const maxX = Math.max($('layoutBoardViewport').clientWidth, ...layout.map(p => p.x + p.width + 80));
    const maxY = Math.max($('layoutBoardViewport').clientHeight, ...layout.map(p => p.y + Math.max(p.height, 226) + 80));
    board.style.width = `${maxX}px`; board.style.height = `${maxY}px`; layer.style.width = `${maxX}px`; layer.style.height = `${maxY}px`;
    const memberMap = new Map(state.members.map(m => [m.id,m]));
    layout.forEach(p => {
      const member = memberMap.get(p.memberId); if (!member) return;
      const card = document.createElement('div'); card.className = 'layout-card'; card.dataset.id = p.memberId; card.style.left = `${p.x}px`; card.style.top = `${p.y}px`; card.style.width = `${p.width}px`; card.style.zIndex = String(p.zIndex);
      card.innerHTML = `<span class="layout-avatar">${escapeHtml(initials(member.display_name))}</span><b>${escapeHtml(member.display_name || 'Участник')}</b><small>${escapeHtml(member.primary_role_name || member.member_kind || 'Семья')}</small>`;
      card.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        state.dragging = { id: p.memberId, card, startX: e.clientX, startY: e.clientY, originX: p.x, originY: p.y, moved: false };
        card.classList.add('dragging'); card.setPointerCapture?.(e.pointerId); e.preventDefault();
      });
      card.addEventListener('pointermove', e => {
        const d = state.dragging; if (!d || d.card !== card) return;
        const dx = e.clientX - d.startX, dy = e.clientY - d.startY; if (Math.abs(dx)+Math.abs(dy)>2) d.moved = true;
        const step = Number(state.settings.snapGrid) || 0;
        let x = Math.max(0, d.originX + dx), y = Math.max(0, d.originY + dy);
        if (step > 0) { x = Math.round(x/step)*step; y = Math.round(y/step)*step; }
        card.style.left = `${x}px`; card.style.top = `${y}px`;
      });
      const end = () => {
        if (!state.dragging || state.dragging.card !== card) return;
        const d = state.dragging; const index = layout.findIndex(item => item.memberId === d.id);
        if (index >= 0) { layout[index].x = Math.max(0, parseFloat(card.style.left)||0); layout[index].y = Math.max(0, parseFloat(card.style.top)||0); }
        state.layout = layout; state.dragging = null; card.classList.remove('dragging'); if (d.moved) { $('layoutSaveState').textContent = 'Есть несохранённые координаты'; $('layoutSaveState').style.color = '#b18b51'; markDirty(); }
      };
      card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end); layer.append(card);
    });
    $('layoutCount').textContent = `${layout.length} карточек`; $('layoutSaveState').textContent = 'Изменения не сохранены';
  }
  function initials(name) { return String(name||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase() || '?'; }
  $('autoLayoutButton').addEventListener('click', () => {
    const vp = $('layoutBoardViewport'); const cw = Number(state.settings.cardWidth)||210; const gap = Math.max(28,Number(state.settings.boardPadding)||38); const cols = Math.max(1,Math.floor((vp.clientWidth-gap)/(cw+gap)));
    state.layout = state.members.map((m,i) => ({ memberId:m.id, x:gap+(i%cols)*(cw+gap), y:gap+Math.floor(i/cols)*(226+gap), width:cw, height:226, zIndex:1 }));
    renderLayout(); markDirty(); $('layoutSaveState').textContent = 'Авторасстановка не сохранена'; toast('Выполнена предварительная авторасстановка. Нажмите «Сохранить раскладку».');
  });
  $('saveLayoutButton').addEventListener('click', async () => {
    const layout = effectiveLayout();
    // Merge current visual coordinates for cards that were dragged.
    document.querySelectorAll('.layout-card[data-id]').forEach(card => { const item = layout.find(p=>p.memberId===card.dataset.id); if(item){item.x=Math.max(0,parseFloat(card.style.left)||0);item.y=Math.max(0,parseFloat(card.style.top)||0);} });
    markSaving();
    try { const result = await put('/api/admin/layout', { layout }); state.layout = layout; $('layoutSaveState').textContent = `Сохранено: ${result.saved} карточек`; $('layoutSaveState').style.color = '#668964'; markSaved(); toast('Общая раскладка сохранена.'); renderLayout(); $('layoutSaveState').textContent = `Сохранено: ${result.saved} карточек`; $('layoutSaveState').style.color = '#668964'; }
    catch (e) { markDirty(); toast(e.message, true); }
  });

  $('testDbButton').addEventListener('click', async () => {
    $('testDbButton').disabled = true; $('testDbButton').textContent = 'Проверка…';
    try { const r = await post('/api/admin/test-supabase', {}); toast(`Supabase отвечает · ${r.count} профилей · ${r.durationMs} мс`); await loadDashboard(false); }
    catch (e) { toast(e.message, true); }
    finally { $('testDbButton').disabled = false; $('testDbButton').textContent = 'Проверить Supabase'; }
  });
  $('refreshDiscordButton').addEventListener('click', async () => {
    try { await refreshAll(); showView('discord'); } catch { /* toast already shown */ }
  });

  function downloadJson(data, name) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('exportBackupButton').addEventListener('click', async () => {
    $('exportBackupButton').disabled = true; $('exportBackupButton').textContent = 'Создаём экспорт…';
    try { const result = await post('/api/admin/backup', {}); downloadJson(result, `arch-family-backup-${new Date().toISOString().slice(0,10)}.json`); toast('Резервная копия скачана. Сохраните её в приватном месте.'); }
    catch (e) { toast(e.message, true); }
    finally { $('exportBackupButton').disabled = false; $('exportBackupButton').textContent = 'Скачать полный экспорт'; }
  });
  $('restoreFile').addEventListener('change', () => {
    const file = $('restoreFile').files?.[0] || null; state.file = file; $('restoreFilename').textContent = file ? `${file.name} · ${(file.size/1024).toFixed(1)} KB` : 'Файл не выбран.'; $('restoreBackupButton').disabled = !file;
  });
  $('restoreBackupButton').addEventListener('click', async () => {
    if (!state.file) return;
    const yes = await confirmAction('Восстановить настройки?', 'Будут изменены настройки сайта и координаты карточек. Состав участников и сопоставление ролей не перезаписываются.'); if (!yes) return;
    try {
      const content = await state.file.text(); const parsed = JSON.parse(content);
      const result = await post('/api/admin/restore-settings', parsed);
      toast(`Настройки восстановлены. Раскладка: ${result.restoredLayout} карточек.`);
      $('restoreFile').value = ''; state.file = null; $('restoreFilename').textContent = 'Файл не выбран.'; $('restoreBackupButton').disabled = true;
      await loadDashboard(false);
    } catch (e) { toast(e.message || 'Файл не удалось прочитать.', true); }
  });

  function confirmAction(title, text) {
    return new Promise(resolve => {
      const dlg = $('confirmDialog'); $('confirmTitle').textContent = title; $('confirmText').textContent = text;
      const form = dlg.querySelector('form');
      const done = event => { resolve(event?.submitter?.value === 'confirm'); form.removeEventListener('submit', done); };
      form.addEventListener('submit', done, { once: true }); dlg.showModal();
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'confirm'), { once: true });
    });
  }

  document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.go)));
  document.querySelectorAll('.setting[data-setting]').forEach(el => {
    const changed = () => {
      if (el.type === 'radio' && el.name === 'theme' && el.checked && THEME_PALETTES[el.value]) {
        const palette = THEME_PALETTES[el.value];
        for (const [key, value] of Object.entries(palette)) { const input = document.getElementById(key); if (input) input.value = value; }
      } else if (el.type === 'color') {
        const custom = document.querySelector('input[name="theme"][value="custom"]'); if (custom) custom.checked = true;
      }
      updateRangeLabels(); updatePreview(); markDirty();
    };
    el.addEventListener('input', changed);
    el.addEventListener('change', changed);
  });
  $('saveAllButton').addEventListener('click', saveSettings);
  $('refreshButton').addEventListener('click', refreshAll);
  $('logoutButton').addEventListener('click', async () => {
    try { await post('/api/admin/logout', {}); } catch { /* session may already have expired */ }
    setLoginVisible(true); $('adminPassword').value = ''; $('adminEmail').value = ''; toast('Вы вышли из панели.');
  });
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('loginError').hidden = true;
    try {
      await post('/api/admin/login', { email: $('adminEmail').value.trim(), password: $('adminPassword').value });
      $('adminPassword').value = ''; setLoginVisible(false); await loadDashboard(false); toast('Вход выполнен.');
    } catch (error) { $('loginError').textContent = error.message; $('loginError').hidden = false; }
  });
  $('adminEmail').addEventListener('keydown', e => { if (e.key === 'Enter') $('adminPassword').focus(); });
  $('adminPassword').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginForm').requestSubmit(); });
  window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

  async function start() {
    try {
      const session = await api('/api/admin/session');
      if (!session.authenticated) { setLoginVisible(true); return; }
      setLoginVisible(false); await loadDashboard(false);
    } catch (error) { setLoginVisible(true); if (error.message && error.message !== 'Failed to fetch') $('loginError').textContent = error.message; }
  }
  start();
})();
