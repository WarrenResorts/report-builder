import { VisualMatrixParser } from './src/parsers/visual-matrix-parser.js';
import { readFileSync } from 'fs';

const parser = new VisualMatrixParser();
const fileBuffer = readFileSync('VMMapping092225.xlsx');

try {
  const result = await parser.parse(fileBuffer, {
    fileName: 'VMMapping092225.xlsx',
    propertyId: 'test',
  });

  if (result.success && result.data) {
    console.log(`Total mappings: ${result.data.mappings.length}\n`);
    
    // Check for specific codes we need
    const requiredCodes = ['GUEST LEDGER', 'CITY LEDGER', 'ADVANCE DEPOSITS', '9', '91', '92', 'P', 'RC', 'RD'];
    
    console.log('Checking for required mappings:\n');
    for (const code of requiredCodes) {
      const mappings = result.data.mappings.filter(m => m.srcAcctCode === code);
      if (mappings.length > 0) {
        console.log(`✓ ${code}:`);
        mappings.forEach(m => {
          console.log(`  Property: ${m.propertyName || 'GLOBAL (0)'}, Target: ${m.acctCode}, Name: ${m.acctName}, Multiplier: ${m.multiplier}`);
        });
      } else {
        console.log(`✗ ${code}: NOT FOUND`);
      }
    }
    
    // Show all unique source codes
    console.log('\n\nAll unique source codes in mapping file:');
    const uniqueCodes = [...new Set(result.data.mappings.map(m => m.srcAcctCode))].sort();
    console.log(uniqueCodes.join(', '));
    
  } else {
    console.error('Parse failed:', result.error);
  }
} catch (error) {
  console.error('Error:', error.message);
  console.error(error.stack);
}


