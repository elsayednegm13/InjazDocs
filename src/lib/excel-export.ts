export type ExcelColumn<T> = {
  /** Column header label shown in the exported sheet */
  header: string;
  /** Extracts the cell value for a row */
  value: (row: T, index: number) => string | number | null | undefined;
  /** Optional explicit width in points */
  width?: number;
};

export type ExcelExportOptions<T> = {
  filename: string;
  sheetName?: string;
  rtl?: boolean;
  columns: ExcelColumn<T>[];
  rows: T[];
};

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Strip control characters invalid in XML 1.0 except tab, LF, CR
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");
}

function sanitizeSheetName(raw: string): string {
  const cleaned = raw.replace(/[\\/?*[\]:]/g, " ").trim();
  return (cleaned || "ExportFlow").slice(0, 31);
}

/**
 * Builds a complete Microsoft Excel / Google Sheets compatible SpreadsheetML
 * workbook with UTF-8 encoding, RTL worksheet direction support, auto-fitted
 * column widths, and styled header cells.
 */
export function buildExcelWorkbookXml<T>(options: ExcelExportOptions<T>): string {
  const sheetName = escapeXml(sanitizeSheetName(options.sheetName ?? "ExportFlow"));
  const rtlAttr = options.rtl ? ' ss:RightToLeft="1"' : "";

  const colWidths = options.columns.map((col) => {
    if (col.width && col.width > 0) return col.width;
    let maxChars = col.header.length;
    for (let r = 0; r < options.rows.length; r += 1) {
      const val = col.value(options.rows[r], r);
      const len = val == null ? 0 : String(val).length;
      if (len > maxChars) maxChars = len;
    }
    // Scale character count to points with comfortable padding for Arabic/Latin glyphs
    return Math.min(320, Math.max(85, Math.round(maxChars * 7.5 + 24)));
  });

  const columnTags = colWidths.map((w) => `      <Column ss:AutoFitWidth="1" ss:Width="${w}"/>`).join("\n");

  const headerCells = options.columns
    .map(
      (col) =>
        `        <Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(col.header)}</Data></Cell>`,
    )
    .join("\n");

  const dataRows = options.rows
    .map((row, rowIndex) => {
      const cells = options.columns
        .map((col) => {
          const raw = col.value(row, rowIndex);
          if (typeof raw === "number" && Number.isFinite(raw)) {
            return `        <Cell ss:StyleID="DataNum"><Data ss:Type="Number">${raw}</Data></Cell>`;
          }
          const str = raw == null || raw === "" ? "—" : String(raw);
          return `        <Cell ss:StyleID="DataText"><Data ss:Type="String">${escapeXml(str)}</Data></Cell>`;
        })
        .join("\n");
      return `      <Row ss:AutoFitHeight="1">\n${cells}\n      </Row>`;
    })
    .join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<?mso-application progid="Excel.Sheet"?>`,
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"`,
    ` xmlns:o="urn:schemas-microsoft-com:office:office"`,
    ` xmlns:x="urn:schemas-microsoft-com:office:excel"`,
    ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`,
    `  <Styles>`,
    `    <Style ss:ID="Default" ss:Name="Normal">`,
    `      <Alignment ss:Vertical="Center"/>`,
    `      <Font ss:FontName="Segoe UI" ss:Size="10" ss:Color="#182839"/>`,
    `    </Style>`,
    `    <Style ss:ID="Header">`,
    `      <Alignment ss:Vertical="Center" ss:Horizontal="Center" ss:WrapText="1"/>`,
    `      <Borders>`,
    `        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#0D9488"/>`,
    `        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D7DEE6"/>`,
    `        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D7DEE6"/>`,
    `        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#0D9488"/>`,
    `      </Borders>`,
    `      <Font ss:FontName="Segoe UI" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>`,
    `      <Interior ss:Color="#0F766E" ss:Pattern="Solid"/>`,
    `    </Style>`,
    `    <Style ss:ID="DataText">`,
    `      <Alignment ss:Vertical="Center" ss:WrapText="1"/>`,
    `      <Borders>`,
    `        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>`,
    `        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>`,
    `        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>`,
    `      </Borders>`,
    `      <Font ss:FontName="Segoe UI" ss:Size="10" ss:Color="#182839"/>`,
    `    </Style>`,
    `    <Style ss:ID="DataNum">`,
    `      <Alignment ss:Vertical="Center" ss:Horizontal="Right"/>`,
    `      <Borders>`,
    `        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>`,
    `        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>`,
    `        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>`,
    `      </Borders>`,
    `      <Font ss:FontName="Segoe UI" ss:Size="10" ss:Color="#182839"/>`,
    `    </Style>`,
    `  </Styles>`,
    `  <Worksheet ss:Name="${sheetName}"${rtlAttr}>`,
    `    <Table>`,
    columnTags,
    `      <Row ss:Height="24">`,
    headerCells,
    `      </Row>`,
    dataRows,
    `    </Table>`,
    `  </Worksheet>`,
    `</Workbook>`,
  ].join("\n");
}

function escapeCsvCell(raw: string): string {
  const guarded = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/**
 * Builds a UTF-8 BOM-prefixed CSV string for universal spreadsheet import.
 */
export function buildCsvWithBom<T>(options: ExcelExportOptions<T>): string {
  const headerLine = options.columns.map((c) => escapeCsvCell(c.header)).join(",");
  const lines = options.rows.map((row, idx) =>
    options.columns
      .map((col) => {
        const val = col.value(row, idx);
        return escapeCsvCell(val == null ? "" : String(val));
      })
      .join(","),
  );
  return `\uFEFF${[headerLine, ...lines].join("\r\n")}\r\n`;
}

/**
 * Triggers a browser download of the formatted Excel workbook (.xls).
 */
export function downloadExcelFile<T>(options: ExcelExportOptions<T>): void {
  if (typeof document === "undefined") return;
  const xml = buildExcelWorkbookXml(options);
  const blob = new Blob(["\uFEFF", xml], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const baseName = options.filename.replace(/\.(xlsx?|csv)$/i, "");
  const dateStamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `${baseName}-${dateStamp}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

