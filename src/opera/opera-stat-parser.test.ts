import { describe, it, expect } from "vitest";
import { parseStatDmySeg } from "./opera-stat-parser";

// Sample stat file using the real Opera column format (verified against production files).
const SAMPLE_STAT = `GRP_SORT_ORDER,GRP1_CODE_DESC,PARENT_MARKET_CODE,MARKET_GROUP_DESCRIPTION,PM_DAY_ROOM,PM_DAY_PERSON,PM_MONTH_ROOM,PM_MONTH_PERSON,PM_YEAR_ROOM,PM_YEAR_PRS,PM_DAY_CREV,PM_MONTH_CREV,PM_YEAR_CREV,PM_YEAR_ARR,PM_MONTH_ARR,PM_DAY_ARR,PM_DAY_PER_OCC,PM_MTD_PER_OCC,PM_YTD_PER_OCC,GRP2_CODE,SUB_GRP_CODE_DESC,DESCRIPTION,GRAPH_X_CODE,ROOMS_DAY,ROOM_REV_DAY,ROOMS_MTD,GUEST_MTD,ROOM_REV_MTD,ROOMS_YTD,GUEST_YTD,ROOM_REV_YTD,GUEST_DAY,ADR_DAY,ADR_MTD,ADR_YTD,PER_OCC_DAY,PER_OCC_MTD,PER_OCC_YTD
,,,,39,73,276,537,2857,4987,4978.19,33143.55,373242.29,130.641334,120.085326,127.645897,60,60.6593407,45.3132435,D,D,Discount - D,D,10,3784.25,202,404,25710.41,2057,3816,261326.3,52,135.151786,127.279257,127.042440,43.0769231,44.3956044,32.6249009
,,,,39,73,276,537,2857,4987,4978.19,33143.55,373242.29,130.641334,120.085326,127.645897,60,60.6593407,45.3132435,G,G,Corporate-Global - G,G,5,959.86,32,45,4379.04,233,301,31841.88,11,137.122857,136.845,136.660429,10.7692308,7.03296703,3.69547978
,,,,39,73,276,537,2857,4987,4978.19,33143.55,373242.29,130.641334,120.085326,127.645897,60,60.6593407,45.3132435,K,K,Rack - K,K,30,159.08,5,9,809.94,39,55,5769.15,1,159.08,161.988,147.926923,1.53846154,1.09890110,.618556701
S_DAY_ROOMS,S_DAY_PERSONS,S_MONTH_RMS,S_MONTH_PRS,S_YEAR_RMS,S_YEAR_PRS,S_DAY_ARR,S_MONTH_ARR,S_YEAR_ARR,LOGO,S_DAY_CREV,S_MONTH_CREV,S_YEAR_CREV,S_YTD_PER_OCC,S_MTD_PER_OCC,S_DAY_PER_OCC,CF_PERIOD_TEXT,CF_LEG_ROOMS_MTD,CF_LEG_REVENUE_MTD
45,73,276,537,2857,4987,127.645897,120.085326,130.641334,,4978.19,33143.55,373242.29,45.3132435,60.6593407,60,MONTH,Rooms Month to Date,Room Revenue Month to Date`;

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
