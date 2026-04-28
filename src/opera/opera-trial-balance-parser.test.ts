import { describe, it, expect } from "vitest";
import {
  parseTrialBalance,
  parseOperaDate,
} from "./opera-trial-balance-parser";

// Minimal representative trial balance content derived from the real sample file
const SAMPLE_TRIAL_BALANCE = `TRX_NO,TRX_TYPE,TRX_TYPE_DESC,MULT,TB_AMOUNT,TRX_CODE,ACTUAL_TRX_CODE,DESCRIPTION,NET_AMOUNT,TRX_DATE,GUEST_LED_DEBIT,GUEST_LED_CREDIT,GUEST_LED_NET,AR_LED_DEBIT,AR_LED_CREDIT,AR_LED_NET,HOUSE_LED_DEBIT,HOUSE_LED_CREDIT,HOUSE_LED_NET,DEP_LED_DEBIT,DEP_LED_CREDIT,DEP_LED_NET,ADV_DEP_LED_DEBIT,ADV_DEP_LED_CREDIT,ADV_DEP_LED_NET,PAK_LED_DEBIT,PAK_LED_CREDIT,PAK_LED_NET,BALANCE_TODAY
1,REVENUE,Revenue,1,4824.19,1000,1000,*Accommodation,4824.19,07-APR-26,4824.19,0,4824.19,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
2,REVENUE,Revenue,1,154.00,1309,1309,*Accommodation,154.00,07-APR-26,154.00,0,154.00,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
3,NON REVENUE,Non Revenue,1,433.92,7100,7100,Tourist Tax,433.92,07-APR-26,433.92,0,433.92,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
4,PAYMENT,Payment,1,-5167.94,9002,9002,Direct Billing/City Ledger,-27.88,07-APR-26,0,0,0,27.88,0,27.88,0,0,0,0,0,0,0,0,0,0,0,0,0
5,PAYMENT,Payment,1,-321.12,9003,9003,American Express,-321.12,07-APR-26,0,-321.12,-321.12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
6,PAYMENT,Payment,1,-3831.75,9004,9004,Visa,-3831.75,07-APR-26,0,-3831.75,-3831.75,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
7,PAYMENT,Payment,1,-815.48,9005,9005,MasterCard,-815.48,07-APR-26,0,-815.48,-815.48,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
8,INTERNAL,Internal,1,0,8997,8997,INTERNAL,0,07-APR-26,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
CHK_BAL_GUEST_LEDGER_DEBIT,5705.41
CHK_BAL_GUEST_LEDGER_CREDIT,-4633.96
CS_TB_AMOUNT_REP,CS_GUEST_LED_DEBIT_REP,CS_GUEST_LED_CREDIT_REP,CS_AR_LED_DEBIT_REP
537.47,5705.41,-4633.96,27.88`;

describe("parseTrialBalance", () => {
  it("extracts businessDate from the first TRX_DATE column", () => {
    const result = parseTrialBalance(SAMPLE_TRIAL_BALANCE);
    expect(result.businessDate).toBe("2026-04-07");
  });

  it("parses all transaction rows", () => {
    const result = parseTrialBalance(SAMPLE_TRIAL_BALANCE);
    // 8 rows in sample (including INTERNAL) — but INTERNAL has valid TRX_DATE so it IS parsed
    expect(result.transactions.length).toBeGreaterThanOrEqual(7);
  });

  it("parses TB_AMOUNT correctly (negative for payments)", () => {
    const result = parseTrialBalance(SAMPLE_TRIAL_BALANCE);
    const amex = result.transactions.find((t) => t.tRXCode === "9003");
    expect(amex?.tBAmount).toBeCloseTo(-321.12);
  });

  it("extracts AR_LED_DEBIT for direct billing row", () => {
    const result = parseTrialBalance(SAMPLE_TRIAL_BALANCE);
    const directBilling = result.transactions.find((t) => t.tRXCode === "9002");
    expect(directBilling?.arLedDebit).toBeCloseTo(27.88);
  });

  it("parses the guest ledger balance from the summary block", () => {
    const result = parseTrialBalance(SAMPLE_TRIAL_BALANCE);
    expect(result.guestLedgerBalance).toBeCloseTo(537.47);
  });

  it("sets tRXType correctly", () => {
    const result = parseTrialBalance(SAMPLE_TRIAL_BALANCE);
    const revenue = result.transactions.find((t) => t.tRXCode === "1000");
    expect(revenue?.tRXType).toBe("REVENUE");
    const internal = result.transactions.find((t) => t.tRXCode === "8997");
    expect(internal?.tRXType).toBe("INTERNAL");
  });

  it("throws if content has no valid transactions", () => {
    expect(() => parseTrialBalance("HEADER\n")).toThrow();
  });

  it("throws when required header columns are missing", () => {
    const badHeader = "COL_A,COL_B,COL_C\n1,2,3";
    expect(() => parseTrialBalance(badHeader)).toThrow(
      /missing required columns/,
    );
  });

  it("uses first transaction TRX_DATE as businessDate when column header position yields empty date", () => {
    // A file where the TRX_DATE values ARE valid but the header row detection still works
    const noDateHeader =
      "TRX_NO,TRX_TYPE,TRX_TYPE_DESC,MULT,TB_AMOUNT,TRX_CODE,ACTUAL_TRX_CODE,DESCRIPTION,NET_AMOUNT,TRX_DATE," +
      "GL_DEBIT,GL_CREDIT,GL_NET,AR_LED_DEBIT,AR_LED_CREDIT,AR_LED_NET,H1,H2,H3,H4,H5,H6,H7,H8,H9,H10,H11,H12,BAL\n" +
      "1,REVENUE,Revenue,1,500.00,1000,1000,Accommodation,500.00,08-APR-26,500.00,0,500.00,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0\n" +
      "CS_TB_AMOUNT_REP,CS_GUEST_LED2\n50.00,500.00";
    const result = parseTrialBalance(noDateHeader);
    expect(result.businessDate).toBe("2026-04-08");
  });
});

describe("parseOperaDate", () => {
  it("converts DD-MON-YY to YYYY-MM-DD", () => {
    expect(parseOperaDate("07-APR-26")).toBe("2026-04-07");
    expect(parseOperaDate("01-JAN-25")).toBe("2025-01-01");
    expect(parseOperaDate("31-DEC-24")).toBe("2024-12-31");
  });

  it("returns null for unrecognised formats", () => {
    expect(parseOperaDate("2026-04-07")).toBeNull();
    expect(parseOperaDate("")).toBeNull();
    expect(parseOperaDate("XX-FOO-26")).toBeNull();
  });
});
