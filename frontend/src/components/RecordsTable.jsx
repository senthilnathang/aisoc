import { Alert, AlertIcon, Box, Button, Flex, Select, Text, VisuallyHidden } from '@chakra-ui/react';
import { recordPagination } from './recordPagination.mjs';
import './records-table.css';

/** Controlled table for one supplied page of records. Callers own fetching, URL state, filters and row actions. */
export default function RecordsTable({
  caption, columns, records = [], rowKey = 'id', selectedRowKey,
  total = 0, offset = 0, limit = 25, onPageChange, onPageSizeChange,
  pageSizes = [10, 25, 50, 100], pageSizeLabel = 'Rows per page',
  recordLabel = 'records', loading = false, loadingLabel = 'Loading records…',
  error = '', onRetry, paginationDisabled = false, emptyContent = 'No matching records.',
}) {
  const page = recordPagination({ total, offset, limit, count: records.length });
  const unavailable = loading || !!error;
  const pagingDisabled = unavailable || paginationDisabled;
  const sizes = [...new Set([...pageSizes, limit])].sort((a, b) => a - b);
  const keyFor = record => typeof rowKey === 'function' ? rowKey(record) : record[rowKey];
  return <Box className="records-view" aria-busy={loading}>
    {error ? <Alert status="error"><AlertIcon /><Box flex="1">{error}</Box>{onRetry && <Button onClick={onRetry}>Retry</Button>}</Alert>
      : loading ? <Text p="24px" role="status">{loadingLabel}</Text>
      : <>
        <Box className="records-table-scroll" role="region" aria-label={`${caption} table`} tabIndex={0}>
          <table className="records-table">
            <caption><VisuallyHidden>{caption}</VisuallyHidden></caption>
            <thead><tr>{columns.map(column => <th key={column.id} scope="col" style={{ width: column.width, minWidth: column.minWidth, textAlign: column.align }}>{column.header}</th>)}</tr></thead>
            <tbody>{records.map(record => <tr key={keyFor(record)} className={keyFor(record) === selectedRowKey ? 'is-selected' : undefined}>
              {columns.map(column => <td key={column.id} style={{ textAlign: column.align }}>{column.render ? column.render(record) : record[column.id]}</td>)}
            </tr>)}</tbody>
          </table>
        </Box>
        {!records.length && <Box p="28px" role="status">{emptyContent}</Box>}
      </>}
    <Flex as="nav" aria-label={`${caption} pagination`} className="records-pagination" p="12px" gap="10px" align="center" wrap="wrap">
      <Text flex="1 1 180px" fontSize="11px" role="status" aria-live="polite">
        {loading ? 'Loading results…' : error ? 'Results unavailable' : total ? `Showing ${page.first}–${page.last} of ${total} ${recordLabel}` : `0 ${recordLabel}`}
      </Text>
      {onPageSizeChange && <Select isDisabled={paginationDisabled} aria-label={pageSizeLabel} w="auto" size="sm" value={limit} onChange={event => onPageSizeChange(Number(event.target.value))}>
        {sizes.map(size => <option key={size} value={size}>{size} / page</option>)}
      </Select>}
      <Flex gap="6px" align="center" wrap="wrap">
        <Button size="xs" variant="outline" isDisabled={pagingDisabled || !page.hasPrevious} onClick={() => onPageChange(0)}>First</Button>
        <Button size="xs" variant="outline" isDisabled={pagingDisabled || !page.hasPrevious} onClick={() => onPageChange(page.previous)}>Previous</Button>
        <Text fontSize="11px">{unavailable ? 'Page —' : `Page ${page.page} of ${page.pages}`}</Text>
        <Button size="xs" variant="outline" isDisabled={pagingDisabled || !page.hasNext} onClick={() => onPageChange(page.next)}>Next</Button>
        <Button size="xs" variant="outline" isDisabled={pagingDisabled || !page.hasNext} onClick={() => onPageChange(page.lastOffset)}>Last</Button>
      </Flex>
    </Flex>
  </Box>;
}
