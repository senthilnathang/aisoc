import test from 'node:test';
import assert from 'node:assert/strict';
import {recordPagination} from '../../frontend/src/components/recordPagination.mjs';

test('server pagination respects totals and actual page records',()=>{
 const first=recordPagination({total:57,offset:0,limit:25,count:25});
 assert.equal(first.first,1);assert.equal(first.last,25);assert.equal(first.pages,3);assert.equal(first.hasPrevious,false);assert.equal(first.next,25);assert.equal(first.lastOffset,50);
 const last=recordPagination({total:57,offset:50,limit:25,count:7});
 assert.equal(last.first,51);assert.equal(last.last,57);assert.equal(last.page,3);assert.equal(last.hasNext,false);assert.equal(last.previous,25);
});
test('empty results, a single page and custom page sizes',()=>{
 const empty=recordPagination({total:0,count:0});assert.equal(empty.first,0);assert.equal(empty.last,0);assert.equal(empty.pages,1);assert.equal(empty.hasNext,false);
 const single=recordPagination({total:3,limit:10,count:3});assert.equal(single.last,3);assert.equal(single.hasNext,false);
 const custom=recordPagination({total:15,limit:7,offset:7,count:7});assert.equal(custom.page,2);assert.equal(custom.lastOffset,14);
});
