import { Bell, Boxes, Building2, CalendarRange, ClipboardList, FileStack, LayoutDashboard, LogOut, Menu, Search, Settings2, Ship, Users, X } from "lucide-react";
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
            `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium ${
              isActive ? "bg-white text-ink" : "text-[#d5e2ec] hover:bg-white/10 hover:text-white"
            }`
          }
        >
          <item.icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{tx(item.key, item.english)}</span>
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
        <Link to="/dashboard" className="mb-6 block px-2">
          <span className="block text-lg font-semibold tracking-tight">ExportFlow</span>
          <span className="mt-1 block text-xs text-white/65">{tx("productMark", "Export operations")}</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1 overflow-auto" aria-label={tx("exportOperations", "Export operations")}>
          <NavItems />
        </nav>
      </aside>
      <header className="sticky top-0 z-20 border-b border-line bg-card/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            ref={menuButton}
            type="button"
            className="inline-flex h-8 items-center justify-center rounded-md border border-line bg-card px-2.5 text-ink lg:hidden"
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
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-ink-muted" />
              <Input
                name="q"
                aria-label={tx("search", "Search cases, invoices, customers")}
                placeholder={tx("search", "Search cases, invoices, customers")}
                className="h-9 rounded-full border-line bg-paper ps-9 text-ink"
              />
            </div>
          </form>
          <button type="button" className="rounded-full border border-line px-2.5 py-1.5 text-xs font-semibold" onClick={toggleLanguage}>
            {ar ? "EN" : "ع"}
          </button>
          <span className="hidden max-w-40 truncate text-sm font-medium md:inline">{user?.name}</span>
          <Button variant="outline" size="sm" className="border-line bg-card text-ink" onClick={() => void signOut()}>
            <LogOut className="h-4 w-4" />
            {tx("signOut", "Sign out")}
          </Button>
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
