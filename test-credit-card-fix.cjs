const fs = require('fs');
const pdfParse = require('pdf-parse');

// Import the AccountLineParser
const { AccountLineParser } = require('./dist/parsers/account-line-parser.js');

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
  console.log('Original parsed lines:');
  originalLines.forEach(line => {
    if (line.sourceCode.match(/VISA|AMEX|MASTER|VS|AV|7V|AX/i)) {
      console.log(`  ${line.sourceCode}: ${line.description} = ${line.amount}, paymentMethod=${line.paymentMethod}`);
    }
  });
  
  // Get consolidated lines
  const consolidatedLines = parser.getConsolidatedAccountLines(data.text);
  console.log('\nConsolidated lines (with payment bundling):');
  consolidatedLines.forEach(line => {
    if (line.sourceCode.match(/VISA|AMEX|MASTER|VS|AV|7V|AX|CC/i)) {
      console.log(`  ${line.sourceCode}: ${line.description} = ${line.amount}, paymentMethod=${line.paymentMethod}`);
    }
  });
  
  // Calculate expected total
  const ccLine = consolidatedLines.find(l => l.sourceCode === 'CC');
  if (ccLine) {
    console.log(`\n✓ Credit Cards consolidated line found: ${ccLine.amount}`);
    
    // Find individual transaction lines
    const individualLines = originalLines.filter(l => 
      l.paymentMethod && ['VISA', 'AMEX', 'MASTER'].includes(l.paymentMethod)
    );
    
    const expectedTotal = individualLines.reduce((sum, line) => sum + line.amount, 0);
    console.log(`✓ Sum of individual transactions: ${expectedTotal}`);
    console.log(`✓ Match: ${Math.abs(ccLine.amount - expectedTotal) < 0.01 ? 'YES' : 'NO'}`);
    
    // Check that summary lines are NOT included
    const summaryLines = originalLines.filter(l => 
      !l.paymentMethod && l.sourceCode.match(/VISA|AMEX|MASTER/i)
    );
    console.log(`\n✓ Summary lines (should NOT be in CC total): ${summaryLines.length}`);
    summaryLines.forEach(l => {
      console.log(`  ${l.sourceCode}: ${l.amount} (paymentMethod=${l.paymentMethod})`);
    });
  } else {
    console.log('\n✗ No Credit Cards consolidated line found!');
  }
}

testFix().catch(console.error);
