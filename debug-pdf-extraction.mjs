#!/usr/bin/env node

import fs from 'fs';

async function debugPDFExtraction() {
  try {
    // Read the test PDF
    const buffer = fs.readFileSync('/tmp/test-pdf.pdf');
    
    console.log('PDF Buffer size:', buffer.length);
    
    // Parse with pdf-parse using dynamic import (same as Lambda)
    const pdfParse = (await import('pdf-parse'));
    const data = await pdfParse(buffer);
    
    console.log('\n=== PDF METADATA ===');
    console.log('Pages:', data.numpages);
    console.log('Info:', data.info);
    
    console.log('\n=== EXTRACTED TEXT ===');
    console.log('Text length:', data.text.length);
    console.log('First 500 characters:');
    console.log(data.text.substring(0, 500));
    
    console.log('\n=== LINE ANALYSIS ===');
    const lines = data.text.split('\n').filter(line => line.trim());
    console.log('Total lines:', lines.length);
    
    // Count line frequency like our parser does
    const lineFrequency = {};
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.length > 10 && trimmed.length < 100) {
        lineFrequency[trimmed] = (lineFrequency[trimmed] || 0) + 1;
      }
    });
    
    // Show repeated lines
    const repeatedLines = Object.entries(lineFrequency)
      .filter(([line, count]) => count > 1)
      .sort((a, b) => b[1] - a[1]);
    
    console.log('\nRepeated lines (candidates for property names):');
    repeatedLines.slice(0, 10).forEach(([line, count]) => {
      console.log(`${count}x: "${line}"`);
      
      // Test our regex patterns
      const hasHotelWords = /\b(hotel|inn|resort|suites|lodge)\b/i.test(line);
      const hasNamePattern = /^[A-Z][a-z]+ [A-Z][a-z]+ (Inn|Hotel|Resort)/i.test(line);
      
      if (hasHotelWords || hasNamePattern) {
        console.log(`  -> MATCHES! Hotel words: ${hasHotelWords}, Name pattern: ${hasNamePattern}`);
        
        const match = line.match(/^([A-Z][a-z]+ [A-Z][a-z]+ (?:Inn|Hotel|Resort|Suites|Lodge))/i);
        if (match) {
          console.log(`  -> EXTRACTED: "${match[1].trim()}"`);
        }
      }
    });
    
    console.log('\n=== FIRST 20 LINES ===');
    lines.slice(0, 20).forEach((line, i) => {
      console.log(`${i+1}: "${line}"`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

debugPDFExtraction();
