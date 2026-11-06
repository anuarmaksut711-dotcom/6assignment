/* Provisional visit model. Prices/windows come from the catalog; coverage rules
 * below are site assumptions, not a claim about the club's published policy. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelPackagePricing = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const policy = 'package-estimate-v1';
  function calculate(plan, catalog, rooms) {
    const item = catalog.find(p => p.id === plan.packageId && p.room === plan.room && p.kind !== 'hourly');
    if (!item) return {ok:false, code:'package'};
    if (item.manualOnly) return {ok:false, code:'manual'};
    const guests = Number(plan.guests), duration = Number(plan.duration), room = rooms[plan.room];
    if (!room || !Number.isInteger(guests) || guests < 1 || guests > room.capacity || !Number.isInteger(duration) || duration < 1 || duration > 12) return {ok:false, code:'inputs'};
    let coveredMinutes, unusedMinutes;
    if (item.kind === 'hours') {
      coveredMinutes = Math.min(duration, item.hours) * 60;
      unusedMinutes = Math.max(0, item.hours - duration) * 60;
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.date || '') || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(plan.time || '')) return {ok:false, code:'date-time'};
      const day = Date.parse(`${plan.date}T00:00:00Z`);
      if (!Number.isFinite(day) || new Date(day).toISOString().slice(0,10) !== plan.date) return {ok:false, code:'date-time'};
      let start = Number(plan.time.slice(0,2)) * 60 + Number(plan.time.slice(3));
      let windowDay = new Date(day).getUTCDay();
      // Before 08:00, use the night that started on the previous date.
      if (item.end > 1440 && start < item.end - 1440) { start += 1440; windowDay = (windowDay + 6) % 7; }
      if (!item.weekdays.includes(windowDay)) return {ok:false, code:'weekday'};
      coveredMinutes = Math.max(0, Math.min(start + duration * 60, item.end) - Math.max(start, item.start));
      if (!coveredMinutes) return {ok:false, code:'window'};
      unusedMinutes = item.end - item.start - coveredMinutes;
    }
    const extraHours = Math.ceil((duration * 60 - coveredMinutes) / 60);
    const packageTotal = item.price * guests;
    const extraTotal = extraHours * room.hourly * guests;
    return {ok:true, policy, packageId:item.id, quantity:guests, unitPrice:item.price,
      coveredMinutes, unusedMinutes, extraHours, packageTotal, extraTotal,
      total:packageTotal + extraTotal, hourlyTotal:room.hourly * guests * duration,
      assumedWindow:!!item.assumedWindow};
  }
  return Object.freeze({policy, calculate});
});
