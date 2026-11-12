import { ArrowUpDown, Calendar, Download, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "./button";
import { Ltr } from "./chrome";
import { Input, Select } from "./input";
import { useCopy } from "../../lib/copy";
import { downloadExcelFile, type ExcelColumn } from "../../lib/excel-export";
import { cn } from "../../lib/utils";

export const LIST_PAGE_SIZE = 80;

export type SortOrder = "desc" | "asc";

export type ListFilterState = {
  search: string;
  status: string;
  year: string;
  month: string;
  sortOrder: SortOrder;
  page: number;
};

export type StatusOption = {
  value: string;
  label: string;
};

export type ListFilterConfig<T> = {
  /** Unique key to persist filter & page state in sessionStorage across back/forward navigation */
  storageKey?: string;
  /** Optional initial search value (e.g. from URL ?q=) */
  initialSearch?: string;
  /** Optional initial status value */
  initialStatus?: string;
  /** Page size (defaults to 80) */
  pageSize?: number;
  /** Extracts searchable text for a row */
  searchText?: (row: T) => string;
  /** Extracts status/category string for a row */
  statusOf?: (row: T) => string;
  /** Extracts primary date string (ISO or YYYY-MM-DD) for sorting & Month/Year filtering */
  dateOf?: (row: T) => string | null | undefined;
  /** Extracts unique row ID for deterministic tie-breaking */
  idOf?: (row: T) => string | number;
};

export type ListFilterResult<T> = {
  filteredRows: T[];
  pagedRows: T[];
  totalFiltered: number;
  totalPages: number;
  page: number;
  pageSize: number;
  startIndex: number;
  endIndex: number;
  availableYears: string[];
  activeFilterCount: number;
};

const MONTHS_AR = [
  { value: "01", label: "01 - يناير" },
  { value: "02", label: "02 - فبراير" },
  { value: "03", label: "03 - مارس" },
  { value: "04", label: "04 - أبريل" },
  { value: "05", label: "05 - مايو" },
  { value: "06", label: "06 - يونيو" },
  { value: "07", label: "07 - يوليو" },
  { value: "08", label: "08 - أغسطس" },
  { value: "09", label: "09 - سبتمبر" },
  { value: "10", label: "10 - أكتوبر" },
  { value: "11", label: "11 - نوفمبر" },
  { value: "12", label: "12 - ديسمبر" },
] as const;

const MONTHS_EN = [
  { value: "01", label: "01 - January" },
  { value: "02", label: "02 - February" },
  { value: "03", label: "03 - March" },
  { value: "04", label: "04 - April" },
  { value: "05", label: "05 - May" },
  { value: "06", label: "06 - June" },
  { value: "07", label: "07 - July" },
  { value: "08", label: "08 - August" },
  { value: "09", label: "09 - September" },
  { value: "10", label: "10 - October" },
  { value: "11", label: "11 - November" },
  { value: "12", label: "12 - December" },
] as const;

/**
 * Parses an ISO or YYYY-MM-DD date string into { year, month, timestamp }.
 */
export function parseDateParts(raw: string | null | undefined): {
  year: string | null;
  month: string | null;
  timestamp: number;
} {
  if (!raw || typeof raw !== "string") return { year: null, month: null, timestamp: 0 };
  const trimmed = raw.trim();
  const isoMatch = /^(\d{4})-(\d{2})/.exec(trimmed);
  const time = Date.parse(trimmed);
  const timestamp = Number.isNaN(time) ? 0 : time;
  if (isoMatch) {
    return { year: isoMatch[1], month: isoMatch[2], timestamp };
  }
  if (!Number.isNaN(time)) {
    const d = new Date(time);
    const y = String(d.getUTCFullYear());
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    return { year: y, month: m, timestamp };
  }
  return { year: null, month: null, timestamp: 0 };
}

/**
 * Pure deterministic function that filters, sorts (Newest-First by default),
 * and paginates a list in batches of 80 items.
 */
export function filterSortPaginateList<T>(
  items: readonly T[],
  state: ListFilterState,
  config: ListFilterConfig<T> = {},
  referenceCurrentYear: number = new Date().getFullYear(),
): ListFilterResult<T> {
  const pageSize = config.pageSize && config.pageSize > 0 ? config.pageSize : LIST_PAGE_SIZE;
  const yearsSet = new Set<string>([
    String(referenceCurrentYear),
    String(referenceCurrentYear - 1),
    String(referenceCurrentYear - 2),
  ]);

  const getDate =
    config.dateOf ??
    ((row: T) => {
      const r = row as Record<string, unknown>;
      return String(r.created_at ?? r.invoice_date ?? r.issued_at ?? r.updated_at ?? r.due_at ?? "");
    });

  const getId =
    config.idOf ??
    ((row: T) => {
      const r = row as Record<string, unknown>;
      return String(r.id ?? "");
    });

  const getSearchText =
    config.searchText ??
    ((row: T) => {
      const r = row as Record<string, unknown>;
      return Object.values(r)
        .filter((v) => typeof v === "string" || typeof v === "number")
        .join(" ");
    });

  const getStatus =
    config.statusOf ??
    ((row: T) => {
      const r = row as Record<string, unknown>;
      return String(r.status ?? "");
    });

  for (const item of items) {
    const parts = parseDateParts(getDate(item));
    if (parts.year && /^\d{4}$/.test(parts.year)) {
      yearsSet.add(parts.year);
    }
  }

  const availableYears = Array.from(yearsSet).sort((a, b) => Number(b) - Number(a));
  const queryNorm = state.search.trim().toLowerCase();
  const statusNorm = state.status.trim();
  const yearNorm = state.year.trim();
  const monthNorm = state.month.trim();

  const filtered = items.filter((item) => {
    if (statusNorm && getStatus(item) !== statusNorm) {
      return false;
    }
    if (yearNorm || monthNorm) {
      const parts = parseDateParts(getDate(item));
      if (yearNorm && parts.year !== yearNorm) return false;
      if (monthNorm && parts.month !== monthNorm) return false;
    }
    if (queryNorm) {
      const hay = getSearchText(item).toLowerCase();
      if (!hay.includes(queryNorm)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const aParts = parseDateParts(getDate(a));
    const bParts = parseDateParts(getDate(b));
    if (aParts.timestamp !== bParts.timestamp) {
      return state.sortOrder === "asc"
        ? aParts.timestamp - bParts.timestamp
        : bParts.timestamp - aParts.timestamp;
    }
    const aId = String(getId(a));
    const bId = String(getId(b));
    return state.sortOrder === "asc" ? aId.localeCompare(bId) : bId.localeCompare(aId);
  });

  const totalFiltered = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePage = Math.min(totalPages, Math.max(1, Math.floor(state.page || 1)));
  const offset = (safePage - 1) * pageSize;
  const pagedRows = sorted.slice(offset, offset + pageSize);
  const startIndex = totalFiltered === 0 ? 0 : offset + 1;
  const endIndex = Math.min(totalFiltered, offset + pageSize);

  let activeFilterCount = 0;
  if (queryNorm) activeFilterCount += 1;
  if (statusNorm) activeFilterCount += 1;
  if (yearNorm) activeFilterCount += 1;
  if (monthNorm) activeFilterCount += 1;
  if (state.sortOrder !== "desc") activeFilterCount += 1;

  return {
    filteredRows: sorted,
    pagedRows,
    totalFiltered,
    totalPages,
    page: safePage,
    pageSize,
    startIndex,
    endIndex,
    availableYears,
    activeFilterCount,
  };
}

function readStoredState(storageKey?: string, initialSearch = "", initialStatus = ""): ListFilterState {
  const fallback: ListFilterState = {
    search: initialSearch,
    status: initialStatus,
    year: "",
    month: "",
    sortOrder: "desc",
    page: 1,
  };
  if (!storageKey || typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(`exportflow.list.${storageKey}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ListFilterState>;
    return {
      search: initialSearch || (typeof parsed.search === "string" ? parsed.search : ""),
      status: initialStatus || (typeof parsed.status === "string" ? parsed.status : ""),
      year: typeof parsed.year === "string" ? parsed.year : "",
      month: typeof parsed.month === "string" ? parsed.month : "",
      sortOrder: parsed.sortOrder === "asc" ? "asc" : "desc",
      page: typeof parsed.page === "number" && parsed.page > 0 ? Math.floor(parsed.page) : 1,
    };
  } catch {
    return fallback;
  }
}

export function useListController<T>(items: readonly T[], config: ListFilterConfig<T> = {}) {
  const [state, setState] = useState<ListFilterState>(() =>
    readStoredState(config.storageKey, config.initialSearch ?? "", config.initialStatus ?? ""),
  );
  const [debouncedSearch, setDebouncedSearch] = useState(() => state.search.trim());

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(state.search.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [state.search]);

  useEffect(() => {
    if (!config.storageKey || typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(`exportflow.list.${config.storageKey}`, JSON.stringify(state));
    } catch {
      // ignore storage quota errors
    }
  }, [config.storageKey, state]);

  const computed = useMemo(
    () => filterSortPaginateList(items, state, config),
    [items, state, config],
  );

  const setSearch = (search: string) =>
    setState((prev) => ({ ...prev, search, page: 1 }));
  const setStatus = (status: string) =>
    setState((prev) => ({ ...prev, status, page: 1 }));
  const setYear = (year: string) =>
    setState((prev) => ({ ...prev, year, page: 1 }));
  const setMonth = (month: string) =>
    setState((prev) => ({ ...prev, month, page: 1 }));
  const setSortOrder = (sortOrder: SortOrder) =>
    setState((prev) => ({ ...prev, sortOrder, page: 1 }));
  const setPage = (page: number) =>
    setState((prev) => ({ ...prev, page: Math.max(1, Math.floor(page)) }));

  const resetFilters = () =>
    setState({
      search: "",
      status: config.initialStatus ?? "",
      year: "",
      month: "",
      sortOrder: "desc",
      page: 1,
    });

  return {
    ...state,
    ...computed,
    debouncedSearch,
    setSearch,
    setStatus,
    setYear,
    setMonth,
    setSortOrder,
    setPage,
    resetFilters,
  };
}

export type ListToolbarProps<T> = {
  search: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit?: (value: string) => void;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  searchInputName?: string;
  status?: string;
  onStatusChange?: (value: string) => void;
  statusOptions?: StatusOption[];
  allStatusesLabel?: string;
  year: string;
  onYearChange: (value: string) => void;
  availableYears: string[];
  month: string;
  onMonthChange: (value: string) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (value: SortOrder) => void;
  activeFilterCount: number;
  onResetFilters: () => void;
  totalFiltered: number;
  exportConfig?: {
    filename: string;
    sheetName?: string;
    columns: ExcelColumn<T>[];
    rows: T[];
  };
  extraActions?: ReactNode;
  children?: ReactNode;
};

export function ListToolbar<T>({
  search,
  onSearchChange,
  onSearchSubmit,
  searchPlaceholder,
  searchAriaLabel,
  searchInputName = "q",
  status,
  onStatusChange,
  statusOptions,
  allStatusesLabel,
  year,
  onYearChange,
  availableYears,
  month,
  onMonthChange,
  sortOrder,
  onSortOrderChange,
  activeFilterCount,
  onResetFilters,
  totalFiltered,
  exportConfig,
  extraActions,
  children,
}: ListToolbarProps<T>) {
  const { tx, i18n } = useCopy();
  const isAr = i18n.language.startsWith("ar");
  const months = isAr ? MONTHS_AR : MONTHS_EN;

  const searchBox = (
    <div className="relative min-w-52 flex-1">
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
      <Input
        name={searchInputName}
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={searchPlaceholder ?? tx("search", isAr ? "ابحث في السجلات..." : "Search records...")}
        aria-label={searchAriaLabel ?? searchPlaceholder ?? tx("search", isAr ? "بحث" : "Search")}
        className="h-9 border-line bg-paper ps-9 pe-8 text-sm text-ink placeholder:text-ink-muted/80"
      />
      {search ? (
        <button
          type="button"
          onClick={() => {
            onSearchChange("");
            onSearchSubmit?.("");
          }}
          aria-label={isAr ? "مسح النص" : "Clear search"}
          className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-ink-muted transition hover:bg-card hover:text-ink"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-2.5 rounded-card border border-line bg-card p-3 shadow-card" data-testid="list-toolbar">
      <div className="flex flex-wrap items-center gap-2">
        {onSearchSubmit ? (
          <form
            className="flex min-w-56 flex-1 items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              onSearchSubmit(search.trim());
            }}
          >
            {searchBox}
            <Button type="submit" size="sm" variant="outline" className="h-9 shrink-0">
              {tx("searchAction", isAr ? "بحث" : "Search")}
            </Button>
          </form>
        ) : (
          searchBox
        )}

        {/* Status Dropdown (if options provided) */}
        {statusOptions && statusOptions.length > 0 && onStatusChange ? (
          <Select
            value={status ?? ""}
            onChange={(event) => onStatusChange(event.target.value)}
            aria-label={isAr ? "فلتر الحالة" : "Filter by status"}
            className="h-9 w-auto min-w-[8.5rem] border-line bg-paper px-2.5 text-xs font-medium text-ink"
          >
            <option value="">{allStatusesLabel ?? tx("allStatuses", isAr ? "كل الحالات" : "All statuses")}</option>
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        ) : null}

        {/* Year Filter */}
        <div className="relative flex items-center">
          <Calendar className="pointer-events-none absolute start-2.5 h-3.5 w-3.5 text-ink-muted" aria-hidden />
          <Select
            value={year}
            onChange={(event) => onYearChange(event.target.value)}
            aria-label={isAr ? "فلتر السنة" : "Filter by year"}
            className="h-9 w-auto min-w-[7.25rem] border-line bg-paper ps-7 pe-2.5 text-xs font-medium text-ink"
          >
            <option value="">{isAr ? "كل السنوات" : "All years"}</option>
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </div>

        {/* Month Filter */}
        <Select
          value={month}
          onChange={(event) => onMonthChange(event.target.value)}
          aria-label={isAr ? "فلتر الشهر" : "Filter by month"}
          className="h-9 w-auto min-w-[8rem] border-line bg-paper px-2.5 text-xs font-medium text-ink"
        >
          <option value="">{isAr ? "كل الشهور" : "All months"}</option>
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>

        {/* Sort Direction Toggle (Newest First vs Oldest First) */}
        <div className="relative flex items-center">
          <ArrowUpDown className="pointer-events-none absolute start-2.5 h-3.5 w-3.5 text-ink-muted" aria-hidden />
          <Select
            value={sortOrder}
            onChange={(event) => onSortOrderChange(event.target.value === "asc" ? "asc" : "desc")}
            aria-label={isAr ? "ترتيب السجلات" : "Sort order"}
            className="h-9 w-auto min-w-[8.25rem] border-line bg-paper ps-7 pe-2.5 text-xs font-medium text-ink"
          >
            <option value="desc">{isAr ? "↓ الأحدث أولاً" : "↓ Newest first"}</option>
            <option value="asc">{isAr ? "↑ الأقدم أولاً" : "↑ Oldest first"}</option>
          </Select>
        </div>

        {/* Conditional Clear Filters Button */}
        {activeFilterCount > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              onResetFilters();
              onSearchSubmit?.("");
            }}
            className="h-9 gap-1.5 border border-line bg-paper px-2.5 text-xs font-semibold text-ink-muted hover:border-accent/40 hover:text-ink"
            data-testid="list-clear-filters"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            <span>{isAr ? "مسح الفلاتر" : "Clear filters"}</span>
            <span className="rounded-full bg-accent/10 px-1.5 py-0.2 text-[10px] font-bold tabular-nums text-accent">
              <Ltr>{activeFilterCount}</Ltr>
            </span>
          </Button>
        ) : null}

        {/* Excel Export Button */}
        {exportConfig ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={exportConfig.rows.length === 0}
            onClick={() =>
              downloadExcelFile({
                filename: exportConfig.filename,
                sheetName: exportConfig.sheetName,
                rtl: isAr,
                columns: exportConfig.columns,
                rows: exportConfig.rows,
              })
            }
            className="h-9 gap-1.5 border-line bg-paper px-3 text-xs font-semibold text-ink hover:border-accent/40 hover:text-accent"
            data-testid="list-export-excel"
          >
            <Download className="h-3.5 w-3.5 text-accent" aria-hidden />
            <span>{isAr ? "تصدير Excel" : "Export Excel"}</span>
          </Button>
        ) : null}

        {extraActions}

        {/* Result Counter Pill */}
        <span className="ms-auto inline-flex items-center gap-1 rounded-full border border-line bg-paper px-3 py-1 text-xs font-semibold tabular-nums text-ink-muted">
          <span>{tx("results", isAr ? "النتائج" : "Results")}:</span>
          <Ltr className="text-ink">{totalFiltered}</Ltr>
        </span>
      </div>

      {children ? <div className="flex flex-wrap items-center gap-1.5 pt-0.5">{children}</div> : null}
    </div>
  );
}

export type PaginationFooterProps = {
  page: number;
  totalPages: number;
  totalItems: number;
  startIndex: number;
  endIndex: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
};

function buildPageNumbers(current: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: Array<number | "ellipsis"> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push("ellipsis");
  for (let p = start; p <= end; p += 1) {
    pages.push(p);
  }
  if (end < total - 1) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

export function PaginationFooter({
  page,
  totalPages,
  totalItems,
  startIndex,
  endIndex,
  pageSize = LIST_PAGE_SIZE,
  onPageChange,
}: PaginationFooterProps) {
  const { i18n } = useCopy();
  const isAr = i18n.language.startsWith("ar");

  if (totalItems === 0) return null;

  const pages = buildPageNumbers(page, totalPages);

  const go = (target: number) => {
    const clamped = Math.min(totalPages, Math.max(1, target));
    if (clamped === page) return;
    onPageChange(clamped);
    if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-card px-4 py-2.5 text-xs shadow-card"
      data-testid="pagination-footer"
    >
      <div className="flex flex-wrap items-center gap-2 text-ink-muted">
        {isAr ? (
          <span>
            عرض <Ltr className="font-semibold text-ink">{startIndex}–{endIndex}</Ltr> من أصل{" "}
            <Ltr className="font-semibold text-ink">{totalItems}</Ltr> سجل
          </span>
        ) : (
          <span>
            Showing <Ltr className="font-semibold text-ink">{startIndex}–{endIndex}</Ltr> of{" "}
            <Ltr className="font-semibold text-ink">{totalItems}</Ltr> records
          </span>
        )}
        <span className="rounded-full border border-line bg-paper px-2.5 py-0.5 text-[11px] font-medium tabular-nums text-ink-muted">
          {isAr ? (
            <>
              صفحة <Ltr className="font-semibold text-ink">{page}</Ltr> من <Ltr className="font-semibold text-ink">{totalPages}</Ltr> · <Ltr>{pageSize}</Ltr> سجل/صفحة
            </>
          ) : (
            <>
              Page <Ltr className="font-semibold text-ink">{page}</Ltr> of <Ltr className="font-semibold text-ink">{totalPages}</Ltr> · <Ltr>{pageSize}</Ltr>/page
            </>
          )}
        </span>
      </div>

      <div className="flex items-center gap-1" role="navigation" aria-label={isAr ? "ترقيم الصفحات" : "Pagination"}>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => go(page - 1)}
          className="h-8 px-2.5 text-xs"
        >
          {isAr ? "السابق" : "Previous"}
        </Button>

        {pages.map((item, idx) =>
          item === "ellipsis" ? (
            <span key={`ellipsis-${idx}`} className="px-1.5 text-ink-muted">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => go(item)}
              aria-current={item === page ? "page" : undefined}
              className={cn(
                "inline-flex h-8 min-w-8 items-center justify-center rounded-control border px-2 text-xs font-semibold tabular-nums transition",
                item === page
                  ? "border-accent bg-accent-fill text-white shadow-sm"
                  : "border-line bg-paper text-ink hover:border-accent/40 hover:text-accent",
              )}
            >
              <Ltr>{item}</Ltr>
            </button>
          ),
        )}

        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => go(page + 1)}
          className="h-8 px-2.5 text-xs"
        >
          {isAr ? "التالي" : "Next"}
        </Button>
      </div>
    </div>
  );
}

