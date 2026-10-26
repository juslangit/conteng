(async () => {
  const $ = (id) => document.getElementById(id);
  const s = await window.conteng.getSettings();
  $('name').value = s.name;
  if (s.room) {
    $('current').hidden = false;
    $('currentCode').textContent = s.room;
    $('create').textContent = 'Start a different board';
  }

  $('copy').onclick = async () => {
    await window.conteng.copy(s.room);
    $('copy').textContent = 'Copied';
    setTimeout(() => { $('copy').textContent = 'Copy'; }, 1500);
  };

  // A new board shows its code here first, so it can be copied before the window closes.
  $('create').onclick = async () => {
    const room = await window.conteng.newRoom();
    const r = await window.conteng.setRoom(room, $('name').value, true);
    if (!r.ok) return;
    s.room = room;
    await window.conteng.copy(room);
    $('current').hidden = false;
    $('currentCode').textContent = room;
    $('copy').textContent = 'Copied';
    $('create').textContent = 'Start a different board';
  };

  $('join').onsubmit = async (e) => {
    e.preventDefault();
    const code = $('code').value.trim();
    if (!code) { $('error').textContent = 'Paste the code your friend sent you.'; $('code').focus(); return; }
    const r = await window.conteng.setRoom(code, $('name').value);
    if (!r.ok) { $('error').textContent = r.error; $('code').focus(); }
  };
})();
