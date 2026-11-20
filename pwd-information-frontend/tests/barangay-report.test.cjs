const {test} = require('node:test');
const assert = require('node:assert/strict');

test('workbook barangays normalize consistently in filters and report groups',async()=>{
  const {barangays,normalizeBarangay}=await import('../src/utils/barangays.js');
  const {groupBarangayRecords,recordCells}=await import('../src/utils/barangayReport.js');
  const workbookBarangays=['DAYAWAN','IMELDA','KATIPUNAN','LOOC','POBLACION 2','POBLACION 3','SAN MARTIN'];
  assert.ok(workbookBarangays.every(name=>barangays.includes(name)));
  assert.equal(normalizeBarangay('Dayawan'),'DAYAWAN');
  assert.equal(normalizeBarangay(' Poblacion   2 '),'POBLACION 2');

  const groups=groupBarangayRecords([
    {pwdId:'a',firstName:'A',lastName:'Resident',barangay:'DAYAWAN'},
    {pwdId:'b',firstName:'B',lastName:'Resident',barangay:'Dayawan'},
    {pwdId:'c',firstName:'C',lastName:'Resident',barangay:'Other'},
  ]);
  assert.equal(groups.find(group=>group.name==='DAYAWAN').records.length,2);
  assert.equal(groups.find(group=>group.name==='Unassigned').records.length,1);
  assert.equal(recordCells(groups.find(group=>group.name==='DAYAWAN').records[0],0)[6],'DAYAWAN');
});
