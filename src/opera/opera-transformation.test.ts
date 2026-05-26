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
  subsidiaryFullName: "Holiday Inn Express - Clover Lane",
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
  const makeSummaryEntries = (
    entries: Record<string, number>,
  ): Map<string, number> => new Map(Object.entries(entries));

  const trialBalance: TrialBalanceData = {
    businessDate: "2026-04-07",
    transactions: [
      {
        tRXCode: "1000",
        description: "Accommodation",
        tRXType: "REVENUE",
        tBAmount: 4824.19,
        tRXDate: "2026-04-07",
      },
      {
        tRXCode: "7100",
        description: "Tourist Tax",
        tRXType: "NON REVENUE",
        tBAmount: 433.92,
        tRXDate: "2026-04-07",
      },
      {
        tRXCode: "9003",
        description: "American Express",
        tRXType: "PAYMENT",
        tBAmount: -321.12,
        tRXDate: "2026-04-07",
      },
      {
        tRXCode: "9004",
        description: "Visa",
        tRXType: "PAYMENT",
        tBAmount: -3831.75,
        tRXDate: "2026-04-07",
      },
      {
        tRXCode: "9005",
        description: "MasterCard",
        tRXType: "PAYMENT",
        tBAmount: -815.48,
        tRXDate: "2026-04-07",
      },
      {
        tRXCode: "8997",
        description: "INTERNAL",
        tRXType: "INTERNAL",
        tBAmount: 0,
        tRXDate: "2026-04-07",
      },
    ],
    summaryEntries: makeSummaryEntries({
      CS_GUEST_LED_DEBIT_REP: 5705.41,
      CS_GUEST_LED_CREDIT_REP: -4633.96, // net = 1071.45 → but we use mapping to produce this
      CS_AR_LED_DEBIT_REP: 27.88,
      CS_DEPOSIT_LED_DEBIT_REP: 533.98,
      CS_DEPOSIT_LED_CREDIT_REP: -533.98, // net deposit = 0
    }),
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
    { tRXCode: "8997", glAcctCode: "Not Mapped", tRXType: "INTERNAL" },
    // Summary block mappings
    {
      tRXCode: "CS_GUEST_LED_DEBIT_REP",
      glAcctCode: "10006-654",
      description: "Guest Ledger",
    },
    {
      tRXCode: "CS_GUEST_LED_CREDIT_REP",
      glAcctCode: "10006-654",
      description: "Guest Ledger",
    },
    {
      tRXCode: "CS_AR_LED_DEBIT_REP",
      glAcctCode: "10502-2051",
      description: "AR - City Ledger",
      xRefKey: "GstXfer",
    },
    {
      tRXCode: "CS_AR_LED_CREDIT_REP",
      glAcctCode: "10502-2051",
      description: "AR - City Ledger",
      xRefKey: "GstXfer",
    },
    {
      tRXCode: "CS_DEPOSIT_LED_DEBIT_REP",
      glAcctCode: "24000-263",
      description: "Deferred Revenue",
      multiplier: -1,
      xRefKey: "AdvDepToGstLedger",
    },
    {
      tRXCode: "CS_DEPOSIT_LED_CREDIT_REP",
      glAcctCode: "24000-263",
      description: "Deferred Revenue",
      multiplier: -1,
      xRefKey: "AdvDepToGstLedger",
    },
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

  it("generates Guest Ledger line from summary block (net of debit and credit)", () => {
    const records = transformTrialBalanceToJERecords(
      trialBalance,
      mapping,
      PROPERTY_CONFIG,
    );
    const gl = records.find((r) => r.targetCode === "10006-654");
    expect(gl).toBeDefined();
    // Net: 5705.41 * 1 + (-4633.96) * 1 = 1071.45
    expect(gl?.mappedAmount).toBeCloseTo(1071.45);
  });

  it("generates AR City Ledger line from summary block (grouped by GstXfer XRef)", () => {
    const records = transformTrialBalanceToJERecords(
      trialBalance,
      mapping,
      PROPERTY_CONFIG,
    );
    const ar = records.find((r) => r.targetCode === "10502-2051");
    expect(ar).toBeDefined();
    // Net: 27.88 * 1 + 0 (CS_AR_LED_CREDIT_REP not in summaryEntries) = 27.88
    expect(ar?.mappedAmount).toBeCloseTo(27.88);
  });

  it("nets Deferred Revenue deposit ledger to zero when debit equals credit", () => {
    const records = transformTrialBalanceToJERecords(
      trialBalance,
      mapping,
      PROPERTY_CONFIG,
    );
    // CS_DEPOSIT_LED_DEBIT_REP=533.98 * -1 + CS_DEPOSIT_LED_CREDIT_REP=-533.98 * -1 = 0
    expect(records.find((r) => r.targetCode === "24000-263")).toBeUndefined();
  });

  it("generates a Deferred Revenue credit line when deposit ledger has a net credit", () => {
    const withDeferredCredit: TrialBalanceData = {
      ...trialBalance,
      summaryEntries: makeSummaryEntries({
        CS_GUEST_LED_DEBIT_REP: 3235.81,
        CS_DEPOSIT_LED_CREDIT_REP: -133.98, // new deposit received → credit to 24000
      }),
    };
    const records = transformTrialBalanceToJERecords(
      withDeferredCredit,
      mapping,
      PROPERTY_CONFIG,
    );
    const deferred = records.find((r) => r.targetCode === "24000-263");
    expect(deferred).toBeDefined();
    // -133.98 * -1 = 133.98 → liability positive → credit in JE
    expect(deferred?.mappedAmount).toBeCloseTo(133.98);
  });

  it("generates a Deferred Revenue debit line when deposit ledger has a net debit", () => {
    const withDeferredDebit: TrialBalanceData = {
      ...trialBalance,
      summaryEntries: makeSummaryEntries({
        CS_DEPOSIT_LED_DEBIT_REP: 133.98, // deposit applied → debit to 24000
      }),
    };
    const records = transformTrialBalanceToJERecords(
      withDeferredDebit,
      mapping,
      PROPERTY_CONFIG,
    );
    const deferred = records.find((r) => r.targetCode === "24000-263");
    expect(deferred).toBeDefined();
    // 133.98 * -1 = -133.98 → liability negative → debit in JE
    expect(deferred?.mappedAmount).toBeCloseTo(-133.98);
  });

  it("omits summary group lines when summaryEntries contains no mapped codes", () => {
    const noSummary: TrialBalanceData = {
      ...trialBalance,
      summaryEntries: new Map(),
    };
    const records = transformTrialBalanceToJERecords(
      noSummary,
      mapping,
      PROPERTY_CONFIG,
    );
    expect(records.find((r) => r.targetCode === "10006-654")).toBeUndefined();
    expect(records.find((r) => r.targetCode === "10502-2051")).toBeUndefined();
    expect(records.find((r) => r.targetCode === "24000-263")).toBeUndefined();
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

  it("produces zeroed Occy, ADR, RevPAR when no trial balance is supplied", () => {
    const records = transformStatDmySegToStatJERecords(
      statData,
      PROPERTY_CONFIG,
    );
    expect(
      records.find((r) => r.targetCode === "90002-419")?.mappedAmount,
    ).toBe(0);
    expect(
      records.find((r) => r.targetCode === "90001-418")?.mappedAmount,
    ).toBe(0);
    expect(
      records.find((r) => r.targetCode === "90003-420")?.mappedAmount,
    ).toBe(0);
  });

  it("calculates ADR, Occy, RevPAR from trial balance when supplied", () => {
    // Room revenue TRX_CODEs: 1000 = 4824.19, 1309 = 154 → total = 4978.19
    // roomsSold = 45, roomsAvailable = 65
    const trialBalance: TrialBalanceData = {
      businessDate: "2026-04-07",
      transactions: [
        {
          tRXCode: "1000",
          description: "Accommodation",
          tRXType: "REVENUE",
          tBAmount: 4824.19,
          tRXDate: "2026-04-07",
        },
        {
          tRXCode: "1309",
          description: "No Show",
          tRXType: "REVENUE",
          tBAmount: 154,
          tRXDate: "2026-04-07",
        },
        {
          // Not a room revenue code — should not be included
          tRXCode: "7100",
          description: "Tourist Tax",
          tRXType: "NON REVENUE",
          tBAmount: 433.92,
          tRXDate: "2026-04-07",
        },
      ],
      summaryEntries: new Map(),
    };

    const records = transformStatDmySegToStatJERecords(
      statData,
      PROPERTY_CONFIG,
      trialBalance,
    );

    const roomRevenue = 4824.19 + 154; // 4978.19
    const adr = records.find((r) => r.targetCode === "90001-418");
    const occy = records.find((r) => r.targetCode === "90002-419");
    const revpar = records.find((r) => r.targetCode === "90003-420");

    // ADR = 4978.19 / 45
    expect(adr?.mappedAmount).toBeCloseTo(roomRevenue / 45);
    // Occy = 45 / 65
    expect(occy?.mappedAmount).toBeCloseTo(45 / 65);
    // RevPAR = 4978.19 / 65
    expect(revpar?.mappedAmount).toBeCloseTo(roomRevenue / 65);
  });

  it("sets ADR to zero when roomsSold is zero (avoids division by zero)", () => {
    const zeroRoomsStatData = { ...statData, totalRoomsOccupied: 0 };
    const trialBalance: TrialBalanceData = {
      businessDate: "2026-04-07",
      transactions: [],
      summaryEntries: new Map(),
    };
    const records = transformStatDmySegToStatJERecords(
      zeroRoomsStatData,
      PROPERTY_CONFIG,
      trialBalance,
    );
    expect(
      records.find((r) => r.targetCode === "90001-418")?.mappedAmount,
    ).toBe(0);
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
