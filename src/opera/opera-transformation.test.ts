import { describe, it, expect } from "vitest";
import {
  transformTrialBalanceToJERecords,
  transformStatDmySegToStatJERecords,
} from "./opera-transformation";
import type { TrialBalanceData } from "./opera-trial-balance-parser";
import type { StatDmySegData } from "./opera-stat-parser";
import type { OperaMapping } from "./opera-mapping-loader";
import type { PropertyConfig } from "../config/property-config";

const PROPERTY_CONFIG: PropertyConfig = {
  propertyName: "holiday-inn-express-clover-lane",
  locationInternalId: "5",
  subsidiaryInternalId: "10",
  subsidiaryFullName:
    "Parent Company : Warren Family Hotels : Warren Resort Hotels of Clover Lane, Inc.",
  locationName: "Holiday Inn Express - Clover Lane",
  creditCardDepositAccount: "10030-531",
  roomsAvailable: 65,
};

function makeMapping(
  entries: Array<{
    tRXCode: string;
    glAcctCode: string;
    multiplier?: number;
    xRefKey?: string;
    tRXType?: string;
    description?: string;
  }>,
): OperaMapping {
  const map: OperaMapping = new Map();
  for (const e of entries) {
    map.set(e.tRXCode, {
      tRXCode: e.tRXCode,
      description: e.description ?? e.tRXCode,
      tRXType: e.tRXType ?? "REVENUE",
      glAcctCode: e.glAcctCode,
      glAcctName: `Account ${e.glAcctCode}`,
      multiplier: e.multiplier ?? 1,
      xRefKey: e.xRefKey ?? "",
    });
  }
  return map;
}

describe("transformTrialBalanceToJERecords", () => {
  const trialBalance: TrialBalanceData = {
    businessDate: "2026-04-07",
    transactions: [
      {
        tRXCode: "1000",
        description: "Accommodation",
        tRXType: "REVENUE",
        tBAmount: 4824.19,
        tRXDate: "2026-04-07",
        arLedDebit: 0,
      },
      {
        tRXCode: "7100",
        description: "Tourist Tax",
        tRXType: "NON REVENUE",
        tBAmount: 433.92,
        tRXDate: "2026-04-07",
        arLedDebit: 0,
      },
      {
        tRXCode: "9003",
        description: "American Express",
        tRXType: "PAYMENT",
        tBAmount: -321.12,
        tRXDate: "2026-04-07",
        arLedDebit: 0,
      },
      {
        tRXCode: "9004",
        description: "Visa",
        tRXType: "PAYMENT",
        tBAmount: -3831.75,
        tRXDate: "2026-04-07",
        arLedDebit: 0,
      },
      {
        tRXCode: "9005",
        description: "MasterCard",
        tRXType: "PAYMENT",
        tBAmount: -815.48,
        tRXDate: "2026-04-07",
        arLedDebit: 0,
      },
      {
        tRXCode: "9002",
        description: "Direct Billing",
        tRXType: "PAYMENT",
        tBAmount: -27.88,
        tRXDate: "2026-04-07",
        arLedDebit: 27.88,
      },
      {
        tRXCode: "8997",
        description: "INTERNAL",
        tRXType: "INTERNAL",
        tBAmount: 0,
        tRXDate: "2026-04-07",
        arLedDebit: 0,
      },
    ],
    guestLedgerBalance: 537.47,
  };

  const mapping = makeMapping([
    { tRXCode: "1000", glAcctCode: "40110-634", tRXType: "REVENUE" },
    { tRXCode: "7100", glAcctCode: "20103-662", tRXType: "NON REVENUE" },
    {
      tRXCode: "9003",
      glAcctCode: "10030-531",
      multiplier: -1,
      tRXType: "PAYMENT",
    },
    {
      tRXCode: "9004",
      glAcctCode: "10030-531",
      multiplier: -1,
      xRefKey: "GstPMSMCV",
      tRXType: "PAYMENT",
    },
    {
      tRXCode: "9005",
      glAcctCode: "10030-531",
      multiplier: -1,
      xRefKey: "GstPMSMCV",
      tRXType: "PAYMENT",
    },
    // 9002 intentionally NOT in mapping (Not Mapped)
    { tRXCode: "8997", glAcctCode: "Not Mapped", tRXType: "INTERNAL" },
  ]);

  it("maps revenue transactions to their GL accounts", () => {
    const records = transformTrialBalanceToJERecords(
      trialBalance,
      mapping,
      PROPERTY_CONFIG,
    );
    const accom = records.find((r) => r.sourceCode === "1000");
    expect(accom?.targetCode).toBe("40110-634");
    expect(accom?.mappedAmount).toBeCloseTo(4824.19);
  });

  it("skips INTERNAL transactions", () => {
    const records = transformTrialBalanceToJERecords(
      trialBalance,
      mapping,
      PROPERTY_CONFIG,
    );
    expect(records.find((r) => r.sourceCode === "8997")).toBeUndefined();
  });

  it("combines Visa and MasterCard into a single Visa/Master line", () => {
    const records = transformTrialBalanceToJERecords(
      trialBalance,
      mapping,
      PROPERTY_CONFIG,
    );
    const visaMaster = records.filter((r) => r.paymentMethod === "Visa/Master");
    expect(visaMaster.length).toBe(1);
    expect(visaMaster[0].mappedAmount).toBeCloseTo(3831.75 + 815.48);
  });

  it("keeps American Express as a separate line", () => {
    const records = transformTrialBalanceToJERecords(
      trialBalance,
      mapping,
      PROPERTY_CONFIG,
    );
    const amex = records.find((r) => r.paymentMethod === "American Express");
    expect(amex).toBeDefined();
    expect(amex?.mappedAmount).toBeCloseTo(321.12);
  });

  it("creates AR City Ledger debit from arLedDebit when 9002 is not mapped", () => {
    const records = transformTrialBalanceToJERecords(
      trialBalance,
      mapping,
      PROPERTY_CONFIG,
    );
    const ar = records.find((r) => r.targetCode === "10502-2051");
    expect(ar).toBeDefined();
    expect(ar?.mappedAmount).toBeCloseTo(27.88);
  });

  it("adds Guest Ledger balance line", () => {
    const records = transformTrialBalanceToJERecords(
      trialBalance,
      mapping,
      PROPERTY_CONFIG,
    );
    const gl = records.find((r) => r.targetCode === "10006-654");
    expect(gl).toBeDefined();
    expect(gl?.mappedAmount).toBeCloseTo(537.47);
  });

  it("omits Guest Ledger line when guestLedgerBalance is zero", () => {
    const zeroBalance = { ...trialBalance, guestLedgerBalance: 0 };
    const records = transformTrialBalanceToJERecords(
      zeroBalance,
      mapping,
      PROPERTY_CONFIG,
    );
    expect(records.find((r) => r.targetCode === "10006-654")).toBeUndefined();
  });

  it("omits AR City Ledger line when 9002 is not mapped and arLedDebit is zero", () => {
    const txNoAR = {
      ...trialBalance,
      transactions: [
        {
          tRXCode: "9002",
          description: "Direct Billing",
          tRXType: "PAYMENT",
          tBAmount: 0,
          tRXDate: "2026-04-07",
          arLedDebit: 0,
        },
      ],
      guestLedgerBalance: 0,
    };
    const records = transformTrialBalanceToJERecords(
      txNoAR,
      mapping,
      PROPERTY_CONFIG,
    );
    expect(records.find((r) => r.targetCode === "10502-2051")).toBeUndefined();
  });
});

describe("transformStatDmySegToStatJERecords", () => {
  const statData: StatDmySegData = {
    totalRoomsOccupied: 45,
    segments: [
      { segmentCode: "D", description: "Discount - D", roomsDay: 10 },
      { segmentCode: "G", description: "Group - G", roomsDay: 5 },
      { segmentCode: "K", description: "Rack - K", roomsDay: 30 },
    ],
  };

  it("produces a Rooms Available line using property config", () => {
    const records = transformStatDmySegToStatJERecords(
      statData,
      PROPERTY_CONFIG,
    );
    const ra = records.find((r) => r.targetCode === "90009-789");
    expect(ra).toBeDefined();
    expect(ra?.mappedAmount).toBe(65);
  });

  it("produces one Rooms Sold line per segment", () => {
    const records = transformStatDmySegToStatJERecords(
      statData,
      PROPERTY_CONFIG,
    );
    const roomsSold = records.filter((r) => r.targetCode === "90006-423");
    expect(roomsSold.length).toBe(3);
    expect(roomsSold.map((r) => r.mappedAmount)).toEqual([10, 5, 30]);
  });

  it("produces Occy, ADR, RevPAR lines all zeroed", () => {
    const records = transformStatDmySegToStatJERecords(
      statData,
      PROPERTY_CONFIG,
    );
    const occy = records.find((r) => r.targetCode === "90002-419");
    const adr = records.find((r) => r.targetCode === "90001-418");
    const revpar = records.find((r) => r.targetCode === "90003-420");
    expect(occy?.mappedAmount).toBe(0);
    expect(adr?.mappedAmount).toBe(0);
    expect(revpar?.mappedAmount).toBe(0);
  });

  it("uses 0 for roomsAvailable when not set in property config", () => {
    const configWithoutRooms = {
      ...PROPERTY_CONFIG,
      roomsAvailable: undefined,
    };
    const records = transformStatDmySegToStatJERecords(
      statData,
      configWithoutRooms,
    );
    const ra = records.find((r) => r.targetCode === "90009-789");
    expect(ra?.mappedAmount).toBe(0);
  });
});
