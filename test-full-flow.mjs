import { AccountLineParser } from './dist/parsers/account-line-parser.js';
import { VisualMatrixParser } from './dist/parsers/visual-matrix-parser.js';
import fs from 'fs';
import pdf from 'pdf-parse';

// Parse the PDF
const pdfBuffer = fs.readFileSync('/tmp/BardsInnTest.pdf');
const pdfData = await pdf(pdfBuffer);

console.log('=== STEP 1: PARSE PDF ===\n');
const accountParser = new AccountLineParser();
const accountLines = accountParser.parseAccountLines(pdfData.text);
console.log(`Extracted ${accountLines.length} account lines\n`);

// Parse the mapping file
console.log('=== STEP 2: LOAD MAPPING FILE ===\n');
const vmParser = new VisualMatrixParser();
const vmBuffer = fs.readFileSync('VMMapping092225.xlsx');
const vmResult = await vmParser.parseFromBuffer(vmBuffer);
console.log(`Loaded ${vmResult.data.mappings.length} mappings\n`);

// Try to map each extracted code
console.log('=== STEP 3: CHECK MAPPINGS FOR EXTRACTED CODES ===\n');

const criticalCodes = ['RC', 'RD', '9', '91', '92', 'GUEST LEDGER', 'CITY LEDGER', 'P'];

criticalCodes.forEach(code => {
    const extracted = accountLines.filter(l => l.sourceCode === code);
    const mapped = vmResult.data.mappings.filter(m => m.srcAcctCode === code);
    
    console.log(`\nCode: ${code}`);
    console.log(`  Extracted from PDF: ${extracted.length} times`);
    if (extracted.length > 0) {
        extracted.forEach(e => console.log(`    - ${e.amount.toFixed(2)} : ${e.description}`));
    }
    console.log(`  Mappings in file: ${mapped.length}`);
    if (mapped.length > 0) {
        mapped.forEach(m => console.log(`    -> ${m.accountCode} (${m.accountName}) [Property: ${m.propertyName || 'ALL'}]`));
    }
    if (extracted.length > 0 && mapped.length === 0) {
        console.log(`  ❌ PROBLEM: Extracted but NO MAPPING!`);
    }
});

// Check for the problematic GL codes
console.log('\n\n=== STEP 4: CHECK PROBLEMATIC GL CODES ===\n');
const glCodes = accountLines.filter(l => l.sourceCode.startsWith('GL'));
console.log(`Found ${glCodes.length} GL-prefixed codes:`);
glCodes.forEach(l => {
    console.log(`  ${l.sourceCode.padEnd(30)} - ${l.amount.toFixed(2).padStart(10)} - ${l.description.substring(0, 30)}`);
    const mapped = vmResult.data.mappings.filter(m => m.srcAcctCode === l.sourceCode);
    if (mapped.length === 0) {
        console.log(`    ❌ NO MAPPING for "${l.sourceCode}"`);
    }
});

