import { VisualMatrixParser } from './dist/parsers/visual-matrix-parser.js';
import fs from 'fs';

const vmParser = new VisualMatrixParser();
const vmBuffer = fs.readFileSync('VMMapping092225.xlsx');
const vmResult = await vmParser.parseFromBuffer(vmBuffer);

const criticalCodes = [
  'GUEST LEDGER',
  'CITY LEDGER', 
  'ADVANCE DEPOSITS',
  'P',
  '9',
  '91',
  '92',
  'RC',
  'RD'
];

console.log('=== CHECKING VISUAL MATRIX MAPPING FILE ===\n');
console.log(`Total mappings in file: ${vmResult.data.mappings.length}\n`);

criticalCodes.forEach(code => {
  const mappings = vmResult.data.mappings.filter(m => m.srcAcctCode === code);
  console.log(`\nCode: "${code}"`);
  console.log(`  Mappings found: ${mappings.length}`);
  
  if (mappings.length > 0) {
    mappings.forEach(m => {
      console.log(`    → Account: ${m.accountCode}`);
      console.log(`       Name: ${m.accountName}`);
      console.log(`       Property: ${m.propertyName || 'ALL (propertyId=' + m.propertyId + ')'}`);
      console.log(`       srcAcctCode: "${m.srcAcctCode}" (length: ${m.srcAcctCode.length})`);
    });
  } else {
    console.log(`  ❌ NO MAPPINGS FOUND`);
  }
});

// Show first few rows to understand structure
console.log('\n\n=== FIRST 10 MAPPINGS (for structure) ===\n');
vmResult.data.mappings.slice(0, 10).forEach((m, i) => {
  console.log(`${i + 1}. srcAcctCode="${m.srcAcctCode}" → ${m.accountCode} (${m.accountName}) [Property: ${m.propertyName || 'ALL'}]`);
});

