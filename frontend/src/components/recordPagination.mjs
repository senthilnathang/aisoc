// Server pagination only: records are already the current page, never sliced here.
export function recordPagination({ total = 0, offset = 0, limit = 25, count = 0 }) {
  const size = Number.isSafeInteger(limit) && limit > 0 ? limit : 25;
  const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const rows = Number.isSafeInteger(total) && total >= 0 ? total : 0;
  const last = rows ? Math.floor((rows - 1) / size) * size : 0;
  return {
    first: rows && count && start < rows ? start + 1 : 0,
    last: rows && count ? Math.min(start + count, rows) : 0,
    page: rows ? Math.min(Math.floor(start / size) + 1, Math.ceil(rows / size)) : 1,
    pages: Math.max(1, Math.ceil(rows / size)),
    previous: Math.max(0, start - size), next: start + size, lastOffset: last,
    hasPrevious: start > 0, hasNext: start + size < rows,
  };
}
