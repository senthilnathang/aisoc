// Area-preserving binary treemap. Inputs are already bounded to 200 API groups.
export function treemap(rows, x = 0, y = 0, width = 100, height = 100) {
  const items = rows.filter(row => Number(row.count) > 0);
  if (!items.length) return [];
  if (items.length === 1) return [{ ...items[0], x, y, width, height }];
  const total = items.reduce((sum, row) => sum + Number(row.count), 0);
  let sum = 0, split = 0;
  while (split < items.length - 1 && sum < total / 2) sum += Number(items[split++].count);
  const fraction = sum / total;
  return width >= height
    ? [...treemap(items.slice(0, split), x, y, width * fraction, height), ...treemap(items.slice(split), x + width * fraction, y, width * (1 - fraction), height)]
    : [...treemap(items.slice(0, split), x, y, width, height * fraction), ...treemap(items.slice(split), x, y + height * fraction, width, height * (1 - fraction))];
}
export const coverage = row => !Number(row.linked) ? 'None' : Number(row.linked) === Number(row.count) ? 'Full' : Number(row.linked) / Number(row.count) >= .5 ? 'Majority' : 'Partial';
export const palette = { Full: '#afd1df', Majority: '#85b5ca', Partial: '#588da9', None: '#2d567c', Escalated: '#b17b49', 'Not escalated': '#c9d9dd' };
export function dailySeries(data) {
  if (!data?.window_start || !data?.as_of) return [];
  const first = new Date(data.window_start); first.setUTCHours(0, 0, 0, 0);
  const last = new Date(data.as_of); last.setUTCHours(0, 0, 0, 0);
  const rows = new Map(data.daily.map(row => [row.date, row]));
  const result = [];
  for (let at = +first; at <= +last; at += 86400000) {
    const date = new Date(at).toISOString().slice(0, 10);
    result.push(rows.get(date) || { date, total: 0, critical: 0, high: 0, medium: 0, low: 0 });
  }
  return result;
}
