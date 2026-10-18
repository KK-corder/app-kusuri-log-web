// Synthetic data only. Run this file to create JSON usable by the existing restore UI.
function fixture() {
  const medications = [
    {id:'test-a', name:'テスト定時薬A', dose:1, unit:'錠', kind:'scheduled', times:['08:00','20:00']},
    {id:'test-b', name:'テスト定時薬B', dose:0.5, unit:'包', kind:'scheduled', times:['08:00','20:00']},
    {id:'test-c', name:'テスト頓服薬', dose:2, unit:'錠', kind:'asNeeded', times:[]}
  ].map(m => ({...m, stock:100, active:true, archived:false, createdAt:'2026-09-29T00:00:00+09:00'}));
  const doseLogs = [];
  for (let i = 0; i < 20; i++) {
    const date = new Date(Date.UTC(2026, 8, 29+i)), isoDay = date.toISOString().slice(0,10);
    const scheduledDay = `${date.getUTCFullYear()}-${date.getUTCMonth()+1}-${date.getUTCDate()}`;
    for (const m of medications) {
      for (const time of m.kind === 'asNeeded' ? ['12:00'] : m.times) {
        const status = m.id === 'test-b' && time === '20:00' ? 'skipped' : 'taken';
        const stockReduction = status === 'taken' ? m.dose : 0;
        doseLogs.push({id:`${m.id}-${scheduledDay}-${time}`, medicationID:m.id, name:m.name, dose:m.dose, unit:m.unit,
          status, completedAt:`${isoDay}T${time}:12.345+09:00`, scheduledDay, scheduledTime:m.kind === 'asNeeded' ? '' : time,
          asNeeded:m.kind === 'asNeeded', stockReduction});
        m.stock -= stockReduction;
      }
    }
  }
  doseLogs.find(l => l.id === 'test-a-2026-10-17-08:00').completedAt = '2026-10-18T09:00:00+09:00';
  // An undone dose is absent, as in the app; its scheduled slot remains in the denominator.
  const undone = doseLogs.findIndex(l => l.id === 'test-a-2026-10-16-20:00');
  medications[0].stock += doseLogs[undone].stockReduction;
  doseLogs.splice(undone, 1);
  return {version:4, medications, doseLogs, appointments:[],
    journal:[{id:'test-journal', date:'2026-10-18T12:00:00+09:00', condition:3, symptoms:'', note:'テスト記録'}],
    settings:{showNotificationDetails:false}};
}
module.exports = fixture;
if (require.main === module) process.stdout.write(JSON.stringify(fixture(), null, 2)+'\n');
