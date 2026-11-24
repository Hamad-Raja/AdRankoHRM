'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),JSZip=require('jszip');
const {makeWorkbook}=require('../src/utils/reports-xlsx'),{readWorkbook}=require('../src/utils/payroll-workbook');
const schema=require('../src/validation/payroll-api.validation'),{randomUUID}=require('node:crypto');
const workbook=()=>makeWorkbook([{name:'Instructions',headers:['Setting','Value'],rows:[['Template version','ADRANKO_PAYROLL_ADJUSTMENTS_V1']]},{name:'Payroll',headers:['Employee ID','Days'],rows:[['synthetic',0]]},{name:'Adjustments',headers:['Title','Amount'],rows:[['Bonus','100.25']]}],new Date('2026-11-25T00:00Z'));
async function modify(work){const zip=await JSZip.loadAsync(await workbook());await work(zip);return zip.generateAsync({type:'nodebuffer'});}
test('payroll template reader preserves inline text, shared text and explicit zero',async()=>{
 const parsed=await readWorkbook(await workbook());assert.equal(parsed.Payroll[1].cells[1],'0');
 const bytes=await modify(async zip=>{const sheet=await zip.file('xl/worksheets/sheet2.xml').async('string');zip.file('xl/worksheets/sheet2.xml',sheet.replace(/<c r="A2"[^>]*>[\s\S]*?<\/c>/,'<c r="A2" t="s"><v>0</v></c>'));zip.file('xl/sharedStrings.xml','<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Shared employee</t></si></sst>');});assert.equal((await readWorkbook(bytes)).Payroll[1].cells[0],'Shared employee');
});
test('payroll reader rejects formulas, macros, external links and entity declarations',async()=>{
 for(const mutate of [async zip=>{const sheet=await zip.file('xl/worksheets/sheet2.xml').async('string');zip.file('xl/worksheets/sheet2.xml',sheet.replace('<v>0</v>','<f>1+1</f><v>0</v>'));},zip=>zip.file('xl/vbaProject.bin',Buffer.from('not executable')),async zip=>{const rel=await zip.file('xl/_rels/workbook.xml.rels').async('string');zip.file('xl/_rels/workbook.xml.rels',rel.replace('<Relationship Id=', '<Relationship TargetMode="External" Id='));},async zip=>{const sheet=await zip.file('xl/worksheets/sheet2.xml').async('string');zip.file('xl/worksheets/sheet2.xml','<!DOCTYPE worksheet [<!ENTITY x "unsafe">]>'+sheet);}])await assert.rejects(()=>modify(mutate).then(readWorkbook));
});
test('payroll reader bounds file bytes, expanded XML, rows, cells and malformed structure',async()=>{
 await assert.rejects(()=>readWorkbook(Buffer.alloc(2*1024*1024+1)));
 await assert.rejects(()=>modify(zip=>zip.file('xl/worksheets/sheet2.xml',' '.repeat(2*1024*1024+1))).then(readWorkbook));
 for(const edit of [text=>text.replace('<row r="2"','<row r="1302"'),text=>text.replace('r="B2"','r="A2"'),text=>text.replace('</sheetData>','</broken>')])await assert.rejects(()=>modify(async zip=>zip.file('xl/worksheets/sheet2.xml',edit(await zip.file('xl/worksheets/sheet2.xml').async('string')))).then(readWorkbook));
});
test('new batch contract rejects invalid identities/months, duplicates and excessive groups',()=>{
 const item={recordId:randomUUID(),operationKey:randomUUID(),expectedVersion:1,expectedSalaryVersionId:randomUUID(),reason:'Synthetic change',kind:'EDIT',workedDays:'0'};
 assert(schema.changes.safeParse({month:'2026-11',items:[item]}).success);
 for(const input of [{month:'2026-13',items:[item]},{month:'2026-11',items:[{...item,recordId:'not-an-id'}]},{month:'2026-11',items:[item,item]},{month:'2026-11',items:Array.from({length:26},()=>({...item,recordId:randomUUID()}))},{month:'2026-11',items:[{...item,expectedVersion:0}]}])assert.equal(schema.changes.safeParse(input).success,false);
});
