const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateBRN,validateCRNumber}=require('../src');

test('BRN rejects trailing garbage, partial branch codes and embedded separators',()=>{
  for(const value of ['66820292garbage','66820292-000garbage','66820292-','66820292-00','66820292-0000','668202920000','6682-0292','66 820292','C1413701',''])assert.equal(validateBRN(value).valid,false,value);
});
test('BRN retains supported exact base and branch formats',()=>{
  for(const value of ['66820292','66820292-000','66820292 000','66820292000',' 66820292-000 '])assert.equal(validateBRN(value).formatted,'66820292-000',value);
  assert.equal(validateBRN('66820292-123').branchCode,'123');
});
test('legacy CR padding remains compatible',()=>{
  assert.equal(validateCRNumber('2837074').formatted,'02837074');
  assert.equal(validateCRNumber('2837074suffix').valid,false);
});
