import { describe, expect, it } from "vitest";
import {
  LIST_PAGE_SIZE,
  filterSortPaginateList,
  parseDateParts,
  type ListFilterState,
} from "../src/components/ui/list-toolbar";
import { buildCsvWithBom, buildExcelWorkbookXml } from "../src/lib/excel-export";

type SampleRow = {
  id: string;
  case_reference: string;
  customer_name: string;
  status: string;
  created_at: string;
  total_usd: number;
};

const defaultState: ListFilterState = {
  search: "",
  status: "",
  year: "",
  month: "",
  sortOrder: "desc",
  page: 1,
};

describe("List Pagination (80/page), Month/Year Filtering, Newest-First Sorting & Excel Export", () => {
  it("enforces LIST_PAGE_SIZE = 80 and paginates 245 records into 4 pages (80, 80, 80, 5)", () => {
    expect(LIST_PAGE_SIZE).toBe(80);

    const rows: SampleRow[] = Array.from({ length: 245 }, (_, idx) => {
      const num = idx + 1;
      const day = String(((num - 1) % 28) + 1).padStart(2, "0");
      const month = String(((num - 1) % 12) + 1).padStart(2, "0");
      return {
        id: `row-${String(num).padStart(4, "0")}`,
        case_reference: `EF-2026-${String(num).padStart(4, "0")}`,
        customer_name: `عميل رقم ${num}`,
        status: num % 2 === 0 ? "ACTIVE" : "COMPLETED",
        created_at: `2026-${month}-${day}T10:00:00.000Z`,
        total_usd: num * 100,
      };
    });

    const page1 = filterSortPaginateList(rows, { ...defaultState, page: 1 }, {}, 2026);
    expect(page1.totalFiltered).toBe(245);
    expect(page1.totalPages).toBe(4);
    expect(page1.page).toBe(1);
    expect(page1.pagedRows).toHaveLength(80);
    expect(page1.startIndex).toBe(1);
    expect(page1.endIndex).toBe(80);

    const page2 = filterSortPaginateList(rows, { ...defaultState, page: 2 }, {}, 2026);
    expect(page2.page).toBe(2);
    expect(page2.pagedRows).toHaveLength(80);
    expect(page2.startIndex).toBe(81);
    expect(page2.endIndex).toBe(160);

    const page4 = filterSortPaginateList(rows, { ...defaultState, page: 4 }, {}, 2026);
    expect(page4.page).toBe(4);
    expect(page4.pagedRows).toHaveLength(5);
    expect(page4.startIndex).toBe(241);
    expect(page4.endIndex).toBe(245);

    // Out-of-bounds page clamps safely to last page
    const clamped = filterSortPaginateList(rows, { ...defaultState, page: 99 }, {}, 2026);
    expect(clamped.page).toBe(4);
    expect(clamped.pagedRows).toHaveLength(5);
  });

  it("sorts Newest-First (desc) by default and Oldest-First (asc) with deterministic ID tie-breaking", () => {
    const rows: SampleRow[] = [
      {
        id: "id-a",
        case_reference: "EF-2025-0001",
        customer_name: "الأول",
        status: "COMPLETED",
        created_at: "2025-04-10T08:00:00.000Z",
        total_usd: 1000,
      },
      {
        id: "id-c",
        case_reference: "EF-2026-0003",
        customer_name: "الثالث",
        status: "ACTIVE",
        created_at: "2026-11-12T12:00:00.000Z",
        total_usd: 3000,
      },
      {
        id: "id-b",
        case_reference: "EF-2026-0002",
        customer_name: "الثاني",
        status: "ACTIVE",
        created_at: "2026-11-12T12:00:00.000Z", // Identical timestamp to id-c
        total_usd: 2000,
      },
    ];

    const newestFirst = filterSortPaginateList(rows, { ...defaultState, sortOrder: "desc" }, {}, 2026);
    expect(newestFirst.pagedRows.map((r) => r.id)).toEqual(["id-c", "id-b", "id-a"]);

    const oldestFirst = filterSortPaginateList(rows, { ...defaultState, sortOrder: "asc" }, {}, 2026);
    expect(oldestFirst.pagedRows.map((r) => r.id)).toEqual(["id-a", "id-b", "id-c"]);
  });

  it("filters accurately by Year, Month, Status, and Arabic/English Search Query", () => {
    const rows: SampleRow[] = [
      {
        id: "1",
        case_reference: "EF-2025-0010",
        customer_name: "شركة الخليج العربي للمفروشات",
        status: "COMPLETED",
        created_at: "2025-03-15T10:00:00Z",
        total_usd: 12000,
      },
      {
        id: "2",
        case_reference: "EF-2026-0020",
        customer_name: "مؤسسة النور التجارية للبطاطين",
        status: "ACTIVE",
        created_at: "2026-03-22T10:00:00Z",
        total_usd: 24000,
      },
      {
        id: "3",
        case_reference: "EF-2026-0030",
        customer_name: "الشركة المغاربية للاستيراد",
        status: "ACTIVE",
        created_at: "2026-11-05T10:00:00Z",
        total_usd: 36000,
      },
    ];

    // Filter by Year = 2026
    const only2026 = filterSortPaginateList(rows, { ...defaultState, year: "2026" }, {}, 2026);
    expect(only2026.filteredRows.map((r) => r.id)).toEqual(["3", "2"]);

    // Filter by Month = 03 (March across all years)
    const onlyMarch = filterSortPaginateList(rows, { ...defaultState, month: "03" }, {}, 2026);
    expect(onlyMarch.filteredRows.map((r) => r.id)).toEqual(["2", "1"]);

    // Filter by Year = 2026 AND Month = 11
    const nov2026 = filterSortPaginateList(rows, { ...defaultState, year: "2026", month: "11" }, {}, 2026);
    expect(nov2026.filteredRows.map((r) => r.id)).toEqual(["3"]);

    // Filter by Arabic search text + Status
    const searchAr = filterSortPaginateList(
      rows,
      { ...defaultState, search: "النور", status: "ACTIVE" },
      {},
      2026,
    );
    expect(searchAr.filteredRows.map((r) => r.id)).toEqual(["2"]);
    expect(searchAr.activeFilterCount).toBe(2);

    // Date parser handles YYYY-MM-DD and ISO strings
    expect(parseDateParts("2026-11-12")).toMatchObject({ year: "2026", month: "11" });
    expect(parseDateParts("2025-01-05T14:22:00.000Z")).toMatchObject({ year: "2025", month: "01" });
  });

  it("builds valid Bilingual Excel SpreadsheetML (.xls) and UTF-8 BOM CSV without Mojibake", () => {
    const rows: SampleRow[] = [
      {
        id: "1",
        case_reference: "EF-2026-0001",
        customer_name: "شركة الخليج العربي للمفروشات & المنسوجات <دبي>",
        status: "ACTIVE",
        created_at: "2026-11-11",
        total_usd: 57200,
      },
    ];

    const columns = [
      { header: "رقم العملية", value: (r: SampleRow) => r.case_reference },
      { header: "اسم العميل", value: (r: SampleRow) => r.customer_name },
      { header: "الإجمالي (USD)", value: (r: SampleRow) => r.total_usd },
    ];

    const xml = buildExcelWorkbookXml({
      filename: "cases",
      sheetName: "عمليات التصدير",
      rtl: true,
      columns,
      rows,
    });

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('ss:Name="عمليات التصدير" ss:RightToLeft="1"');
    expect(xml).toContain("<Data ss:Type=\"String\">رقم العملية</Data>");
    expect(xml).toContain("شركة الخليج العربي للمفروشات &amp; المنسوجات &lt;دبي&gt;");
    expect(xml).toContain('<Data ss:Type="Number">57200</Data>');

    const csv = buildCsvWithBom({
      filename: "cases",
      columns,
      rows,
    });
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("رقم العملية,اسم العميل,الإجمالي (USD)");
    expect(csv).toContain("EF-2026-0001,شركة الخليج العربي للمفروشات & المنسوجات <دبي>,57200");
  });
});

