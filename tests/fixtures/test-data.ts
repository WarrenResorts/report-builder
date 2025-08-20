/**
 * @fileoverview Test Fixtures and Data
 * 
 * Provides realistic test data for integration tests including:
 * - Sample email content with attachments
 * - Test configuration data
 * - Mock file content for various formats
 */

/**
 * Sample email content for testing
 */
export const TEST_EMAIL_CONTENT = `From: test-sender@example.com
To: test@example.com
Subject: Daily Report - Integration Test
Date: Mon, 01 Jan 2024 12:00:00 +0000
Message-ID: <integration-test-message-id@example.com>
Content-Type: multipart/mixed; boundary="----=_NextPart_000_0001_01D9A1B2.C3D4E5F6"

------=_NextPart_000_0001_01D9A1B2.C3D4E5F6
Content-Type: text/plain; charset="utf-8"
Content-Transfer-Encoding: 7bit

This is an integration test email with attachments.

Please find the daily report attached.

Best regards,
Test Sender

------=_NextPart_000_0001_01D9A1B2.C3D4E5F6
Content-Type: application/pdf
Content-Disposition: attachment; filename="daily-report.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQKJfbk/N8KMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PAovVHlwZSAvUGFnZXMKL0tpZHMgWzMgMCBSXQovQ291bnQgMQo+PgplbmRvYmoKMyAwIG9iago8PAovVHlwZSAvUGFnZQovUGFyZW50IDIgMCBSCi9SZXNvdXJjZXMgPDwKL0ZvbnQgPDwKL0YxIDQgMCBSCj4+Cj4+Ci9NZWRpYUJveCBbMCAwIDYxMiA3OTJdCi9Db250ZW50cyA1IDAgUgo+PgplbmRvYmoKNCAwIG9iago8PAovVHlwZSAvRm9udAovU3VidHlwZSAvVHlwZTEKL0Jhc2VGb250IC9IZWx2ZXRpY2EKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL0xlbmd0aCA0NAo+PgpzdHJlYW0KQlQKL0YxIDEyIFRmCjcyIDcyMCBUZAooVGVzdCBQREYgZm9yIEludGVncmF0aW9uKSBUagpFVApzdHJlYW0KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0NSAwMDAwMCBuIAowMDAwMDAwMzE3IDAwMDAwIG4gCnRyYWlsZXIKPDwKL1NpemUgNgovUm9vdCAxIDAgUgo+PgpzdGFydHhyZWYKNDEwCiUlRU9G

------=_NextPart_000_0001_01D9A1B2.C3D4E5F6
Content-Type: text/csv
Content-Disposition: attachment; filename="data.csv"
Content-Transfer-Encoding: quoted-printable

Date,Property,Revenue,Occupancy
2024-01-01,Test Property 1,5000.00,85.5
2024-01-01,Test Property 2,3500.00,72.3
2024-01-01,Test Property 3,4200.00,91.2

------=_NextPart_000_0001_01D9A1B2.C3D4E5F6--
`;

/**
 * Simple email content without attachments
 */
export const TEST_EMAIL_NO_ATTACHMENTS = `From: test-sender@example.com
To: test@example.com
Subject: Simple Test Email
Date: Mon, 01 Jan 2024 12:00:00 +0000
Message-ID: <simple-test-message-id@example.com>
Content-Type: text/plain; charset="utf-8"

This is a simple test email without any attachments.

Used for testing email processing without file extraction.
`;

/**
 * Test CSV file content
 */
export const TEST_CSV_CONTENT = `Date,Property,Revenue,Occupancy,ADR
2024-01-01,Example Resort Main,12500.00,92.5,135.14
2024-01-01,Example Resort Spa,8750.00,87.3,125.86
2024-01-01,Example Resort Villas,15300.00,95.2,160.50
2024-01-02,Example Resort Main,11200.00,89.1,125.70
2024-01-02,Example Resort Spa,7980.00,82.4,118.25
2024-01-02,Example Resort Villas,14650.00,91.8,155.75`;

/**
 * Test property mapping configuration
 */
export const TEST_PROPERTY_MAPPING = {
  'test-sender@example.com': 'test-property-1',
  'property1@example.com': 'property-main',
  'property2@example.com': 'property-spa',
  'property3@example.com': 'property-villas',
  'finance@example.com': 'property-corporate',
};

/**
 * Test email configuration
 */
export const TEST_EMAIL_CONFIG = {
  recipients: 'test@example.com',
  alertEmail: 'alerts@example.com',
  fromEmail: 'test-noreply@example.com',
  configurationSet: 'test-report-builder-config',
};

/**
 * Sample SES event data
 */
export const createTestSESEvent = (messageId: string, bucketName: string, objectKey: string) => ({
  Records: [{
    eventSource: 'aws:ses',
    eventVersion: '1.0',
    ses: {
      mail: {
        messageId,
        timestamp: '2024-01-01T12:00:00.000Z',
        source: 'test-sender@example.com',
        destination: ['test@example.com'],
        commonHeaders: {
          from: ['test-sender@example.com'],
          to: ['test@example.com'],
          subject: 'Daily Report - Integration Test',
          messageId: `<${messageId}@example.com>`,
          date: 'Mon, 01 Jan 2024 12:00:00 +0000'
        },
        tags: {
          'ses:operation': ['test'],
          'ses:source-ip': ['192.0.2.1'],
          'ses:from-domain': ['example.com'],
          'ses:caller-identity': ['test-user']
        }
      },
      receipt: {
        recipients: ['test@example.com'],
        timestamp: '2024-01-01T12:00:00.000Z',
        processingTimeMillis: 150,
        action: {
          type: 'S3',
          bucketName,
          objectKey
        },
        spamVerdict: { status: 'PASS' },
        virusVerdict: { status: 'PASS' },
        spfVerdict: { status: 'PASS' },
        dkimVerdict: { status: 'PASS' },
        dmarcVerdict: { status: 'PASS' }
      }
    }
  }]
});

/**
 * Test attachment data
 */
export const TEST_ATTACHMENTS = {
  pdf: {
    filename: 'test-report.pdf',
    contentType: 'application/pdf',
    content: Buffer.from('JVBERi0xLjQKJfbk/N8KMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PAovVHlwZSAvUGFnZXMKL0tpZHMgWzMgMCBSXQovQ291bnQgMQo+PgplbmRvYmoKMyAwIG9iago8PAovVHlwZSAvUGFnZQovUGFyZW50IDIgMCBSCi9SZXNvdXJjZXMgPDwKL0ZvbnQgPDwKL0YxIDQgMCBSCj4+Cj4+Ci9NZWRpYUJveCBbMCAwIDYxMiA3OTJdCi9Db250ZW50cyA1IDAgUgo+PgplbmRvYmoKNCAwIG9iago8PAovVHlwZSAvRm9udAovU3VidHlwZSAvVHlwZTEKL0Jhc2VGb250IC9IZWx2ZXRpY2EKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL0xlbmd0aCA0NAo+PgpzdHJlYW0KQlQKL0YxIDEyIFRmCjcyIDcyMCBUZAooVGVzdCBQREYgZm9yIEludGVncmF0aW9uKSBUagpFVApzdHJlYW0KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0NSAwMDAwMCBuIAowMDAwMDAwMzE3IDAwMDAwIG4gCnRyYWlsZXIKPDwKL1NpemUgNgovUm9vdCAxIDAgUgo+PgpzdGFydHhyZWYKNDEwCiUlRU9G', 'base64')
  },
  csv: {
    filename: 'test-data.csv',
    contentType: 'text/csv',
    content: Buffer.from(TEST_CSV_CONTENT)
  },
  txt: {
    filename: 'test-notes.txt',
    contentType: 'text/plain',
    content: Buffer.from('Integration test notes:\n\n- Test property data loaded\n- All systems operational\n- Ready for processing')
  },
  xlsx: {
    filename: 'test-spreadsheet.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    // Minimal XLSX file structure (simplified for testing)
    content: Buffer.from('UEsDBBQACAgIAAAAAAAAAAAAAAAAAAAAAAAXAAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1srVVdb9MwFH1faf+B5b1J2qRJ6aoh0QANJoZgQjBe3PYqdpjruHZd0u0P9vcvdtt83VKJvkR2cq/POeeeZgDBSNH8bOCgUoibqOlgw2ILxA3wFCRjBx9udx9p7AQwVhIohKELYfaOsABKIVl3VxqMCNIULCgRSJpCHCbQwUK7R6Ht+x4jq4iXhAYCcAJfgG9ACGMBYjIQF2xAABGPMXFHfgeJLFD4QGAhgCSQABLYAYsOFsKAEZlKgRKBQAlsAgJqAgKlGwJJAEksCQJIASQAJH4KOw==', 'base64')
  }
};

/**
 * Expected file structure after email processing
 */
export const EXPECTED_FILE_STRUCTURE = {
  rawEmails: (messageId: string) => `raw-emails/${messageId}`,
  dailyFiles: (propertyId: string, date: string, filename: string) => 
    `daily-files/${propertyId}/${date}/${filename}`,
  emailMetadata: (date: string, messageId: string) => 
    `email-metadata/${date}/${messageId}.json`
};

/**
 * Test timeouts for different operations
 */
export const TEST_TIMEOUTS = {
  S3_OPERATION: 10000,    // 10 seconds
  LAMBDA_INVOKE: 30000,   // 30 seconds
  PARAMETER_STORE: 5000,  // 5 seconds
  EMAIL_PROCESSING: 45000, // 45 seconds
};

/**
 * Test configuration validation data
 */
export const INVALID_TEST_DATA = {
  malformedEmail: 'This is not a valid email format',
  emptyAttachment: Buffer.alloc(0),
  invalidFileExtension: {
    filename: 'malicious.exe',
    contentType: 'application/x-executable',
    content: Buffer.from('fake executable content')
  }
}; 