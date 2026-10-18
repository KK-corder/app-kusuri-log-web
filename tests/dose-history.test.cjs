const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const fixture = require('./dose-history-fixture.cjs');

process.env.TZ = 'Asia/Tokyo';
const source = readFileSync(join(__dirname, '../app.js'), 'utf8');
const STORE_KEY = 'kusuri-log-web-v1';
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-18T15:00:00+09:00'])); }
  static now() { return new FixedDate().getTime(); }
}

// This harness exercises app handlers and generated HTML, not browser layout or native form controls.
function boot(initial = fixture(), storage = new Map([[STORE_KEY, JSON.stringify(initial)]])) {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      innerHTML:'', hidden:false, open:false, listeners:{}, dataset:{}, fields:{},
      classList:{toggle() {}}, setAttribute() {}, removeAttribute() {},
      addEventListener(name, callback) { this.listeners[name] = callback; },
      showModal() { this.open = true; }, close() { this.open = false; }
    });
    return elements.get(selector);
  };
  const nav = ['today','journal','medications','appointments','settings'].map(tab => {
    const el = element(`nav-${tab}`); el.dataset.tab = tab; return el;
  });
  const context = vm.createContext({
    Date:FixedDate, Intl, crypto:require('node:crypto').webcrypto,
    document:{querySelector:element, querySelectorAll:() => nav, addEventListener() {}},
    localStorage:{getItem:key => storage.get(key) ?? null, setItem:(key, value) => storage.set(key, value)},
    navigator:{}, window:{addEventListener() {}}, setInterval() {}, confirm:() => true,
    FormData:class { constructor(form) { this.values = Object.entries(form.fields); }
      [Symbol.iterator]() { return this.values[Symbol.iterator](); }
      getAll(key) { return this.values.filter(([name]) => name === key).map(([,value]) => value); }
    }
  });
  vm.runInContext(source, context);
  const click = (action, id = '', time = '') => element('#app').listeners.click({target:{closest:() => ({dataset:{action, id, time}})}});
  const app = {
    storage, element, click, run:code => vm.runInContext(code, context),
    html:() => element('#app').innerHTML,
    saved:() => JSON.parse(storage.get(STORE_KEY)),
    tab:name => element(`nav-${name}`).onclick(),
    history() { this.tab('journal'); click('journal-view', 'dose'); },
    filter(id) { element('#app').listeners.change({target:{id:'dose-medication', value:id}}); },
    edit(id, values) {
      click('edit-dose', id);
      element('#editor-form').fields = values;
      element('#editor-form').onsubmit({preventDefault() {}});
    }
  };
  return app;
}
const recordIDs = html => [...html.matchAll(/data-action="edit-dose" data-id="([^"]+)"/g)].map(m => m[1]);
const headings = html => [...html.matchAll(/<h2>([^<]*回)<\/h2>/g)].map(m => m[1]);
const stock = (app, id = 'test-a') => app.saved().medications.find(m => m.id === id).stock;

test('initial condition view is unchanged; history has 14 chronological day groups and all row fields', () => {
  const app = boot(); app.tab('journal');
  assert.match(app.html(), /体調の推移/); assert.match(app.html(), /condition-chart/); assert.match(app.html(), /テスト記録/);
  assert.equal(app.element('#add-button').hidden, false);
  app.click('journal-view', 'dose');
  assert.equal(app.element('#add-button').hidden, true);
  assert.equal(headings(app.html()).length, 14);
  assert.match(headings(app.html())[0], /^10月18日（日）/);
  assert.match(headings(app.html()).at(-1), /^10月5日（月）/);
  const row = app.html().match(/<article[^>]*data-id="test-a-2026-10-18-08:00"[\s\S]*?<\/article>/)[0];
  for (const text of ['08:00','テスト定時薬A','1回 1錠','予定 8:00','服用']) assert.ok(row.includes(text));
  assert.match(app.html(), /頓服/); assert.match(app.html(), /見送り/);
  assert.ok(!recordIDs(app.html()).includes('test-a-2026-10-16-20:00'));
  app.click('journal-view', 'condition'); assert.match(app.html(), /condition-chart/);
});

test('day counts exclude PRN and undone doses; late record remains under its scheduled date', () => {
  const app = boot(); app.history();
  assert.ok(headings(app.html()).includes('10月18日（日）　3 / 4 回'));
  assert.ok(headings(app.html()).includes('10月16日（金）　2 / 4 回'));
  const day = app.html().match(/<section class="section"><h2>10月17日[\s\S]*?<\/section>/)[0];
  const row = day.match(/<article[^>]*data-id="test-a-2026-10-17-08:00"[\s\S]*?<\/article>/)[0];
  assert.match(row, /09:00/); assert.match(row, /10\/18 に記録/);
});

test('filter, reset to all, and 14-day pagination across a month boundary', () => {
  const app = boot(); app.history(); app.filter('test-b');
  assert.equal(recordIDs(app.html()).length, 28);
  assert.ok(recordIDs(app.html()).every(id => id.startsWith('test-b-')));
  app.filter('test-c'); assert.equal(recordIDs(app.html()).length, 14);
  app.filter(''); assert.equal(recordIDs(app.html()).length, 69);
  app.click('more-doses');
  assert.equal(headings(app.html()).length, 20);
  assert.equal(recordIDs(app.html()).length, 99);
  assert.match(headings(app.html()).at(-1), /^9月29日（火）/);
  assert.doesNotMatch(app.html(), /もっと見る/);
  app.filter('test-a'); assert.equal(headings(app.html()).length, 14);
});

test('filtered headings count only the selected scheduled medication or taken PRN doses', () => {
  const data = fixture();
  const prn = data.doseLogs.find(l => l.id === 'test-c-2026-10-18-12:00');
  data.doseLogs.push({...prn, id:'test-c-extra', completedAt:'2026-10-18T13:00:00+09:00'},
    {...prn, id:'test-c-skipped', status:'skipped', stockReduction:0, completedAt:'2026-10-18T14:00:00+09:00'});
  const app = boot(data); app.history();
  app.filter('test-a');
  assert.ok(headings(app.html()).includes('10月18日（日）　2 / 2 回'));
  assert.ok(headings(app.html()).includes('10月16日（金）　1 / 2 回'));
  app.filter('test-b'); assert.ok(headings(app.html()).includes('10月18日（日）　1 / 2 回'));
  app.filter('test-c');
  assert.equal(headings(app.html())[0], '10月18日（日）　2 回');
  assert.ok(headings(app.html()).includes('10月17日（土）　1 回'));
  app.filter(''); assert.equal(headings(app.html())[0], '10月18日（日）　3 / 4 回');
});

test('a day without any records remains in order with its scheduled count and neutral empty row', () => {
  const data = fixture();
  data.doseLogs = data.doseLogs.filter(l => l.scheduledDay !== '2026-10-12');
  const app = boot(data); app.history();
  const heading = '10月12日（月）　0 / 4 回';
  assert.equal(headings(app.html()).length, 14);
  assert.equal(headings(app.html())[6], heading);
  const section = app.html().match(/<section class="section"><h2>10月12日[\s\S]*?<\/section>/)[0];
  assert.match(section, /<div class="list-row">記録なし<\/div>/);
  assert.equal(recordIDs(section).length, 0);
  app.filter('test-a'); assert.ok(headings(app.html()).includes('10月12日（月）　0 / 2 回'));
  app.filter('test-c'); assert.ok(!headings(app.html()).some(h => h.startsWith('10月12日')));
  app.filter(''); app.click('more-doses');
  assert.equal(headings(app.html()).length, 20);
  assert.ok(headings(app.html()).includes(heading));
  assert.doesNotMatch(app.html(), /もっと見る/);
  data.medications[0].createdAt = '2026-10-13T00:00:00+09:00';
  const laterStart = boot(data); laterStart.history(); laterStart.filter('test-a');
  assert.ok(!headings(laterStart.html()).some(h => h.startsWith('10月12日')));
});

test('edit through the dialog handler persists 07:30 in history and Today after reload', () => {
  let app = boot(); app.history();
  const id = 'test-a-2026-10-17-08:00', before = stock(app);
  app.click('edit-dose', id);
  assert.equal(app.element('#editor').open, true);
  assert.match(app.element('#editor-fields').innerHTML, /type="datetime-local"/);
  assert.match(app.element('#editor-fields').innerHTML, /この記録を消す/);
  app.edit(id, {completedAt:'2026-10-17T07:30', status:'taken'});
  assert.equal(app.element('#editor').open, false);
  assert.match(app.html(), /07:30/); assert.equal(stock(app), before);
  assert.equal(app.saved().doseLogs.find(l => l.id === id).scheduledDay, '2026-10-17');
  app.tab('today'); app.click('previous-day'); assert.match(app.html(), /服用済み 07:30/);
  app = boot(null, app.storage);
  app.tab('today'); app.click('previous-day'); assert.match(app.html(), /服用済み 07:30/);
  app.history(); assert.match(app.html(), /07:30/);
});

test('status toggles and deletion restore exactly the original reduction for scheduled and PRN doses', () => {
  for (const [medication, id] of [['test-a','test-a-2026-10-18-08:00'], ['test-c','test-c-2026-10-18-12:00']]) {
    const app = boot(); app.history();
    const before = stock(app, medication), dose = medication === 'test-a' ? 1 : 2;
    app.edit(id, {completedAt:'2026-10-18T07:30', status:'skipped'});
    assert.equal(stock(app, medication), before+dose);
    app.tab('today'); assert.match(app.html(), /07:30 見送り|>見送り</);
    app.history();
    app.edit(id, {completedAt:'2026-10-18T07:30', status:'skipped'});
    assert.equal(stock(app, medication), before+dose);
    app.edit(id, {completedAt:'2026-10-18T07:30', status:'taken'});
    app.edit(id, {completedAt:'2026-10-18T07:30', status:'taken'});
    assert.equal(stock(app, medication), before);
    app.click('edit-dose', id); app.element('#delete-record').onclick();
    assert.equal(stock(app, medication), before+dose);
    assert.ok(!app.saved().doseLogs.some(l => l.id === id));
  }
});

test('partial and zero stock, skipped deletion, missing medication and historical dose edits are safe', () => {
  for (const reduction of [0, 0.2]) {
    const data = fixture(), id = 'test-a-2026-10-18-08:00';
    data.medications[0].stock = 0;
    data.doseLogs.find(l => l.id === id).stockReduction = reduction;
    const app = boot(data); app.history();
    app.edit(id, {completedAt:'2026-10-18T07:30', status:'skipped'});
    assert.equal(stock(app), reduction);
    app.edit(id, {completedAt:'2026-10-18T07:30', status:'taken'});
    assert.equal(stock(app), 0);
    app.click('edit-dose', id); app.element('#delete-record').onclick(); assert.equal(stock(app), reduction);
  }
  const app = boot(); app.history();
  const before = stock(app, 'test-b');
  app.click('edit-dose', 'test-b-2026-10-18-20:00'); app.element('#delete-record').onclick();
  assert.equal(stock(app, 'test-b'), before);
  const missing = fixture(); missing.medications = missing.medications.filter(m => m.id !== 'test-a');
  const orphan = boot(missing); orphan.history();
  for (const status of ['skipped','taken']) orphan.edit('test-a-2026-10-18-08:00', {completedAt:'2026-10-18T07:30', status});
  assert.match(orphan.html(), /テスト定時薬A/);
  const changed = fixture(); changed.medications[0].dose = 3;
  const edited = boot(changed); edited.history(); const initial = stock(edited);
  edited.edit('test-a-2026-10-18-08:00', {completedAt:'2026-10-18T07:30', status:'skipped'});
  edited.edit('test-a-2026-10-18-08:00', {completedAt:'2026-10-18T07:30', status:'taken'});
  assert.equal(stock(edited), initial+1-3);
});

test('old version 4 store survives unchanged; version 3 IDs migrate without losing records', () => {
  const data = fixture(), app = boot(data);
  assert.deepEqual(app.saved(), data);
  app.history(); assert.equal(recordIDs(app.html()).length, 69);
  const legacy = fixture(); legacy.version = 3;
  legacy.doseLogs.forEach(l => { delete l.scheduledDay; delete l.scheduledTime; delete l.stockReduction; });
  legacy.medications.forEach(m => { delete m.createdAt; delete m.archived; });
  const migrated = boot(legacy); migrated.history(); migrated.click('more-doses');
  assert.equal(recordIDs(migrated.html()).length, 99);
  assert.equal(migrated.saved().doseLogs.find(l => l.id === 'test-a-2026-10-17-08:00').scheduledDay, '2026-10-17');
  const before = stock(migrated);
  migrated.edit('test-a-2026-10-18-08:00', {completedAt:'2026-10-18T07:30', status:'skipped'});
  assert.equal(stock(migrated), before+1);
});

test('empty, pending-only, sparse and removed-medication history', () => {
  const data = fixture(); data.doseLogs = [];
  const app = boot(data); app.history(); assert.match(app.html(), /服用の記録はまだありません/);
  assert.equal(headings(app.html()).length, 14);
  assert.ok(headings(app.html()).every(h => h.endsWith('0 / 4 回')));
  assert.equal([...app.html().matchAll(/>記録なし</g)].length, 14);
  data.doseLogs = [{...fixture().doseLogs[0], status:'pending'}];
  const pending = boot(data); pending.history(); assert.match(pending.html(), /服用の記録はまだありません/);
  assert.equal(headings(pending.html()).length, 14);
  data.doseLogs = [fixture().doseLogs[0]]; data.medications = [];
  const sparse = boot(data); sparse.history();
  assert.match(sparse.html(), /この期間の服用の記録はありません/); assert.match(sparse.html(), /もっと見る/);
  sparse.click('more-doses'); assert.equal(recordIDs(sparse.html()).length, 1);
  assert.doesNotMatch(sparse.html(), /もっと見る/);
});

test('unchanged minute preserves timestamp precision and escapes recorded names', () => {
  const data = fixture(), id = 'test-a-2026-10-18-08:00';
  const log = data.doseLogs.find(l => l.id === id); log.name = '<script>test & "name"</script>';
  const app = boot(data); app.history();
  assert.doesNotMatch(app.html(), /<script>/); assert.match(app.html(), /&lt;script&gt;/);
  app.edit(id, {completedAt:'2026-10-18T08:00', status:'taken'});
  assert.equal(app.saved().doseLogs.find(l => l.id === id).completedAt, log.completedAt);
});

test('Today take, skip, undo, navigation and other tabs still render', () => {
  const data = fixture(); data.doseLogs = []; data.medications.forEach(m => { m.stock = 100; });
  const app = boot(data);
  app.click('take', 'test-a', '08:00'); assert.equal(stock(app), 99);
  app.click('take', 'test-a', '08:00'); assert.equal(stock(app), 99);
  app.click('undo-dose', app.saved().doseLogs[0].id); assert.equal(stock(app), 100);
  app.click('skip', 'test-a', '08:00'); assert.equal(stock(app), 100);
  app.click('previous-day'); app.click('next-day'); assert.match(app.html(), /2026年10月18日/);
  app.tab('medications'); assert.match(app.html(), /テスト定時薬A/);
  app.tab('appointments'); assert.match(app.html(), /通院記録はありません/);
  app.tab('settings'); assert.match(app.html(), /書き出す/); assert.match(app.html(), /復元する/);
});
