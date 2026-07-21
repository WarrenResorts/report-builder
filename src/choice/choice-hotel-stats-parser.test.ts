import { describe, it, expect } from "vitest";
import {
  parseHotelStats,
  getRevParValue,
  REVPAR_HEADER_PREFIX,
} from "./choice-hotel-stats-parser";

// ─── Fixture ──────────────────────────────────────────────────────────────────

// Condensed two-column fixture (enough columns to exercise all logic)
const FIXTURE_HEADER =
  "Business Date: 6/14/2026," +
  "Room Statistics_Total Rooms," +
  "Room Statistics_Out Of Order," +
  "Total Occupied Rooms," +
  "Comp Rooms," +
  "Occupancy Statistics_Occ% of Total Rooms," +
  "Occupancy Statistics_ADR for Total Occupied Rooms," +
  `${REVPAR_HEADER_PREFIX}6/14/2026`;

const FIXTURE_DATA = ",61,0,37,0,60.66%,202.52,122.84";

const FIXTURE = `${FIXTURE_HEADER}\n${FIXTURE_DATA}`;

// ─── parseHotelStats ─────────────────────────────────────────────────────────

describe("parseHotelStats", () => {
  it("extracts business date from first column header", () => {
    const result = parseHotelStats(FIXTURE);
    expect(result.businessDate).toBe("2026-06-14");
  });

  it("zero-pads single-digit months and days", () => {
    const header = "Business Date: 6/5/2026,Col2";
    const data = ",val2";
    const result = parseHotelStats(`${header}\n${data}`);
    expect(result.businessDate).toBe("2026-06-05");
  });

  it("stores all column values keyed by header name", () => {
    const result = parseHotelStats(FIXTURE);
    expect(result.columns.get("Room Statistics_Total Rooms")).toBe("61");
    expect(result.columns.get("Room Statistics_Out Of Order")).toBe("0");
    expect(result.columns.get("Total Occupied Rooms")).toBe("37");
    expect(result.columns.get("Comp Rooms")).toBe("0");
    expect(result.columns.get("Occupancy Statistics_Occ% of Total Rooms")).toBe(
      "60.66%",
    );
    expect(
      result.columns.get("Occupancy Statistics_ADR for Total Occupied Rooms"),
    ).toBe("202.52");
  });

  it("stores the full RevPAR header including date", () => {
    const result = parseHotelStats(FIXTURE);
    const revparKey = `${REVPAR_HEADER_PREFIX}6/14/2026`;
    expect(result.columns.has(revparKey)).toBe(true);
    expect(result.columns.get(revparKey)).toBe("122.84");
  });

  it("throws when fewer than two lines provided", () => {
    expect(() => parseHotelStats("")).toThrow();
    expect(() => parseHotelStats("OnlyHeader")).toThrow();
  });

  it("throws when first header does not contain 'Business Date:'", () => {
    const bad = "Not a date,Col2\n,val2";
    expect(() => parseHotelStats(bad)).toThrow(/business date/i);
  });

  it("handles Windows CRLF line endings", () => {
    const crlfFixture = FIXTURE.replace(/\n/g, "\r\n");
    const result = parseHotelStats(crlfFixture);
    expect(result.businessDate).toBe("2026-06-14");
    expect(result.columns.get("Room Statistics_Total Rooms")).toBe("61");
  });
});

// ─── getRevParValue ───────────────────────────────────────────────────────────

describe("getRevParValue", () => {
  it("returns the RevPAR value via prefix matching", () => {
    const result = parseHotelStats(FIXTURE);
    expect(getRevParValue(result)).toBe("122.84");
  });

  it("returns undefined when RevPAR column is absent", () => {
    const noRevPar = "Business Date: 1/1/2026,Other\n,val";
    const result = parseHotelStats(noRevPar);
    expect(getRevParValue(result)).toBeUndefined();
  });
});
