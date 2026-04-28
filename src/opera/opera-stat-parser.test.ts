import { describe, it, expect } from "vitest";
import { parseStatDmySeg } from "./opera-stat-parser";

const SAMPLE_STAT = `GRP2_CODE,SUB_GRP_CODE,SUB_GRP_CODE_DESC,DESCRIPTION,ROOMS_DAY,PM_DAY_ROOM
D,D1,Discount - D,Discount - D,10,
G,G1,Group - G,Group - G,5,
K,K1,Rack - K,Rack - K,30,
S_DAY_ROOMS,S_DAY_PERSONS,S_COMP_ROOMS,S_HOUSE_USE,S_OOO
45,52,0,0,0`;

describe("parseStatDmySeg", () => {
  it("parses segment rows", () => {
    const result = parseStatDmySeg(SAMPLE_STAT);
    expect(result.segments.length).toBe(3);
    expect(result.segments[0].segmentCode).toBe("D");
    expect(result.segments[0].roomsDay).toBe(10);
    expect(result.segments[1].segmentCode).toBe("G");
    expect(result.segments[1].roomsDay).toBe(5);
  });

  it("extracts totalRoomsOccupied from summary block", () => {
    const result = parseStatDmySeg(SAMPLE_STAT);
    expect(result.totalRoomsOccupied).toBe(45);
  });

  it("falls back to summing segments when summary block missing", () => {
    const noSummary = `GRP2_CODE,SUB_GRP_CODE,DESCRIPTION,ROOMS_DAY\nA,A1,Segment A,20\nB,B1,Segment B,15`;
    const result = parseStatDmySeg(noSummary);
    expect(result.totalRoomsOccupied).toBe(35);
  });

  it("includes description from DESCRIPTION column", () => {
    const result = parseStatDmySeg(SAMPLE_STAT);
    expect(result.segments[2].description).toBe("Rack - K");
  });

  it("falls back to SUB_GRP_CODE_DESC when DESCRIPTION column missing", () => {
    // Must have ≥4 columns per row for the parser to process them
    const noDescCol = `GRP2_CODE,SUB_GRP_CODE_DESC,ROOMS_DAY,EXTRA\nA,Segment A Desc,12,0\nS_DAY_ROOMS,S_DAY_PERSONS\n12,15`;
    const result = parseStatDmySeg(noDescCol);
    expect(result.segments[0].description).toBe("Segment A Desc");
  });

  it("falls back to segmentCode as description when neither desc column present", () => {
    const minimalCols = `GRP2_CODE,COL2,ROOMS_DAY,COL4\nX,a,7,0\nS_DAY_ROOMS,S2\n7,8`;
    const result = parseStatDmySeg(minimalCols);
    expect(result.segments[0].description).toBe("X");
  });

  it("handles zero-occupancy segments", () => {
    const withZeros = `GRP2_CODE,DESCRIPTION,ROOMS_DAY,EXTRA\nA,Segment A,0,0\nB,Segment B,5,0\nS_DAY_ROOMS,S2\n5,10`;
    const result = parseStatDmySeg(withZeros);
    expect(result.segments[0].roomsDay).toBe(0);
    expect(result.segments[1].roomsDay).toBe(5);
  });

  it("uses zero roomsDay when ROOMS_DAY column is absent from header", () => {
    const noRoomsDayCol = `GRP2_CODE,DESCRIPTION,OTHER1,OTHER2\nA,Seg A,x,y\nS_DAY_ROOMS,S2\n10,20`;
    const result = parseStatDmySeg(noRoomsDayCol);
    expect(result.segments[0].roomsDay).toBe(0);
  });

  it("returns zero totalRoomsOccupied when S_DAY_ROOMS is absent from summary header", () => {
    const noSummaryHeader = `GRP2_CODE,DESCRIPTION,ROOMS_DAY,EXTRA\nA,Seg A,5,0\nOTHER_HEADER,S2\n10,20`;
    const result = parseStatDmySeg(noSummaryHeader);
    // No S_DAY_ROOMS in summary, no summary block detected → fallback to segment sum
    expect(result.totalRoomsOccupied).toBe(5);
  });

  it("throws on empty content", () => {
    expect(() => parseStatDmySeg("")).toThrow();
  });
});
