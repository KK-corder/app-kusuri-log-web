const STORE_KEY = 'kusuri-log-web-v1';
const emptyStore = () => ({version:4, medications:[], doseLogs:[], appointments:[], journal:[], settings:{showNotificationDetails:false}});
let store = loadStore(), tab = 'today', editing = null;
let selectedDay = dayKey(new Date()), followToday = true, chartDays = 30;
const $ = s => document.querySelector(s), app = $('#app'), dialog = $('#editor'), form = $('#editor-form');
const uuid = () => crypto.randomUUID();
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'}[c]));
const dateText = v => new Intl.DateTimeFormat('ja-JP', {dateStyle:'medium', timeStyle:'short'}).format(new Date(v));
const timeText = v => new Intl.DateTimeFormat('ja-JP', {hour:'2-digit', minute:'2-digit', hour12:false}).format(new Date(v));

function dayKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
}
function dayDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m-1, d);
}
function shiftedDay(key, days) {
  const d = dayDate(key);
  d.setDate(d.getDate()+days);
  return dayKey(d);
}
function localDateTime(value) {
  if (!value) return '';
  const d = new Date(value), pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function normalizeStore(value) {
  const now = new Date().toISOString();
  value = {...emptyStore(), ...value, version:4, settings:{...emptyStore().settings, ...value.settings}};
  value.doseLogs = (value.doseLogs || []).map(log => {
    // Legacy scheduled IDs end in a local date/time; medication UUIDs also contain hyphens.
    const match = !log.asNeeded && String(log.id).match(/-(\d{4})-(\d{1,2})-(\d{1,2})-(\d{2}:\d{2})$/);
    return {...log,
      scheduledDay:log.scheduledDay || (match ? `${+match[1]}-${+match[2]}-${+match[3]}` : dayKey(log.completedAt)),
      scheduledTime:log.scheduledTime ?? (match ? match[4] : '')
    };
  });
  value.medications = (value.medications || []).map(m => {
    const oldest = value.doseLogs.filter(l => l.medicationID === m.id && l.completedAt)
      .sort((a, b) => new Date(a.completedAt)-new Date(b.completedAt))[0];
    return {...m, kind:m.kind || 'scheduled', times:Array.isArray(m.times) ? m.times : [],
      createdAt:m.createdAt || oldest?.completedAt || now, archived:m.archived ?? false};
  });
  value.appointments = (value.appointments || []).map(a => ({...a, visitCost:Number(a.visitCost)||0,
    prescriptionCost:Number(a.prescriptionCost)||0, medicationIDs:Array.isArray(a.medicationIDs) ? a.medicationIDs : []}));
  return value;
}
function loadStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    const normalized = normalizeStore(saved || emptyStore());
    if (saved) localStorage.setItem(STORE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch { return emptyStore(); }
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
function empty(title, text = '') { return `<div class="empty"><b>${esc(title)}</b>${esc(text)}</div>`; }
function section(title, html) {
  return html ? `<section class="section"><h2>${esc(title)}</h2><div class="group">${html}</div></section>` : '';
}
function button(label, action, id = '', style = 'secondary', extra = '') {
  return `<button type="button" class="${style}" data-action="${action}" data-id="${esc(id)}" ${extra}>${esc(label)}</button>`;
}
function editable(type, id) {
  return `data-action="edit-${type}" data-id="${esc(id)}" tabindex="0" role="button"`;
}
function render() {
  if (followToday) selectedDay = dayKey(new Date());
  document.querySelectorAll('nav button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const titles = {today:'今日', medications:'薬', appointments:'通院', journal:'経過', settings:'設定'};
  $('#page-title').textContent = titles[tab];
  $('#add-button').hidden = tab === 'today' || tab === 'settings';
  $('#today-label').textContent = new Intl.DateTimeFormat('ja-JP', {month:'long', day:'numeric', weekday:'short'}).format(new Date());
  ({today:renderToday, medications:renderMedications, appointments:renderAppointments, journal:renderJournal, settings:renderSettings})[tab]();
}
function isScheduled(m, day) {
  return m.kind === 'scheduled' && m.active !== false && !m.archived && dayDate(day) >= dayDate(dayKey(m.createdAt));
}
function schedules(day) {
  const logs = store.doseLogs.filter(l => !l.asNeeded && l.scheduledDay === day);
  const rows = logs.map(log => ({log, time:log.scheduledTime, m:store.medications.find(m => m.id === log.medicationID)}));
  store.medications.filter(m => isScheduled(m, day)).forEach(m => {
    [...new Set(m.times)].forEach(time => {
      if (!logs.some(l => l.medicationID === m.id && l.scheduledTime === time)) rows.push({m, time});
    });
  });
  return rows.sort((a, b) => a.time.localeCompare(b.time));
}
function doseDescription(value) {
  return value.dose != null && value.unit != null ? `1回 ${esc(value.dose)}${esc(value.unit)}` : '';
}
function takenText(log) {
  if (log.status === 'skipped') return '見送り';
  const date = new Date(log.completedAt);
  return log.scheduledDay === dayKey(date) ? `服用済み ${timeText(date)}` : `服用済み（${date.getMonth()+1}/${date.getDate()} ${timeText(date)} に記録）`;
}
function scheduledRow({m, time, log}, now) {
  const recorded = log && log.status !== 'pending';
  const planned = dayDate(selectedDay);
  const [hour, minute] = time.split(':').map(Number);
  planned.setHours(hour, minute, 0, 0);
  const overdue = planned < now;
  const snapshot = log || m;
  return `<article class="list-row"><div class="row"><div class="time">${esc(time)}</div><div class="grow"><h3>${esc(snapshot.name)}</h3><div class="meta">${doseDescription(snapshot)}</div><div class="status ${!recorded && overdue ? 'warning' : ''}">${recorded ? esc(takenText(log)) : '未記録'}</div></div></div><div class="actions">${recorded ? button('取り消す', 'undo-dose', log.id) : button('服用した', 'take', m?.id, 'primary', `data-time="${esc(time)}"`) + button('見送る', 'skip', m?.id, 'secondary', `data-time="${esc(time)}"`)}</div></article>`;
}
function asNeededRows(isToday) {
  const logs = store.doseLogs.filter(l => l.asNeeded && l.scheduledDay === selectedDay);
  const meds = isToday ? store.medications.filter(m => m.kind === 'asNeeded' && !m.archived) : [];
  const ids = [...new Set([...meds.map(m => m.id), ...logs.map(l => l.medicationID)])];
  return ids.map(id => {
    const m = meds.find(m => m.id === id), records = logs.filter(l => l.medicationID === id)
      .sort((a, b) => new Date(b.completedAt)-new Date(a.completedAt));
    return `<article class="list-row">${m ? `<div class="row"><div class="grow"><h3>${esc(m.name)}</h3><div class="meta">${doseDescription(m)}・残り ${esc(m.stock)}${esc(m.unit)}</div></div>${button('服用した', 'as-needed', id, 'primary')}</div>` : ''}${records.map(l => `<div class="record-row"><div class="grow"><h3>${esc(l.name)}</h3><div class="meta">${doseDescription(l)}</div><span>${timeText(l.completedAt)}</span></div>${button('取り消す', 'undo-dose', l.id)}</div>`).join('')}</article>`;
  }).join('');
}
function lowStockRows() {
  return store.medications.filter(m => !m.archived).map(m => {
    const scheduled = m.kind === 'scheduled';
    if (scheduled && !isScheduled(m, selectedDay)) return '';
    const amount = Number(m.dose) * (scheduled ? new Set(m.times).size : 1);
    if (!(amount > 0)) return '';
    const remaining = Math.floor(Number(m.stock)/amount);
    if (remaining > (scheduled ? 7 : 5)) return '';
    return `<div class="list-row"><h3>${esc(m.name)}</h3><div class="meta">残り ${esc(m.stock)}${esc(m.unit)} <span class="warning">あと ${remaining}${scheduled ? '日分' : '回分'}</span></div></div>`;
  }).join('');
}
function nextAppointmentRows(now) {
  const upcoming = store.appointments.flatMap(a => [a.date, a.nextDate].filter(d => d && new Date(d) > now).map(date => ({...a, date})))
    .sort((a, b) => new Date(a.date)-new Date(b.date))[0];
  const latest = store.appointments.filter(a => new Date(a.date) <= now).sort((a, b) => new Date(b.date)-new Date(a.date))[0];
  return (upcoming ? `<div class="list-row"><h3>${esc(upcoming.hospital)}</h3><div class="meta">${dateText(upcoming.date)}</div></div>` : '') +
    (latest?.actions?.trim() ? `<div class="list-row"><h3>次回までにやること</h3><p>${esc(latest.actions)}</p></div>` : '');
}
function renderToday() {
  const now = new Date(), isToday = selectedDay === dayKey(now), rows = schedules(selectedDay);
  const dateLabel = new Intl.DateTimeFormat('ja-JP', {year:'numeric', month:'long', day:'numeric', weekday:'short'}).format(dayDate(selectedDay));
  const conditions = store.journal.filter(j => dayKey(j.date) === selectedDay).sort((a, b) => new Date(b.date)-new Date(a.date));
  const labels = ['とても悪い', '悪い', 'ふつう', '良い', 'とても良い'];
  app.innerHTML = `<section class="date-navigation group" aria-label="表示する日付"><div class="date-controls">${button('前の日', 'previous-day')}<strong>${esc(dateLabel)}</strong>${button('次の日', 'next-day', '', 'secondary', isToday ? 'disabled' : '')}</div>${!isToday ? button('今日に戻る', 'return-today') : ''}</section>` +
    (isToday ? section('体調', `<div class="condition-buttons">${labels.map((label, i) => `<button type="button" data-action="condition" data-id="${i+1}" aria-label="体調 ${i+1} ${label}"><strong>${i+1}</strong><span>${label}</span></button>`).join('')}</div>${conditions.map(j => `<div class="list-row"><h3>${timeText(j.date)} 体調 ${esc(j.condition)}</h3>${j.note ? `<p>${esc(j.note)}</p>` : ''}<div class="actions">${button('メモを追加', 'edit-journal', j.id)}${button('取り消す', 'undo-condition', j.id)}</div></div>`).join('')}`) : '') +
    section('服薬', rows.map(row => scheduledRow(row, now)).join('')) + section('頓服薬', asNeededRows(isToday)) +
    (isToday ? section('残量が少ない薬', lowStockRows()) + section('次回の通院', nextAppointmentRows(now)) : '');
}
function recordDose(m, status, time = '', asNeeded = false) {
  if (!m || m.archived) return;
  if (asNeeded ? selectedDay !== dayKey(new Date()) : !isScheduled(m, selectedDay)) return;
  if (!asNeeded && store.doseLogs.some(l => !l.asNeeded && l.medicationID === m.id && l.scheduledDay === selectedDay && l.scheduledTime === time && l.status !== 'pending')) return;
  const before = Number(m.stock), after = status === 'taken' ? Math.max(0, Number((before-Number(m.dose)).toFixed(10))) : before;
  const log = {id:uuid(), medicationID:m.id, name:m.name, dose:m.dose, unit:m.unit, status,
    completedAt:new Date().toISOString(), scheduledDay:selectedDay, scheduledTime:time, asNeeded, stockReduction:before-after};
  if (!asNeeded) store.doseLogs = store.doseLogs.filter(l => !(l.medicationID === m.id && l.scheduledDay === selectedDay && l.scheduledTime === time && l.status === 'pending'));
  store.doseLogs.push(log);
  m.stock = after;
  save(); render();
}
function undoDose(id) {
  const log = store.doseLogs.find(l => l.id === id);
  if (!log) return;
  const m = store.medications.find(m => m.id === log.medicationID);
  if (m && log.status === 'taken') m.stock = Number((Number(m.stock)+Number(log.stockReduction ?? m.dose)).toFixed(10));
  store.doseLogs = store.doseLogs.filter(l => l.id !== id);
  save(); render();
}
function prescriptionHistory(medicationID) {
  return store.appointments.filter(a => a.medicationIDs.includes(medicationID)).sort((a, b) => new Date(b.date)-new Date(a.date));
}
function medicationCards(values) {
  return values.map(m => {
    const history = prescriptionHistory(m.id);
    return `<article class="list-row editable" ${editable('medication', m.id)}><div class="row"><div class="grow"><h3>${esc(m.name)}</h3><div class="meta">${doseDescription(m)}　残り ${esc(m.stock)}${esc(m.unit)}<br>${m.kind === 'asNeeded' ? '頓服薬' : m.times.map(esc).join('、')}${history.length ? `<br>処方記録：${history.slice(0,3).map(a => `${new Date(a.date).toLocaleDateString('ja-JP')} ${esc(a.hospital)}`).join('<br>')}` : ''}</div></div><span class="edit-label">編集</span></div></article>`;
  }).join('');
}
function renderMedications() {
  app.innerHTML = store.medications.length ? section('定時薬', medicationCards(store.medications.filter(m => m.kind === 'scheduled' && !m.archived))) +
    section('頓服薬', medicationCards(store.medications.filter(m => m.kind === 'asNeeded' && !m.archived))) +
    section('服用をやめた薬', medicationCards(store.medications.filter(m => m.archived))) : empty('薬が未登録です', '右上の＋から登録してください');
}
function yen(value) { return new Intl.NumberFormat('ja-JP', {style:'currency', currency:'JPY', maximumFractionDigits:0}).format(Number(value)||0); }
function medicationNames(ids = []) { return ids.map(id => store.medications.find(m => m.id === id)?.name).filter(Boolean); }
function renderAppointments() {
  const values = [...store.appointments].sort((a, b) => new Date(b.date)-new Date(a.date));
  app.innerHTML = values.length ? `<div class="group">${values.map(x => {
    const prescribed = medicationNames(x.medicationIDs);
    return `<article class="list-row"><div class="editable" ${editable('appointment', x.id)}><h3>${esc(x.hospital)}</h3><div class="meta">${dateText(x.date)}<br>診察 ${yen(x.visitCost)}・処方薬 ${yen(x.prescriptionCost)}・合計 ${yen(x.visitCost+x.prescriptionCost)}${prescribed.length ? `<br>処方された薬：${prescribed.map(esc).join('、')}` : ''}</div>${x.notes ? `<p>${esc(x.notes)}</p>` : ''}</div><div class="actions">${button('Googleカレンダー', 'calendar', x.id)}</div></article>`;
  }).join('')}</div>` : empty('通院記録はありません', '右上の＋から記録してください');
}
function addCalendar(id) {
  const x = store.appointments.find(v => v.id === id), start = new Date(x.date), end = new Date(start.getTime()+3600000);
  const fmt = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const q = new URLSearchParams({action:'TEMPLATE', text:`通院：${x.hospital}`, dates:`${fmt(start)}/${fmt(end)}`, details:'くすりログから追加'});
  location.href = `https://calendar.google.com/calendar/render?${q}`;
}
function conditionChart() {
  const today = dayKey(new Date()), points = [], averages = new Map();
  store.journal.forEach(j => {
    const key = dayKey(j.date), score = Number(j.condition);
    if (score >= 1 && score <= 5) {
      const values = averages.get(key) || [];
      values.push(score); averages.set(key, values);
    }
  });
  for (let i = 0; i < chartDays; i++) {
    const key = shiftedDay(today, i-chartDays+1), values = averages.get(key);
    if (values) points.push({i, key, value:values.reduce((a, b) => a+b, 0)/values.length});
  }
  if (!points.length) return '<p class="empty chart-empty">この期間の記録はありません</p>';
  const x = i => 30+i/(chartDays-1)*290, y = v => 164-(v-1)*34;
  const ticks = [1,2,3,4,5].map(v => `<line class="grid-line" x1="30" y1="${y(v)}" x2="320" y2="${y(v)}"/><text x="16" y="${y(v)+4}">${v}</text>`).join('');
  const lines = points.map((p, i) => i && points[i-1].i === p.i-1 ? `<line class="chart-line" x1="${x(points[i-1].i)}" y1="${y(points[i-1].value)}" x2="${x(p.i)}" y2="${y(p.value)}"/>` : '').join('');
  const dots = points.map(p => `<circle class="chart-point" cx="${x(p.i)}" cy="${y(p.value)}" r="4"><title>${esc(p.key)} 体調 ${p.value}</title></circle>`).join('');
  const label = key => { const d = dayDate(key); return `${d.getMonth()+1}/${d.getDate()}`; };
  return `<svg class="condition-chart" viewBox="0 0 344 200" role="img" aria-label="直近${chartDays}日間の体調。記録のある${points.length}日の日別平均"><title>体調の日別平均（1〜5）</title>${ticks}${lines}${dots}<text x="30" y="190" text-anchor="start">${label(shiftedDay(today, 1-chartDays))}</text><text x="320" y="190" text-anchor="end">${label(today)}</text></svg>`;
}
function renderJournal() {
  const values = [...store.journal].sort((a, b) => new Date(b.date)-new Date(a.date));
  app.innerHTML = section('体調の推移', `<div class="segmented" aria-label="表示期間">${[[14,'2週間'],[30,'1か月'],[90,'3か月']].map(([days, label]) => button(label, 'chart-days', days, chartDays === days ? 'selected' : '', `aria-pressed="${chartDays === days}"`)).join('')}</div>${conditionChart()}`) +
    (values.length ? section('記録', values.map(x => `<article class="list-row editable" ${editable('journal', x.id)}><div class="row"><div class="grow"><h3>${dateText(x.date)}</h3><div class="condition">体調 ${esc(x.condition)}/5</div></div><span class="edit-label">編集</span></div>${x.symptoms ? `<p>${esc(x.symptoms)}</p>` : ''}<div class="meta">${esc(x.note)}</div></article>`).join('')) : empty('経過記録はありません', '右上の＋から記録してください'));
}
function renderSettings() {
  app.innerHTML = section('通知', `<label class="list-row setting"><div><h3>通知に薬名を表示</h3><div class="meta">Web版の通知は補助機能です</div></div><input id="notification-details" type="checkbox" ${store.settings.showNotificationDetails ? 'checked' : ''}></label>`) +
    section('バックアップ', `<div class="list-row"><p class="notice">データはこのブラウザの端末内に保存されています。アプリのデータ消去や端末故障に備え、定期的にファイルを書き出してください。JSONには入力内容がそのまま含まれます。</p><div class="actions">${button('書き出す', 'export', '', 'primary')}${button('復元する', 'import')}</div></div>`) +
    section('このアプリについて', '<div class="list-row"><p class="notice">入力された内容の記録と表示だけを行います。薬・症状・通院内容について判断や助言は行いません。Googleカレンダーはボタンを押したときだけ開きます。</p></div>');
}
function field(label, name, value = '', type = 'text', extra = '') {
  return `<label class="field">${label}${type === 'textarea' ? `<textarea name="${name}" ${extra}>${esc(value)}</textarea>` : `<input name="${name}" type="${type}" value="${esc(value)}" ${extra}>`}</label>`;
}
function hospitalField(value = '') {
  const hospitals = [...new Set(store.appointments.map(a => a.hospital).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
  return field('病院・クリニック名', 'hospital', value, 'text', 'list="hospital-templates" autocomplete="off" required') + `<datalist id="hospital-templates">${hospitals.map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist>`;
}
function medicationPicker(selected = []) {
  if (!store.medications.length) return '<p class="notice">先に「薬」タブで薬を登録すると、ここで処方薬を選択できます。</p>';
  return `<div class="field">この日に処方された薬<div class="choice-list">${store.medications.map(m => `<label><input type="checkbox" name="medicationIDs" value="${esc(m.id)}" ${selected.includes(m.id) ? 'checked' : ''}><span>${esc(m.name)}</span></label>`).join('')}</div></div>`;
}
function openEditor(type, value = null) {
  editing = {type, id:value?.id, original:value};
  const titles = {medication:value ? '薬を編集' : '薬を追加', appointment:value ? '通院記録を編集' : '通院を追加', journal:value ? '経過を編集' : '経過を記録'};
  $('#editor-title').textContent = titles[type];
  let html = '';
  if (type === 'medication') {
    const v = value || {name:'', stock:0, dose:1, unit:'錠', kind:'scheduled', times:['09:00'], active:true, archived:false};
    html = `<label class="field">薬の種類<select name="kind"><option value="scheduled" ${v.kind === 'scheduled' ? 'selected' : ''}>定時薬（時間を指定）</option><option value="asNeeded" ${v.kind === 'asNeeded' ? 'selected' : ''}>頓服薬（必要なとき）</option></select></label>` +
      field('薬の名前', 'name', v.name, 'text', 'required') + `<div class="inline">${field('現在の残量', 'stock', v.stock, 'number', 'step="0.1" min="0" required')}${field('1回量', 'dose', v.dose, 'number', 'step="0.1" min="0.1" required')}</div>` +
      `<label class="field">単位<select name="unit">${['錠','包','カプセル','mL'].map(x => `<option ${x === v.unit ? 'selected' : ''}>${x}</option>`).join('')}</select></label>` +
      field('服用時刻（定時薬のみ・カンマ区切り）', 'times', v.times.join(', '), 'text', 'placeholder="09:00, 21:00"') +
      `<label class="field check-field"><input name="active" type="checkbox" ${v.active !== false ? 'checked' : ''}>定時薬の予定に表示する</label><label class="field check-field"><input name="archived" type="checkbox" ${v.archived ? 'checked' : ''}>服用をやめた薬にする</label>`;
  } else if (type === 'appointment') {
    const v = value || {hospital:'', date:new Date().toISOString(), notes:'', actions:'', nextDate:'', visitCost:0, prescriptionCost:0, medicationIDs:[]};
    html = hospitalField(v.hospital) + field('通院日時', 'date', localDateTime(v.date), 'datetime-local', 'required') +
      `<div class="inline">${field('診察・通院料金（円）', 'visitCost', v.visitCost, 'number', 'min="0" step="1"')}${field('処方薬料金（円）', 'prescriptionCost', v.prescriptionCost, 'number', 'min="0" step="1"')}</div>` +
      medicationPicker(v.medicationIDs) + field('診察で話したこと', 'notes', v.notes, 'textarea') + field('次回までにやること', 'actions', v.actions, 'textarea') +
      field('次回の通院日時（任意）', 'nextDate', localDateTime(v.nextDate), 'datetime-local');
  } else {
    const v = value || {date:new Date().toISOString(), condition:3, symptoms:'', note:''};
    html = field('日時', 'date', localDateTime(v.date), 'datetime-local', 'required') + field('体調（1〜5）', 'condition', v.condition, 'number', 'min="1" max="5" required') +
      field('症状', 'symptoms', v.symptoms, 'textarea') + field('メモ', 'note', v.note, 'textarea');
  }
  $('#editor-fields').innerHTML = `<div class="form-group">${html}</div>${value ? '<button type="button" id="delete-record" class="danger delete-button">削除</button>' : ''}`;
  if (value) $('#delete-record').onclick = deleteEditing;
  dialog.showModal();
}
function savedDate(name, input) {
  const original = editing.original?.[name];
  // Keep seconds, milliseconds and the original offset when the minute input is untouched.
  return original && input === localDateTime(original) ? original : input ? new Date(input).toISOString() : '';
}
function deleteEditing() {
  const {type, id} = editing;
  const message = type === 'medication' ? 'この薬を削除しますか？過去の服用記録は薬名つきで残ります。通院記録の「処方された薬」からは、この薬が消えます。' : 'この記録を削除しますか？この操作は取り消せません。';
  if (!confirm(message)) return;
  const key = {medication:'medications', appointment:'appointments', journal:'journal'}[type];
  store[key] = store[key].filter(x => x.id !== id);
  if (type === 'medication') store.appointments.forEach(a => { a.medicationIDs = a.medicationIDs.filter(m => m !== id); });
  save(); dialog.close(); render();
}
function upsert(list, value) {
  const i = list.findIndex(x => x.id === value.id);
  if (i < 0) list.push(value); else list.splice(i, 1, value);
}
form.onsubmit = e => {
  e.preventDefault();
  const formData = new FormData(form), data = Object.fromEntries(formData);
  const base = {...editing.original, id:editing.id || uuid()};
  if (editing.type === 'medication') {
    if (!data.name.trim()) return;
    const times = data.times.split(',').map(x => x.trim()).filter(x => /^([01]\d|2[0-3]):[0-5]\d$/.test(x));
    const kind = data.kind || 'scheduled';
    upsert(store.medications, {...base, name:data.name.trim(), stock:Number(data.stock), dose:Number(data.dose), unit:data.unit, kind,
      times:kind === 'scheduled' ? [...new Set(times.length ? times : ['09:00'])].sort() : [],
      active:kind === 'scheduled' && form.elements.active.checked, archived:form.elements.archived.checked, createdAt:base.createdAt || new Date().toISOString()});
  } else if (editing.type === 'appointment') {
    if (!data.hospital.trim()) return;
    upsert(store.appointments, {...base, hospital:data.hospital.trim(), date:savedDate('date', data.date), visitCost:Math.max(0, Number(data.visitCost)||0),
      prescriptionCost:Math.max(0, Number(data.prescriptionCost)||0), medicationIDs:formData.getAll('medicationIDs'), notes:data.notes, actions:data.actions, nextDate:savedDate('nextDate', data.nextDate)});
  } else {
    upsert(store.journal, {...base, date:savedDate('date', data.date), condition:Math.min(5, Math.max(1, Number(data.condition))), symptoms:data.symptoms, note:data.note});
  }
  save(); dialog.close(); render();
};
$('#add-button').onclick = () => openEditor(tab === 'medications' ? 'medication' : tab === 'appointments' ? 'appointment' : 'journal');
$('#cancel-editor').onclick = () => dialog.close();
dialog.addEventListener('close', refreshToday);
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  tab = b.dataset.tab;
  if (tab === 'today') { followToday = true; selectedDay = dayKey(new Date()); }
  render();
});
app.addEventListener('click', e => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const {action, id, time} = target.dataset;
  if (action.startsWith('edit-')) {
    const type = action.slice(5), key = {medication:'medications', appointment:'appointments', journal:'journal'}[type];
    openEditor(type, store[key].find(x => x.id === id));
  } else if (action === 'take' || action === 'skip' || action === 'as-needed') {
    recordDose(store.medications.find(m => m.id === id), action === 'skip' ? 'skipped' : 'taken', time, action === 'as-needed');
  } else if (action === 'undo-dose') undoDose(id);
  else if (action === 'condition') {
    store.journal.push({id:uuid(), date:new Date().toISOString(), condition:Number(id), symptoms:'', note:''}); save(); render();
  } else if (action === 'undo-condition') {
    store.journal = store.journal.filter(j => j.id !== id); save(); render();
  } else if (['previous-day', 'next-day', 'return-today'].includes(action)) {
    const today = dayKey(new Date());
    const next = action === 'return-today' ? today : shiftedDay(selectedDay, action === 'previous-day' ? -1 : 1);
    if (dayDate(next) <= dayDate(today)) { selectedDay = next; followToday = selectedDay === today; render(); }
  } else if (action === 'chart-days') { chartDays = Number(id); render(); }
  else if (action === 'calendar') addCalendar(id);
  else if (action === 'export') exportBackup();
  else if (action === 'import') $('#backup-input').click();
});
app.addEventListener('keydown', e => {
  if (e.target.matches('[role="button"]') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.target.click(); }
});
app.addEventListener('change', e => {
  if (e.target.id === 'notification-details') { store.settings.showNotificationDetails = e.target.checked; save(); }
});
function exportBackup() {
  const blob = new Blob([JSON.stringify({...store, exportedAt:new Date().toISOString()}, null, 2)], {type:'application/json'}), a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `くすりログ-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(a.href);
}
$('#backup-input').onchange = async e => {
  try {
    if (!e.target.files.length) return;
    const incoming = JSON.parse(await e.target.files[0].text());
    if (!Array.isArray(incoming.medications) || !Array.isArray(incoming.appointments) || !Array.isArray(incoming.journal)) throw Error();
    if (confirm('現在の記録をバックアップの内容で置き換えますか？')) {
      store = normalizeStore(incoming); save(); render(); alert('復元しました');
    }
  } catch { alert('このファイルは復元できませんでした'); }
  e.target.value = '';
};
function refreshToday() {
  if (tab === 'today' && !dialog.open && !document.hidden) render();
}
document.addEventListener('visibilitychange', refreshToday);
window.addEventListener('pageshow', refreshToday);
setInterval(refreshToday, 60000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
render();
