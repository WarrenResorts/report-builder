import fs from 'fs';
import pdfParse from 'pdf-parse';
import { AccountLineParser } from './dist/parsers/account-line-parser.js';

async function testFix() {
  const buffer = fs.readFileSync('/tmp/test.pdf');
  const data = await pdfParse(buffer);
  
  const parser = new AccountLineParser({
    combinePaymentMethods: true,
    paymentMethodGroups: {
      "Credit Cards": ["VISA", "MASTER", "AMEX"]
    }
  });
  
  console.log('=== Testing Credit Card Consolidation Fix ===\n');
  
  // Get original lines
  const originalLines = parser.parseAccountLines(data.text);
  console.log('Payment-related original lines:');
  originalLines.forEach(line => {
    if (line.sourceCode.match(/VISA|AMEX|MASTER|VS|AV|7V|AX/i)) {
      console.log(`  ${line.sourceCode.padEnd(15)}: ${line.description.padEnd(30)} = ${line.amount.toFixed(2).padStart(12)}, paymentMethod=${line.paymentMethod || 'undefined'}`);
    }
  });
  
  // Get consolidated lines
  const consolidatedLines = parser.getConsolidatedAccountLines(data.text);
  console.log('\nPayment-related consolidated lines:');
  consolidatedLines.forEach(line => {
    if (line.sourceCode.match(/VISA|AMEX|MASTER|VS|AV|7V|AX|CC/i)) {
      console.log(`  ${line.sourceCode.padEnd(15)}: ${line.description.padEnd(30)} = ${line.amount.toFixed(2).padStart(12)}, paymentMethod=${line.paymentMethod || 'undefined'}`);
    }
  });
  
  // Calculate expected total
  const ccLine = consolidatedLines.find(l => l.sourceCode === 'CC');
  if (ccLine) {
    console.log(`\n✓ Credit Cards consolidated line found: $${ccLine.amount.toFixed(2)}`);
    
    // Find individual transaction lines (those with paymentMethod set)
    const individualLines = originalLines.filter(l => 
      l.paymentMethod && ['VISA', 'AMEX', 'MASTER'].includes(l.paymentMethod)
    );
    
    console.log(`\n✓ Individual transaction lines counted in CC total: ${individualLines.length}`);
    individualLines.forEach(l => {
      console.log(`    ${l.sourceCode}: $${l.amount.toFixed(2)}`);
    });
    
    const expectedTotal = individualLines.reduce((sum, line) => sum + line.amount, 0);
    console.log(`\n✓ Sum of individual transactions: $${expectedTotal.toFixed(2)}`);
    console.log(`✓ CC consolidated line total:     $${ccLine.amount.toFixed(2)}`);
    console.log(`✓ Match: ${Math.abs(ccLine.amount - expectedTotal) < 0.01 ? '✓ YES - FIX WORKS!' : '✗ NO - STILL BROKEN'}`);
    
    // Check that summary lines are NOT included
    const summaryLines = originalLines.filter(l => 
      !l.paymentMethod && l.description === "Payment Method Total"
    );
    console.log(`\n✓ Summary lines (should NOT be in CC total): ${summaryLines.length}`);
    summaryLines.forEach(l => {
      console.log(`    ${l.sourceCode}: $${l.amount.toFixed(2)} (paymentMethod=${l.paymentMethod || 'undefined'})`);
    });
  } else {
    console.log('\n✗ No Credit Cards consolidated line found!');
  }
}

testFix().catch(console.error);
