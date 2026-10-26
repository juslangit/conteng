// Conteng board: draws strokes on a canvas and keeps them in step with the other side.
// Points are stored as fractions of the board (0..1), so boards of any size match.
// Live strokes go over a Supabase Realtime broadcast channel; finished strokes are
// saved through the conteng_* database functions so the board survives restarts.
(() => {
  const COLORS = ['#1d1d1f', '#e5484d', '#f76b15', '#30a46c', '#0090ff', '#8e4ec6'];
  const SIZES = [0.008, 0.016, 0.034];          // pen width as a fraction of the board width
  const ERASER_SCALE = 2.5;
  const FLUSH_MS = 70;          // ~14 messages a second while drawing, under the client limit set below

  const $ = (id) => document.getElementById(id);
  const canvas = $('ink');
  const ctx = canvas.getContext('2d');
  const boardEl = $('board');

  const pref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  const state = {
    room: null, author: null, name: '',
    color: pref('color', COLORS[0]), size: pref('size', 1), erasing: false,
    strokes: new Map(),     // id -> stroke, in drawing order (Map keeps insertion order)
    mine: [],               // ids of my strokes still on the board, for undo
    unsaved: new Map(),     // my finished strokes waiting to be saved
    current: null,          // the stroke I am drawing right now
    outbox: [],             // points not yet broadcast
    friends: 0, connected: false,
  };

  let supa = null, channel = null;

  // ---------- drawing ----------
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    redraw();
  }

  function styleFor(s) {
    const w = canvas.width;
    ctx.globalCompositeOperation = s.tool === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = s.color || '#000';
    ctx.fillStyle = s.color || '#000';
    ctx.lineWidth = Math.max(1, s.size * w * (s.tool === 'erase' ? ERASER_SCALE : 1));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  // Draw points [from..end] of a stroke; called with from=0 for a full stroke.
  function paint(s, from = 0) {
    const p = s.points, w = canvas.width, h = canvas.height;
    if (!p.length) return;
    styleFor(s);
    if (p.length === 1) {
      ctx.beginPath();
      ctx.arc(p[0][0] * w, p[0][1] * h, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const start = Math.max(1, from);
    ctx.beginPath();
    ctx.moveTo(p[start - 1][0] * w, p[start - 1][1] * h);
    for (let i = start; i < p.length; i++) ctx.lineTo(p[i][0] * w, p[i][1] * h);
    ctx.stroke();
  }

  function redraw() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of state.strokes.values()) paint(s);
  }

  // ---------- my pen ----------
  const round = (n) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;
  function toPoint(e) {
    const r = canvas.getBoundingClientRect();
    return [round((e.clientX - r.left) / r.width), round((e.clientY - r.top) / r.height)];
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !state.room) return;
    canvas.setPointerCapture(e.pointerId);
    const s = {
      id: crypto.randomUUID(), author: state.author,
      tool: state.erasing ? 'erase' : 'pen', color: state.color, size: SIZES[state.size],
      points: [toPoint(e)],
    };
    state.current = s;
    state.strokes.set(s.id, s);
    paint(s);
    boardEl.classList.add('drawing');
    send('begin', { id: s.id, author: s.author, tool: s.tool, color: s.color, size: s.size, points: s.points.slice() });
  });

  canvas.addEventListener('pointermove', (e) => {
    const s = state.current;
    if (!s) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const from = s.points.length;
    for (const ev of events) {
      const pt = toPoint(ev);
      const last = s.points[s.points.length - 1];
      if (Math.abs(pt[0] - last[0]) + Math.abs(pt[1] - last[1]) < 0.0015) continue;
      if (s.points.length >= 3900) break;
      s.points.push(pt);
      state.outbox.push(pt);
    }
    if (s.points.length > from) paint(s, from);
  });

  function finish() {
    const s = state.current;
    if (!s) return;
    state.current = null;
    boardEl.classList.remove('drawing');
    flush();
    send('end', { stroke: { ...s, points: s.points.slice() } });
    state.mine.push(s.id);
    state.unsaved.set(s.id, s);
    save();
    updateButtons();
  }
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('lostpointercapture', finish);

  function flush() {
    if (!state.current && !state.outbox.length) return;
    if (state.outbox.length) {
      const id = state.current ? state.current.id : null;
      if (id) send('pts', { id, points: state.outbox });
      state.outbox = [];
    }
  }
  setInterval(() => { if (state.current) flush(); }, FLUSH_MS);

  // ---------- saving ----------
  let saving = false;
  async function save() {
    if (saving || !supa) return;
    saving = true;
    try {
      for (const [id, s] of state.unsaved) {
        const { error } = await supa.rpc('conteng_add', {
          p_room: state.room, p_id: id, p_author: s.author,
          p_stroke: { tool: s.tool, color: s.color, size: s.size, points: s.points },
        });
        if (error) throw error;
        state.unsaved.delete(id);
      }
    } catch (err) {
      console.warn('save failed, will retry', err.message || err);
      setTimeout(save, 3000);
    } finally {
      saving = false;
    }
  }

  async function load() {
    const { data, error } = await supa.rpc('conteng_load', { p_room: state.room });
    if (error) { console.warn('load failed', error.message); return; }
    const next = new Map();
    for (const row of data) next.set(row.id, { id: row.id, author: row.author, ...row.stroke });
    // Keep anything that is still on its way: my unsaved strokes and strokes being drawn.
    for (const [id, s] of state.strokes) if (!next.has(id) && (state.unsaved.has(id) || (s.live && Date.now() - s.live < 4000) || s === state.current)) next.set(id, s);
    state.strokes = next;
    state.mine = [...next.values()].filter((s) => s.author === state.author).map((s) => s.id);
    redraw();
    updateButtons();
  }

  // ---------- undo / clear ----------
  function undo() {
    const id = state.mine.pop();
    if (!id) return;
    state.strokes.delete(id);
    const wasUnsaved = state.unsaved.delete(id);
    redraw();
    send('undo', { id });
    if (!wasUnsaved) supa.rpc('conteng_remove', { p_room: state.room, p_id: id }).then(({ error }) => error && console.warn(error.message));
    updateButtons();
  }

  async function clearBoard() {
    state.strokes.clear();
    state.mine = [];
    state.unsaved.clear();
    redraw();
    send('clear', {});
    const { error } = await supa.rpc('conteng_clear', { p_room: state.room });
    if (error) console.warn('clear failed', error.message);
    updateButtons();
  }

  // ---------- live sync ----------
  function send(event, payload) {
    if (channel && state.connected) channel.send({ type: 'broadcast', event, payload });
  }

  function connect() {
    if (channel) { supa.removeChannel(channel); channel = null; }
    state.connected = false;
    setStatus();
    if (!state.room) return;
    const cfg = window.CONTENG_CONFIG;
    supa = supa || window.supabase.createClient(cfg.url, cfg.key, {
      auth: { persistSession: false },
      // The default (10/s) silently drops messages while someone draws quickly.
      realtime: { params: { eventsPerSecond: 40 } },
    });
    channel = supa.channel(`conteng:${state.room}`, {
      config: { broadcast: { self: false }, presence: { key: state.author } },
    });
    channel
      .on('broadcast', { event: 'begin' }, ({ payload: p }) => {
        const s = { ...p, live: Date.now() };
        state.strokes.set(s.id, s);
        paint(s);
      })
      .on('broadcast', { event: 'pts' }, ({ payload: p }) => {
        const s = state.strokes.get(p.id);
        if (!s) return;
        const from = s.points.length;
        s.points.push(...p.points);
        s.live = Date.now();
        paint(s, from);
      })
      .on('broadcast', { event: 'end' }, ({ payload: { stroke } }) => {
        const s = state.strokes.get(stroke.id);
        // The final copy is the truth; if any live packet went missing, repaint from it.
        if (!s || s.points.length !== stroke.points.length) {
          state.strokes.set(stroke.id, stroke);
          redraw();
        } else {
          delete s.live;
        }
      })
      .on('broadcast', { event: 'undo' }, ({ payload: { id } }) => {
        if (state.strokes.delete(id)) redraw();
      })
      .on('broadcast', { event: 'clear' }, () => {
        state.strokes.clear();
        state.mine = [];
        state.unsaved.clear();
        redraw();
        updateButtons();
      })
      .on('presence', { event: 'sync' }, () => {
        state.friends = Object.keys(channel.presenceState()).filter((k) => k !== state.author).length;
        setStatus();
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          state.connected = true;
          setStatus();
          channel.track({ name: state.name || 'friend', at: Date.now() });
          await load();
          save();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          state.connected = false;
          setStatus();
        }
      });
  }

  // If a friend's stroke stops without its 'end' (a lost message, a dropped connection),
  // the database has the finished copy: reload from it.
  setInterval(() => {
    if (!state.connected || state.current) return;
    for (const s of state.strokes.values()) {
      if (s.live && Date.now() - s.live > 4000) { load(); return; }
    }
  }, 2000);

  // ---------- toolbar ----------
  function setStatus() {
    const el = $('status');
    el.classList.toggle('online', state.connected && !state.friends);
    el.classList.toggle('together', state.connected && state.friends > 0);
    $('statusText').textContent = !state.room ? 'No board'
      : !state.connected ? 'Offline'
      : state.friends ? (state.friends === 1 ? 'Friend is here' : `${state.friends} friends here`)
      : 'Waiting for friend';
  }

  function updateButtons() {
    $('undo').disabled = !state.mine.length;
    $('clear').disabled = !state.strokes.size;
    $('eraser').setAttribute('aria-pressed', String(state.erasing));
    boardEl.classList.toggle('erasing', state.erasing);
    document.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(!state.erasing && b.dataset.color === state.color)));
    const d = [4, 7, 11][state.size];
    $('sizeDot').style.width = $('sizeDot').style.height = `${d}px`;
    $('size').title = `Pen size: ${['thin', 'medium', 'thick'][state.size]}`;
    $('size').setAttribute('aria-label', $('size').title);
  }

  function buildToolbar() {
    const names = ['Black', 'Red', 'Orange', 'Green', 'Blue', 'Purple'];
    COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'swatch'; b.dataset.color = c;
      b.style.color = c; b.setAttribute('aria-label', names[i]); b.title = names[i];
      const dot = document.createElement('span');
      dot.style.background = c;
      b.append(dot);
      b.onclick = () => { state.color = c; state.erasing = false; setPref('color', c); updateButtons(); };
      $('colors').append(b);
    });
    // One button cycles thin → medium → thick, showing the current size.
    $('size').onclick = () => { state.size = (state.size + 1) % SIZES.length; setPref('size', state.size); updateButtons(); };
    $('eraser').onclick = () => { state.erasing = !state.erasing; updateButtons(); };
    $('undo').onclick = undo;
    $('clear').onclick = () => { $('confirm').hidden = false; $('confirmYes').focus(); };
    $('confirmNo').onclick = () => { $('confirm').hidden = true; };
    $('confirmYes').onclick = () => { $('confirm').hidden = true; clearBoard(); };
    $('settings').onclick = () => window.conteng.openSetup();
    $('emptySetup').onclick = () => window.conteng.openSetup();
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      if (e.key === 'e' && !e.metaKey && !e.ctrlKey) { state.erasing = !state.erasing; updateButtons(); }
      if (e.key === 'Escape') $('confirm').hidden = true;
    });
  }

  async function start() {
    const s = await window.conteng.getSettings();
    state.room = s.room; state.author = s.author; state.name = s.name;
    $('empty').hidden = !!state.room;
    state.strokes.clear(); state.mine = []; state.unsaved.clear();
    redraw();
    updateButtons();
    connect();
  }

  // Drag strip along the top moves the window.
  const grab = document.querySelector('.grab');
  let drag = null;
  grab.addEventListener('pointerdown', async (e) => {
    if (e.button !== 0) return;
    grab.setPointerCapture(e.pointerId);
    grab.classList.add('dragging');
    const start = { sx: e.screenX, sy: e.screenY };
    drag = start;
    const [wx, wy] = await window.conteng.boardPos();
    if (drag === start) Object.assign(drag, { wx, wy });
  });
  grab.addEventListener('pointermove', (e) => {
    if (!drag || drag.wx === undefined) return;
    window.conteng.moveBoard(drag.wx + e.screenX - drag.sx, drag.wy + e.screenY - drag.sy);
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    grab.classList.remove('dragging');
    window.conteng.boardMoved();
  };
  grab.addEventListener('pointerup', endDrag);
  grab.addEventListener('lostpointercapture', endDrag);

  // Corner grip resizes, keeping the board square.
  const grip = $('resize');
  let sizing = null;
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    grip.setPointerCapture(e.pointerId);
    sizing = { sx: e.screenX, sy: e.screenY, size: window.innerWidth };
  });
  grip.addEventListener('pointermove', (e) => {
    if (!sizing) return;
    const d = Math.max(e.screenX - sizing.sx, e.screenY - sizing.sy);
    window.conteng.resizeBoard(sizing.size + d);
  });
  const endSize = () => { if (sizing) { sizing = null; window.conteng.boardMoved(); } };
  grip.addEventListener('pointerup', endSize);
  grip.addEventListener('lostpointercapture', endSize);

  buildToolbar();
  new ResizeObserver(resize).observe(canvas);
  window.conteng.onRoomChanged(start);
  window.addEventListener('online', () => state.room && connect());
  // Expose a little for the automated test; harmless in the app.
  window.__conteng = { state, load };
  start();
})();
