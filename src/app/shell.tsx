import { Bell, Boxes, Building2, CalendarRange, ClipboardList, FileStack, Globe2, LayoutDashboard, LogOut, Menu, Moon, ReceiptText, Search, Settings2, Ship, Sun, Users, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from "react-router";
import { can, useSession } from "@/app/access";
import { applyDir } from "@/app/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useCompanyBrand } from "@/app/brand";
import { useCopy } from "@/lib/copy";
import { DASHBOARD_BELL_DELAY_MS, DASHBOARD_BRAND_DELAY_MS, dashboardFollowUp } from "@/lib/dashboard-follow-up";
import { revealTheme } from "@/app/theme-transition";
import { themeRevealOrigin } from "@/app/theme";
import { useThemeName } from "@/app/use-theme";
import { ConnectionSyncPill } from "@/components/layout/ConnectionSyncPill";

/** Milliseconds since `active` became true. Stays at 0 while inactive. */
function useElapsedSince(active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const started = performance.now();
    const mark = (delay: number) => window.setTimeout(() => setElapsed(performance.now() - started), delay);
    const brandTimer = mark(DASHBOARD_BRAND_DELAY_MS);
    const bellTimer = mark(DASHBOARD_BELL_DELAY_MS);
    return () => {
      window.clearTimeout(brandTimer);
      window.clearTimeout(bellTimer);
      setElapsed(0);
    };
  }, [active]);
  return active ? elapsed : 0;
}

const items = [
  { to: "/dashboard", key: "dashboard", english: "Dashboard", icon: LayoutDashboard, perm: "dashboard.view" },
  { to: "/export-cases", key: "exportOperations", english: "Export operations", icon: ClipboardList, perm: "export_cases.view_assigned" },
  { to: "/customers", key: "customers", english: "Customers", icon: Building2, perm: "customers.view" },
  { to: "/bookings", key: "bookings", english: "Bookings", icon: Ship, perm: "bookings.view" },
  { to: "/schedule", key: "schedule", english: "Shipping schedule", icon: CalendarRange, perm: "bookings.view" },
  { to: "/containers", key: "containers", english: "Containers", icon: Boxes, perm: "containers.view" },
  { to: "/quotations", key: "quotations", english: "Quotations", icon: ReceiptText, perm: "quotations.view" },
  { to: "/reminders", key: "reminders", english: "Reminders", icon: Bell, perm: "reminders.view" },
  { to: "/reports", key: "reports", english: "Reports", icon: FileStack, perm: "reports.view" },
  { to: "/users", key: "users", english: "Users", icon: Users, perm: "users.manage" },
  { to: "/settings", key: "settings", english: "Settings", icon: Settings2, perm: "settings.manage" },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const user = useSession();
  const { tx } = useCopy();
  const visible = items.filter(
    (item) => can(user, item.perm) || (item.perm === "export_cases.view_assigned" && can(user, "export_cases.view_all")),
  );
  return (
    <>
      {visible.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-control px-3 py-2 text-sm font-medium transition duration-[180ms] ease-out ${
              isActive ? "bg-card text-ink shadow-card" : "text-on-navy hover:bg-white/10 hover:text-white"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <item.icon className={`h-4 w-4 shrink-0 ${isActive ? "text-accent" : "text-white/65"}`} />
              <span className="truncate">{tx(item.key, item.english)}</span>
            </>
          )}
        </NavLink>
      ))}
    </>
  );
}

export function AppShell() {
  const { tx, i18n } = useCopy();
  const user = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const headerQuery = params.get("q") ?? "";
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const ar = i18n.language.startsWith("ar");
  const initials = (user?.name ?? "").trim().charAt(0).toUpperCase();
  const elapsed = useElapsedSince(true);
  const followUp = dashboardFollowUp(true, elapsed);
  const brand = useCompanyBrand(followUp.brand);
  const productName = brand?.name || "ExportFlow";
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await api<Array<Record<string, string | number>>>("/api/v1/notifications")).data,
    enabled: can(user, "reminders.view") && followUp.notifications,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 60_000,
  });
  const unread = (notifications.data ?? []).filter((row) => Number(row.is_read) === 0).length;
  const theme = useThemeName();
  const dark = theme === "dark";
  const themeLabel = dark ? tx("switchToLight", "Switch to light mode") : tx("switchToDark", "Switch to dark mode");

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function onTheme(event: MouseEvent<HTMLButtonElement>) {
    const origin = themeRevealOrigin(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    revealTheme(origin.x, origin.y);
  }

  function toggleLanguage() {
    const next = ar ? "en" : "ar";
    void i18n.changeLanguage(next);
    applyDir(next);
  }

  async function signOut() {
    const response = await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (response.ok) window.location.href = "/login";
  }

  return (
    <div className="min-h-screen bg-paper lg:ps-64">
      <aside className="fixed inset-y-0 start-0 z-20 hidden w-64 flex-col bg-accent-2 px-4 py-5 text-white lg:flex">
        <Link to="/dashboard" className="mb-6 flex items-center gap-2.5 px-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-white/10 text-accent ring-1 ring-accent/40">
            <Ship className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-lg font-semibold leading-tight tracking-tight">{productName}</span>
            <span className="mt-0.5 block truncate text-[11px] text-white/60">{tx("productMark", "Export operations")}</span>
          </span>
        </Link>
        <nav className="scroll-navy flex flex-1 flex-col gap-1 overflow-auto" aria-label={tx("exportOperations", "Export operations")}>
          <NavItems />
        </nav>
        <div className="mt-4 rounded-card border border-white/10 bg-white/5 p-3">
          <div className="flex items-center gap-2 text-on-navy">
            <FileStack className="h-4 w-4" />
            <span className="text-xs font-semibold">{productName}</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-white/60">
            {tx("sidebarHint", "Every document, stage and reminder stays with the case file.")}
          </p>
        </div>
      </aside>
      <header className="sticky top-0 z-20 border-b border-line/80 bg-card/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2.5 px-4 py-3 md:px-6">
          <Button
            ref={menuButton}
            type="button"
            variant="outline"
            size="icon"
            className="lg:hidden"
            onClick={() => setOpen(true)}
            aria-label={tx("openMenu", "Open menu")}
            aria-expanded={open}
          >
            <Menu className="h-4 w-4" />
          </Button>
          <Link to="/dashboard" className="shrink-0 lg:hidden">
            <span className="block text-sm font-semibold tracking-tight">{productName}</span>
          </Link>
          <form
            className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              const q = String(new FormData(event.currentTarget).get("q") ?? "").trim();
              navigate(q ? `/export-cases?q=${encodeURIComponent(q)}` : "/export-cases");
            }}
          >
            <div className="relative mx-auto max-w-xl">
              <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-ink-muted" />
              <Input
                key={headerQuery}
                name="q"
                defaultValue={headerQuery}
                aria-label={tx("search", "Search by case, invoice, booking, container, or customer")}
                placeholder={tx("search", "Search by case, invoice, booking, container, or customer")}
                className="border-line bg-paper ps-9 text-ink"
              />
            </div>
          </form>
          <div className="ms-auto flex shrink-0 items-center gap-2">
            <ConnectionSyncPill />
            <Link
              to="/notifications"
              aria-label={tx("notifications", "Notifications")}
              className="relative grid h-9 w-9 place-items-center rounded-full border border-line bg-card text-ink-muted transition hover:border-accent/40 hover:text-accent"
            >
              <Bell className="h-4 w-4" />
              {unread > 0 ? (
                <span className="absolute -end-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger-fill px-1 text-[10px] font-bold text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : null}
            </Link>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="rounded-full"
              onClick={onTheme}
              aria-label={themeLabel}
              title={themeLabel}
            >
              {dark ? <Moon key="dark" className="ef-theme-icon h-4 w-4" /> : <Sun key="light" className="ef-theme-icon h-4 w-4" />}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={toggleLanguage}
              aria-label={ar ? "Switch to English" : "التبديل إلى العربية"}
            >
              <Globe2 className="h-3.5 w-3.5 text-ink-muted" />
              {ar ? "EN" : "ع"}
            </Button>
            <Link to="/profile" className="hidden items-center gap-2 rounded-full border border-line bg-paper/60 py-1 pe-3 ps-1 transition hover:border-accent/40 md:flex" aria-label={tx("profile", "Profile")}>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-fill text-[11px] font-semibold text-white">
                {initials || "?"}
              </span>
              <span className="max-w-32 truncate text-sm font-medium" dir="auto">{user?.name}</span>
            </Link>
            {/* Below 640px the search takes its own full-width row, so the
                first row keeps the menu, brand, alerts, theme and language switch.
                Signing out moves into the menu instead of being clipped. */}
            <Button
              variant="outline"
              size="sm"
              className="hidden rounded-full border-line bg-card text-ink sm:inline-flex"
              onClick={() => void signOut()}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{tx("signOut", "Sign out")}</span>
            </Button>
          </div>
        </div>
      </header>
      {open ? (
        <div className="fixed inset-0 z-30 lg:hidden">
          <button className="absolute inset-0 bg-ink/40" aria-label={tx("closeMenu", "Close menu")} onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 start-0 flex w-[min(100%,280px)] flex-col bg-accent-2 p-4 text-white shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-semibold">{productName}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/10 hover:text-white"
                aria-label={tx("closeMenu", "Close menu")}
                onClick={() => { setOpen(false); menuButton.current?.focus(); }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <Link to="/profile" onClick={() => setOpen(false)} className="mb-3 block rounded-xl px-2 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white">
              {user?.name}
            </Link>
            <nav className="scroll-navy flex flex-col gap-1 overflow-auto" aria-label={tx("exportOperations", "Export operations")}>
              <NavItems onNavigate={() => setOpen(false)} />
            </nav>
            <div className="mt-4 border-t border-white/10 pt-3">
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start text-on-navy hover:bg-white/10 hover:text-white"
                onClick={() => void signOut()}
              >
                <LogOut className="h-4 w-4 shrink-0 text-white/65" />
                {tx("signOut", "Sign out")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <main className="mx-auto min-w-0 max-w-[1400px] p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
