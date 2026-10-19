import { Bell, Boxes, Building2, CalendarRange, ClipboardList, FileStack, Globe2, LayoutDashboard, LogOut, Menu, Search, Settings2, Ship, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { can, useSession } from "@/app/access";
import { applyDir } from "@/app/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopy } from "@/lib/copy";

const items = [
  { to: "/dashboard", key: "dashboard", english: "Dashboard", icon: LayoutDashboard, perm: "dashboard.view" },
  { to: "/export-cases", key: "exportOperations", english: "Export operations", icon: ClipboardList, perm: "export_cases.view_assigned" },
  { to: "/customers", key: "customers", english: "Customers", icon: Building2, perm: "customers.view" },
  { to: "/bookings", key: "bookings", english: "Bookings", icon: Ship, perm: "bookings.view" },
  { to: "/schedule", key: "schedule", english: "Shipping schedule", icon: CalendarRange, perm: "bookings.view" },
  { to: "/containers", key: "containers", english: "Containers", icon: Boxes, perm: "containers.view" },
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
            `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
              isActive ? "bg-white text-ink shadow-[0_1px_0_rgb(255_255_255/0.4),0_8px_20px_rgb(0_0_0/0.18)]" : "text-[#d5e2ec] hover:bg-white/10 hover:text-white"
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
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const ar = i18n.language.startsWith("ar");
  const initials = (user?.name ?? "").trim().charAt(0).toUpperCase();

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
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 text-[#5eead4] ring-1 ring-white/10">
            <Ship className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-lg font-semibold leading-tight tracking-tight">ExportFlow</span>
            <span className="mt-0.5 block truncate text-[11px] text-white/60">{tx("productMark", "Export operations")}</span>
          </span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1 overflow-auto" aria-label={tx("exportOperations", "Export operations")}>
          <NavItems />
        </nav>
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
          <div className="flex items-center gap-2 text-[#5eead4]">
            <FileStack className="h-4 w-4" />
            <span className="text-xs font-semibold">ExportFlow</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-white/60">
            {tx("sidebarHint", "Every document, stage and reminder stays with the case file.")}
          </p>
        </div>
      </aside>
      <header className="sticky top-0 z-20 border-b border-line/80 bg-card/95 backdrop-blur">
        <div className="flex items-center gap-2.5 px-4 py-3 md:px-6">
          <button
            ref={menuButton}
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-line bg-card px-2.5 text-ink lg:hidden"
            onClick={() => setOpen(true)}
            aria-label={tx("openMenu", "Open menu")}
            aria-expanded={open}
          >
            <Menu className="h-4 w-4" />
          </button>
          <Link to="/dashboard" className="shrink-0 lg:hidden">
            <span className="block text-sm font-semibold tracking-tight">ExportFlow</span>
          </Link>
          <form
            className="min-w-0 flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              const q = new FormData(event.currentTarget).get("q");
              navigate(`/export-cases?q=${encodeURIComponent(String(q ?? ""))}`);
            }}
          >
            <div className="relative mx-auto max-w-xl">
              <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-ink-muted" />
              <Input
                name="q"
                aria-label={tx("search", "Search cases, invoices, customers")}
                placeholder={tx("search", "Search cases, invoices, customers")}
                className="h-9 rounded-full border-line bg-paper ps-9 text-ink"
              />
            </div>
          </form>
          <div className="ms-auto flex shrink-0 items-center gap-2">
            <Link
              to="/notifications"
              aria-label={tx("notifications", "Notifications")}
              className="grid h-9 w-9 place-items-center rounded-full border border-line bg-card text-ink-muted transition hover:border-accent/40 hover:text-accent"
            >
              <Bell className="h-4 w-4" />
            </Link>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-card px-3 text-xs font-semibold text-ink"
              onClick={toggleLanguage}
              aria-label={ar ? "Switch to English" : "التبديل إلى العربية"}
            >
              <Globe2 className="h-3.5 w-3.5 text-ink-muted" />
              {ar ? "EN" : "ع"}
            </button>
            <div className="hidden items-center gap-2 rounded-full border border-line bg-paper/60 py-1 pe-3 ps-1 md:flex">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold text-white">
                {initials || "?"}
              </span>
              <span className="max-w-32 truncate text-sm font-medium" dir="auto">{user?.name}</span>
            </div>
            <Button variant="outline" size="sm" className="rounded-full border-line bg-card text-ink" onClick={() => void signOut()}>
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
              <span className="font-semibold">ExportFlow</span>
              <button className="rounded-md p-1 text-white" aria-label={tx("closeMenu", "Close menu")} onClick={() => { setOpen(false); menuButton.current?.focus(); }}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 px-2 text-xs text-white/70">{user?.name}</p>
            <nav className="flex flex-col gap-1 overflow-auto">
              <NavItems onNavigate={() => setOpen(false)} />
            </nav>
          </div>
        </div>
      ) : null}
      <main className="mx-auto min-w-0 max-w-[1400px] p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
