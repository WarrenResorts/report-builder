import { AccountLineParser } from './dist/parsers/account-line-parser.js';
import fs from 'fs';
import pdf from 'pdf-parse';

const dataBuffer = fs.readFileSync('/tmp/BardsInnTest.pdf');
const pdfData = await pdf(dataBuffer);

console.log('=== PARSING BARDS INN PDF ===\n');

const parser = new AccountLineParser();
const accountLines = parser.parseAccountLines(pdfData.text);

console.log(`Total account lines extracted: ${accountLines.length}\n`);

// Group by source code
const byCode = {};
accountLines.forEach(line => {
    if (!byCode[line.sourceCode]) {
        byCode[line.sourceCode] = [];
    }
    byCode[line.sourceCode].push(line);
});

console.log('=== ACCOUNT LINES BY SOURCE CODE ===');
Object.keys(byCode).sort().forEach(code => {
    const lines = byCode[code];
    console.log(`\n${code} (${lines.length} lines):`);
    lines.slice(0, 3).forEach(line => {
        console.log(`  ${line.amount.toFixed(2).padStart(12)} - ${line.description.substring(0, 40)}`);
    });
    if (lines.length > 3) console.log(`  ... and ${lines.length - 3} more`);
});

// Look specifically for the codes we need
console.log('\n\n=== CHECKING FOR EXPECTED CODES ===');
const expectedCodes = ['RC', 'RD', '9', '91', '92', 'GUEST LEDGER', 'CITY LEDGER', 'ADVANCE DEPOSITS'];
expectedCodes.forEach(code => {
    const found = accountLines.filter(l => l.sourceCode === code || l.sourceCode.includes(code));
    console.log(`${code.padEnd(20)}: ${found.length} found`);
    if (found.length > 0 && found.length < 5) {
        found.forEach(l => console.log(`  -> ${l.amount.toFixed(2)} : ${l.description}`));
    }
});

