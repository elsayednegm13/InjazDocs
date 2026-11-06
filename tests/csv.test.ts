import { describe, expect, it } from "vitest";
import { csvCell } from "../server/services/reports";

describe("CSV export safety", () => {
  it("neutralises spreadsheet formulas and still escapes CSV syntax", () => {
    expect(csvCell("=HYPERLINK(\"http://example.test\",\"open\")")).toMatch(/^"'=HYPERLINK/);
    expect(csvCell("+SUM(A1:A2)")).toBe("'+SUM(A1:A2)");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("plain, text")).toBe('"plain, text"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
});
