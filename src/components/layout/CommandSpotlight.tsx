import { Dialog, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Building2,
  ClipboardList,
  CornerDownLeft,
  FilePlus2,
  FileStack,
  FileText,
  Loader2,
  PlusCircle,
  Search,
  Ship,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { can, useSession } from "@/app/access";
import { Ltr } from "@/components/ui/chrome";
import { StatusBadge } from "@/components/ui/status";
import { api } from "@/lib/api";
import { useCopy } from "@/lib/copy";
import { cn } from "@/lib/utils";

export type SpotlightHit = {
  kind: "case" | "proforma" | "booking" | "container" | "customer" | "shortcut";
  id: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  href: string;
};

type ServerSearchResponse = {
  q: string;
  cases: SpotlightHit[];
  proformas: SpotlightHit[];
  bookings: SpotlightHit[];
  containers: SpotlightHit[];
  customers: SpotlightHit[];
};

export function CommandSpotlight({
  open,
  onOpenChange,
  initialQuery = "",
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  initialQuery?: string;
}) {
  const { tx, i18n } = useCopy();
  const isAr = i18n.language.startsWith("ar");
  const user = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(() => initialQuery.trim());
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      const id = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 20);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Global keyboard shortcut: Ctrl+K / Cmd+K
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  const trimmed = query.trim();
  const canQueryServer = open && debouncedQuery.length >= 2;

  const serverQuery = useQuery({
    queryKey: ["global-search", debouncedQuery],
    enabled: canQueryServer,
    staleTime: 30_000,
    queryFn: async () =>
      (await api<ServerSearchResponse>(`/api/v1/search?q=${encodeURIComponent(debouncedQuery)}`)).data,
  });

  // Zero-query instant matches from warm React Query caches (0ms)
  const warmCacheMatches = useMemo(() => {
    if (!open || !trimmed) {
      return {
        cases: [] as SpotlightHit[],
        proformas: [] as SpotlightHit[],
        bookings: [] as SpotlightHit[],
        containers: [] as SpotlightHit[],
        customers: [] as SpotlightHit[],
      };
    }
    const needle = trimmed.toLowerCase();
    const matchText = (...parts: Array<unknown>) =>
      parts.some((p) => p != null && String(p).toLowerCase().includes(needle));

    const cases: SpotlightHit[] = [];
    for (const [, data] of queryClient.getQueriesData<Array<Record<string, unknown>>>({ queryKey: ["cases"] })) {
      if (!Array.isArray(data)) continue;
      for (const row of data) {
        const id = String(row.id ?? "");
        if (!id || cases.some((c) => c.id === id)) continue;
        if (matchText(row.case_reference, row.customer_name, row.invoice_numbers, row.destination_country)) {
          cases.push({
            kind: "case",
            id,
            title: String(row.case_reference ?? ""),
            subtitle: row.customer_name ? String(row.customer_name) : null,
            status: row.status ? String(row.status) : null,
            href: `/export-cases/${id}`,
          });
          if (cases.length >= 5) break;
        }
      }
      if (cases.length >= 5) break;
    }

    const proformas: SpotlightHit[] = [];
    const proformaCache = queryClient.getQueryData<Array<Record<string, unknown>>>(["proformas"]);
    if (Array.isArray(proformaCache)) {
      for (const row of proformaCache) {
        const id = String(row.id ?? "");
        if (!id) continue;
        if (matchText(row.invoice_number, row.print_reference, row.customer_name, row.customer_code)) {
          proformas.push({
            kind: "proforma",
            id,
            title: String(row.invoice_number ?? ""),
            subtitle: row.customer_name ? String(row.customer_name) : null,
            status: row.status ? String(row.status) : null,
            href: `/proformas/${id}`,
          });
          if (proformas.length >= 5) break;
        }
      }
    }

    const bookings: SpotlightHit[] = [];
    const bookingsCache = queryClient.getQueryData<Array<Record<string, unknown>>>(["bookings"]);
    if (Array.isArray(bookingsCache)) {
      for (const row of bookingsCache) {
        const id = String(row.id ?? "");
        if (!id) continue;
        if (matchText(row.booking_number, row.ucr, row.case_reference, row.customer_name, row.shipping_line)) {
          bookings.push({
            kind: "booking",
            id,
            title: String(row.booking_number ?? ""),
            subtitle: String(row.case_reference || row.customer_name || row.shipping_line || "") || null,
            status: row.status ? String(row.status) : null,
            href: `/bookings/${id}`,
          });
          if (bookings.length >= 5) break;
        }
      }
    }

    const containers: SpotlightHit[] = [];
    const containersCache = queryClient.getQueryData<Array<Record<string, unknown>>>(["containers"]);
    if (Array.isArray(containersCache)) {
      for (const row of containersCache) {
        const id = String(row.id ?? "");
        if (!id || !row.official_number) continue;
        if (matchText(row.official_number, row.booking_number, row.case_reference, row.seal_number)) {
          containers.push({
            kind: "container",
            id,
            title: String(row.official_number),
            subtitle: row.booking_number ? String(row.booking_number) : null,
            status: row.status ? String(row.status) : null,
            href: row.booking_id
              ? `/bookings/${String(row.booking_id)}`
              : `/containers?q=${encodeURIComponent(String(row.official_number))}`,
          });
          if (containers.length >= 5) break;
        }
      }
    }

    const customers: SpotlightHit[] = [];
    for (const [, data] of queryClient.getQueriesData<Array<Record<string, unknown>>>({ queryKey: ["customers"] })) {
      if (!Array.isArray(data)) continue;
      for (const row of data) {
        const id = String(row.id ?? "");
        if (!id || customers.some((c) => c.id === id)) continue;
        if (matchText(row.legal_name, row.trade_name, row.customer_code, row.country_code)) {
          customers.push({
            kind: "customer",
            id,
            title: String(row.legal_name ?? ""),
            subtitle: row.customer_code ? String(row.customer_code) : null,
            status: row.country_code ? String(row.country_code) : null,
            href: `/customers/${id}`,
          });
          if (customers.length >= 5) break;
        }
      }
      if (customers.length >= 5) break;
    }

    return { cases, proformas, bookings, containers, customers };
  }, [open, trimmed, queryClient]);

  // Merge warm cache hits with server search hits without duplicates
  const mergedGroups = useMemo(() => {
    const merge = (local: SpotlightHit[], remote: SpotlightHit[] | undefined): SpotlightHit[] => {
      if (!remote || remote.length === 0) return local;
      const map = new Map<string, SpotlightHit>();
      for (const item of remote) map.set(item.id, item);
      for (const item of local) {
        if (!map.has(item.id)) map.set(item.id, item);
      }
      return Array.from(map.values()).slice(0, 5);
    };
    const srv = serverQuery.data;
    return [
      {
        key: "cases",
        label: isAr ? "العمليات التصديرية" : "Export Operations",
        items: merge(warmCacheMatches.cases, srv?.cases),
      },
      {
        key: "proformas",
        label: isAr ? "الفواتير المبدئية (Proforma)" : "Proforma Invoices",
        items: merge(warmCacheMatches.proformas, srv?.proformas),
      },
      {
        key: "bookings",
        label: isAr ? "حجوزات الشحن البحري" : "Shipping Bookings",
        items: merge(warmCacheMatches.bookings, srv?.bookings),
      },
      {
        key: "containers",
        label: isAr ? "الحاويات" : "Containers",
        items: merge(warmCacheMatches.containers, srv?.containers),
      },
      {
        key: "customers",
        label: isAr ? "العملاء والمستوردون" : "Customers",
        items: merge(warmCacheMatches.customers, srv?.customers),
      },
    ].filter((g) => g.items.length > 0);
  }, [warmCacheMatches, serverQuery.data, isAr]);

  const shortcuts = useMemo<SpotlightHit[]>(() => {
    const list: SpotlightHit[] = [];
    if (can(user, "export_cases.create")) {
      list.push({
        kind: "shortcut",
        id: "sc-new-case",
        title: isAr ? "إنشاء عملية تصديرية جديدة" : "New export operation",
        subtitle: "/export-cases/new",
        status: null,
        href: "/export-cases/new",
      });
    }
    if (can(user, "proformas.edit")) {
      list.push({
        kind: "shortcut",
        id: "sc-new-proforma",
        title: isAr ? "إنشاء فاتورة مبدئية جديدة (Proforma)" : "New proforma invoice",
        subtitle: "/proformas/new",
        status: null,
        href: "/proformas/new",
      });
    }
    if (can(user, "export_cases.view_assigned") || can(user, "export_cases.view_all")) {
      list.push({
        kind: "shortcut",
        id: "sc-cases",
        title: tx("exportOperations", isAr ? "قائمة العمليات التصديرية" : "Export operations"),
        subtitle: "/export-cases",
        status: null,
        href: "/export-cases",
      });
    }
    if (can(user, "proformas.view")) {
      list.push({
        kind: "shortcut",
        id: "sc-proformas",
        title: tx("proformas", isAr ? "قائمة الفواتير المبدئية" : "Proforma invoices"),
        subtitle: "/proformas",
        status: null,
        href: "/proformas",
      });
    }
    if (can(user, "bookings.view")) {
      list.push({
        kind: "shortcut",
        id: "sc-bookings",
        title: tx("bookings", isAr ? "حجوزات الشحن البحري" : "Shipping bookings"),
        subtitle: "/bookings",
        status: null,
        href: "/bookings",
      });
    }
    if (can(user, "customers.view")) {
      list.push({
        kind: "shortcut",
        id: "sc-customers",
        title: tx("customers", isAr ? "العملاء والمستوردون" : "Customers"),
        subtitle: "/customers",
        status: null,
        href: "/customers",
      });
    }
    if (can(user, "reports.view")) {
      list.push({
        kind: "shortcut",
        id: "sc-reports",
        title: tx("reports", isAr ? "التقارير والإحصاءات" : "Reports"),
        subtitle: "/reports",
        status: null,
        href: "/reports",
      });
    }
    return list;
  }, [user, isAr, tx]);

  const flatHits = useMemo<SpotlightHit[]>(() => {
    if (!trimmed) return shortcuts;
    return mergedGroups.flatMap((g) => g.items);
  }, [trimmed, shortcuts, mergedGroups]);

  useEffect(() => {
    setActiveIndex(0);
  }, [trimmed, flatHits.length]);

  function selectHit(hit: SpotlightHit) {
    onOpenChange(false);
    void navigate(hit.href);
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (flatHits.length > 0) {
        setActiveIndex((prev) => (prev + 1) % flatHits.length);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (flatHits.length > 0) {
        setActiveIndex((prev) => (prev - 1 + flatHits.length) % flatHits.length);
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = flatHits[activeIndex];
      if (target) {
        selectHit(target);
      } else if (trimmed) {
        onOpenChange(false);
        void navigate(`/export-cases?q=${encodeURIComponent(trimmed)}`);
      }
    }
  }

  function iconFor(hit: SpotlightHit) {
    switch (hit.kind) {
      case "case":
        return <ClipboardList className="h-4 w-4 text-accent" aria-hidden />;
      case "proforma":
        return <FileText className="h-4 w-4 text-accent" aria-hidden />;
      case "booking":
        return <Ship className="h-4 w-4 text-accent" aria-hidden />;
      case "container":
        return <Boxes className="h-4 w-4 text-accent" aria-hidden />;
      case "customer":
        return <Building2 className="h-4 w-4 text-accent" aria-hidden />;
      case "shortcut":
        return hit.id.startsWith("sc-new") ? (
          <PlusCircle className="h-4 w-4 text-accent" aria-hidden />
        ) : (
          <Sparkles className="h-4 w-4 text-accent" aria-hidden />
        );
    }
  }

  const DirArrow = isAr ? ArrowLeft : ArrowRight;
  let runningIdx = -1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] transition-opacity" />
        <DialogContent
          className="fixed start-1/2 top-[12vh] z-50 w-[min(94vw,40rem)] -translate-x-1/2 rtl:translate-x-1/2 overflow-hidden rounded-card border border-line bg-card text-ink shadow-2xl focus:outline-none"
          data-testid="command-spotlight-dialog"
        >
          <DialogTitle className="sr-only">
            {isAr ? "البحث الشامل والانتقال الفوري" : "Global Spotlight Search"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isAr
              ? "ابحث في العمليات التصديرية والفواتير المبدئية والحجوزات والحاويات والعملاء"
              : "Search across export operations, proforma invoices, bookings, containers, and customers"}
          </DialogDescription>

          {/* Search Input Bar */}
          <div className="flex items-center gap-2.5 border-b border-line bg-paper/70 px-3.5 py-2.5">
            {serverQuery.isFetching ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden />
            ) : (
              <Search className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
            )}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder={
                isAr
                  ? "ابحث برقم العملية، الفاتورة، البوليصة، الحاوية، أو اسم العميل..."
                  : "Search by case, proforma, booking, container, or customer..."
              }
              aria-label={isAr ? "البحث الشامل" : "Global search"}
              className="w-full bg-transparent text-sm text-ink placeholder:text-ink-muted focus:outline-none"
              data-testid="command-spotlight-input"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                aria-label={isAr ? "مسح البحث" : "Clear search"}
                className="rounded-full p-1 text-ink-muted transition hover:bg-card hover:text-ink"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-control border border-line bg-card px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted transition hover:text-ink"
            >
              Esc
            </button>
          </div>

          {/* Results Body */}
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {!trimmed ? (
              <div className="space-y-1">
                <p className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  {isAr ? "اختصارات سريعة" : "Quick Actions"}
                </p>
                {shortcuts.map((item) => {
                  runningIdx += 1;
                  const idx = runningIdx;
                  const isSelected = idx === activeIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => selectHit(item)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-control px-2.5 py-2 text-start text-sm transition",
                        isSelected ? "bg-accent/10 text-ink ring-1 ring-accent/30" : "text-ink hover:bg-paper",
                      )}
                      data-testid={`spotlight-item-${item.id}`}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-control border border-line bg-paper">
                          {iconFor(item)}
                        </span>
                        <span className="truncate font-medium">{item.title}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-muted">
                        <Ltr className="hidden sm:inline">{item.subtitle}</Ltr>
                        <DirArrow className="h-3.5 w-3.5" aria-hidden />
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : mergedGroups.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <FileStack className="mx-auto h-7 w-7 text-ink-muted/60" aria-hidden />
                <p className="mt-2 text-sm font-medium text-ink">
                  {serverQuery.isFetching || trimmed.length < 2
                    ? isAr
                      ? "جاري البحث..."
                      : "Searching..."
                    : isAr
                      ? "لا توجد سجلات مطابقة لهذا البحث."
                      : "No matching records found."}
                </p>
                {trimmed.length >= 1 ? (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChange(false);
                      void navigate(`/export-cases?q=${encodeURIComponent(trimmed)}`);
                    }}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-control border border-line bg-paper px-3 py-1.5 text-xs font-semibold text-accent transition hover:border-accent/40"
                  >
                    <FilePlus2 className="h-3.5 w-3.5" aria-hidden />
                    <span>
                      {isAr
                        ? `البحث في صفحة العمليات عن "${trimmed}"`
                        : `Search export operations for "${trimmed}"`}
                    </span>
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="space-y-3">
                {mergedGroups.map((group) => (
                  <div key={group.key} className="space-y-1">
                    <p className="px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                      {group.label}
                    </p>
                    {group.items.map((item) => {
                      runningIdx += 1;
                      const idx = runningIdx;
                      const isSelected = idx === activeIndex;
                      return (
                        <button
                          key={`${item.kind}-${item.id}`}
                          type="button"
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => selectHit(item)}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 rounded-control px-2.5 py-2 text-start text-sm transition",
                            isSelected ? "bg-accent/10 text-ink ring-1 ring-accent/30" : "text-ink hover:bg-paper",
                          )}
                          data-testid={`spotlight-hit-${item.kind}-${item.id}`}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-control border border-line bg-paper">
                              {iconFor(item)}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-ink">
                                <Ltr>{item.title}</Ltr>
                              </span>
                              {item.subtitle ? (
                                <span className="block truncate text-xs text-ink-muted">{item.subtitle}</span>
                              ) : null}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            {item.status ? <StatusBadge value={item.status} /> : null}
                            <DirArrow className="h-3.5 w-3.5 text-ink-muted" aria-hidden />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer Hints */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-paper/70 px-3.5 py-2 text-[11px] text-ink-muted">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <kbd className="rounded border border-line bg-card px-1.5 py-0.5 font-mono text-[10px] text-ink" dir="ltr">
                  ↑↓
                </kbd>
                <span>{isAr ? "للتنقل" : "Navigate"}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="inline-flex items-center rounded border border-line bg-card px-1.5 py-0.5 font-mono text-[10px] text-ink" dir="ltr">
                  <CornerDownLeft className="h-2.5 w-2.5" aria-hidden />
                </kbd>
                <span>{isAr ? "للفتح" : "Open"}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="rounded border border-line bg-card px-1.5 py-0.5 font-mono text-[10px] text-ink" dir="ltr">
                  Esc
                </kbd>
                <span>{isAr ? "للإغلاق" : "Close"}</span>
              </span>
            </div>
            <span className="font-medium text-accent">
              <Ltr>Ctrl+K</Ltr>
            </span>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
