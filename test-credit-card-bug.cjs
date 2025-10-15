const fs = require('fs');
const pdfParse = require('pdf-parse');

async function analyzePDF() {
  const buffer = fs.readFileSync('/tmp/test.pdf');
  const data = await pdfParse(buffer);
  
  console.log('=== Looking for payment method lines in PDF ===\n');
  
  const lines = data.text.split('\n');
  lines.forEach((line, i) => {
    if (line.match(/VISA|AMEX|MASTER|^VS|^AV|^7V|^AX/i)) {
      console.log(`Line ${i}: ${line}`);
    }
  });
}

analyzePDF().catch(console.error);
