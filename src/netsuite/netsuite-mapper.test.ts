import { describe, it, expect } from "vitest";
import { PropertyConfig } from "../config/property-config";
import {
  generateJEExternalId,
  generateStatJEExternalId,
  isStatisticalRecord,
  mapToJournalEntryPayload,
  mapToStatisticalJournalEntryPayload,
  splitAccountCode,
  TransformedDataInput,
} from "./netsuite-mapper";

const testPropertyConfig: PropertyConfig = {
  propertyName: "Test Hotel",
  locationInternalId: "24",
  subsidiaryInternalId: "26",
  subsidiaryFullName: "Test Hotel Subsidiary",
  locationName: "Test Hotel",
  creditCardDepositAccount: "10070-696",
};

describe("netsuite-mapper", () => {
  describe("splitAccountCode", () => {
    it("splits a prefix-suffix account code", () => {
      expect(splitAccountCode("10006-654")).toEqual({
        prefix: "10006",
        suffix: "654",
      });
    });

    it("trims whitespace around parts", () => {
      expect(splitAccountCode(" 10006 - 654 ")).toEqual({
        prefix: "10006",
        suffix: "654",
      });
    });

    it("returns empty suffix when there is no dash", () => {
      expect(splitAccountCode("10006")).toEqual({
        prefix: "10006",
        suffix: "",
      });
    });
  });

  describe("isStatisticalRecord", () => {
    it("returns true for 90xxx account codes", () => {
      expect(
        isStatisticalRecord({
          sourceCode: "90001-418",
          sourceDescription: "Anything",
          sourceAmount: 0,
          targetCode: "90001-418",
        }),
      ).toBe(true);
    });

    it("returns true when description contains a statistical keyword", () => {
      expect(
        isStatisticalRecord({
          sourceCode: "10001-100",
          sourceDescription: "Average Daily Rate (ADR)",
          sourceAmount: 100,
        }),
      ).toBe(true);
    });

    it("returns false for a normal financial record", () => {
      expect(
        isStatisticalRecord({
          sourceCode: "40001-200",
          sourceDescription: "Room Revenue",
          sourceAmount: 500,
        }),
      ).toBe(false);
    });

    it("falls back to sourceCode when targetCode is absent", () => {
      expect(
        isStatisticalRecord({
          sourceCode: "90002-419",
          sourceDescription: "Occupancy",
          sourceAmount: 0,
        }),
      ).toBe(true);
    });
  });

  describe("generateJEExternalId", () => {
    it("matches the WR{locationId}{YYYYMMDD} format", () => {
      expect(generateJEExternalId("24", "2026-07-14")).toBe("WR2420260714");
    });
  });

  describe("generateStatJEExternalId", () => {
    it("matches the WRH{subsidiaryId}{YYYYMMDD} format", () => {
      expect(generateStatJEExternalId("26", "2026-07-14")).toBe(
        "WRH2620260714",
      );
    });
  });

  describe("mapToJournalEntryPayload", () => {
    it("maps financial records into a JE payload with debit/credit lines", () => {
      const data: TransformedDataInput = {
        propertyId: "test-hotel",
        propertyName: "Test Hotel",
        reportDate: "2026-07-14",
        records: [
          {
            sourceCode: "40001-200",
            sourceDescription: "Room Revenue",
            sourceAmount: 500,
            targetCode: "40001-200",
            targetDescription: "Room Revenue",
            mappedAmount: 500,
          },
          {
            sourceCode: "10001-100",
            sourceDescription: "Cash",
            sourceAmount: -500,
            targetCode: "10001-100",
            targetDescription: "Cash",
            mappedAmount: -500,
          },
        ],
      };

      const payload = mapToJournalEntryPayload(data, testPropertyConfig);

      expect(payload).not.toBeNull();
      expect(payload?.externalId).toBe("WR2420260714");
      expect(payload?.tranDate).toBe("2026-07-14");
      expect(payload?.subsidiary).toEqual({ id: "26" });
      expect(payload?.line.items).toHaveLength(2);

      // Revenue with positive amount -> credit
      expect(payload?.line.items[0]).toMatchObject({
        account: { id: "40001" },
        credit: 500,
      });
      expect(payload?.line.items[0].debit).toBeUndefined();

      // Asset (cash) with negative amount -> credit
      expect(payload?.line.items[1]).toMatchObject({
        account: { id: "10001" },
        credit: 500,
      });
    });

    it("includes location on every line", () => {
      const data: TransformedDataInput = {
        propertyId: "test-hotel",
        propertyName: "Test Hotel",
        reportDate: "2026-07-14",
        records: [
          {
            sourceCode: "40001-200",
            sourceDescription: "Room Revenue",
            sourceAmount: 500,
          },
        ],
      };

      const payload = mapToJournalEntryPayload(data, testPropertyConfig);
      expect(payload?.line.items[0].location).toEqual({ id: "24" });
    });

    it("uses sourceCode/sourceDescription/sourceAmount when target fields are absent", () => {
      const data: TransformedDataInput = {
        propertyId: "test-hotel",
        propertyName: "Test Hotel",
        reportDate: "2026-07-14",
        records: [
          {
            sourceCode: "50001-300",
            sourceDescription: "Supplies Expense",
            sourceAmount: 42,
          },
        ],
      };

      const payload = mapToJournalEntryPayload(data, testPropertyConfig);
      expect(payload?.line.items[0]).toMatchObject({
        account: { id: "50001" },
        debit: 42,
        memo: "Supplies Expense",
      });
    });

    it("returns null when there are no financial records", () => {
      const data: TransformedDataInput = {
        propertyId: "test-hotel",
        propertyName: "Test Hotel",
        reportDate: "2026-07-14",
        records: [
          {
            sourceCode: "90001-418",
            sourceDescription: "ADR",
            sourceAmount: 0,
          },
        ],
      };

      expect(mapToJournalEntryPayload(data, testPropertyConfig)).toBeNull();
    });

    it("puts a positive liability amount on the credit side", () => {
      const data: TransformedDataInput = {
        propertyId: "test-hotel",
        propertyName: "Test Hotel",
        reportDate: "2026-07-14",
        records: [
          {
            sourceCode: "24000-263",
            sourceDescription: "Deferred Revenue",
            sourceAmount: 100,
          },
        ],
      };

      const payload = mapToJournalEntryPayload(data, testPropertyConfig);
      expect(payload?.line.items[0]).toMatchObject({ credit: 100 });
      expect(payload?.line.items[0].debit).toBeUndefined();
    });

    it("puts a negative liability amount on the debit side", () => {
      const data: TransformedDataInput = {
        propertyId: "test-hotel",
        propertyName: "Test Hotel",
        reportDate: "2026-07-14",
        records: [
          {
            sourceCode: "24000-263",
            sourceDescription: "Deferred Revenue",
            sourceAmount: -100,
          },
        ],
      };

      const payload = mapToJournalEntryPayload(data, testPropertyConfig);
      expect(payload?.line.items[0]).toMatchObject({ debit: 100 });
      expect(payload?.line.items[0].credit).toBeUndefined();
    });

    it("puts a negative revenue amount on the debit side", () => {
      const data: TransformedDataInput = {
        propertyId: "test-hotel",
        propertyName: "Test Hotel",
        reportDate: "2026-07-14",
        records: [
          {
            sourceCode: "40001-200",
            sourceDescription: "Room Revenue Adjustment",
            sourceAmount: -50,
          },
        ],
      };

      const payload = mapToJournalEntryPayload(data, testPropertyConfig);
      expect(payload?.line.items[0]).toMatchObject({ debit: 50 });
    });

    it("defaults an unknown account type to debit for a positive amount", () => {
      const data: TransformedDataInput = {
        propertyId: "test-hotel",
        propertyName: "Test Hotel",
        reportDate: "2026-07-14",
        records: [
          {
            sourceCode: "99999-999",
            sourceDescription: "Unmapped account",
            sourceAmount: 25,
          },
        ],
      };

      const payload = mapToJournalEntryPayload(data, testPropertyConfig);
      expect(payload?.line.items[0]).toMatchObject({ debit: 25 });
    });

    it("omits memo when both target and source descriptions are empty", () => {
      const data: TransformedDataInput = {
        propertyId: "test-hotel",
        propertyName: "Test Hotel",
        reportDate: "2026-07-14",
        records: [
          {
            sourceCode: "40001-200",
            sourceDescription: "",
            sourceAmount: 100,
          },
        ],
      };

      const payload = mapToJournalEntryPayload(data, testPropertyConfig);
      expect(payload?.line.items[0].memo).toBeUndefined();
    });
  });

  describe("mapToStatisticalJournalEntryPayload", () => {
    it("maps statistical records into a StatJE payload", () => {
      const data: TransformedDataInput = {
        propertyId: "test-hotel",
        propertyName: "Test Hotel",
        reportDate: "2026-07-14",
        records: [
          {
            sourceCode: "90001-418",
            sourceDescription: "ADR",
            sourceAmount: 125.5,
            targetCode: "90001-418",
            targetDescription: "ADR",
            mappedAmount: 125.5,
          },
          {
            sourceCode: "40001-200",
            sourceDescription: "Room Revenue",
            sourceAmount: 500,
          },
        ],
      };

      const payload = mapToStatisticalJournalEntryPayload(
        data,
        testPropertyConfig,
      );

      expect(payload).not.toBeNull();
      expect(payload?.externalId).toBe("WRH2620260714");
      expect(payload?.line.items).toHaveLength(1);
      expect(payload?.line.items[0]).toMatchObject({
        account: { id: "90001" },
        amount: 125.5,
        unit: "Each",
      });
    });

    it("always reports a positive amount even for negative source values", () => {
      const data: TransformedDataInput = {
        propertyId: "test-hotel",
        propertyName: "Test Hotel",
        reportDate: "2026-07-14",
        records: [
          {
            sourceCode: "90002-419",
            sourceDescription: "Occy",
            sourceAmount: -10,
          },
        ],
      };

      const payload = mapToStatisticalJournalEntryPayload(
        data,
        testPropertyConfig,
      );
      expect(payload?.line.items[0].amount).toBe(10);
    });

    it("returns null when there are no statistical records", () => {
      const data: TransformedDataInput = {
        propertyId: "test-hotel",
        propertyName: "Test Hotel",
        reportDate: "2026-07-14",
        records: [
          {
            sourceCode: "40001-200",
            sourceDescription: "Room Revenue",
            sourceAmount: 500,
          },
        ],
      };

      expect(
        mapToStatisticalJournalEntryPayload(data, testPropertyConfig),
      ).toBeNull();
    });
  });
});
