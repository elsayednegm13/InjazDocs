import {
  PERMISSIONS,
  PERMISSION_CATALOG,
  PERMISSION_GROUPS,
  resolveEffectivePermissions,
  type OverrideEffect,
  type PermissionKey,
} from "@shared/permissions";
import { Dialog, DialogContent, DialogOverlay, DialogPortal, DialogTitle } from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  Check,
  FileText,
  History,
  Image,
  Lock,
  RotateCcw,
  Search,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
  UserPlus,
  UserX,
  Users as UsersIcon,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, Ltr, PageHeader, SectionCard, StatCard } from "@/components/ui/chrome";
import { SkeletonCardList, SkeletonRegion, SkeletonRows, SkeletonText } from "@/components/ui/skeleton";
import { Field, Input, Select } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatWhen, useCopy } from "@/lib/copy";
import { isDefinitiveFailure, useIdempotencyKey, useSubmitLock } from "@/lib/idempotency";
import { notifyError, notifySuccess } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { WhatsAppTemplateCard } from "@/features/admin/WhatsAppTemplateCard";
import { TradeSettings } from "@/features/trade/TradeSettings";
import { applyTheme } from "@/app/theme";
import { useThemeName } from "@/app/use-theme";

type UserOverrideRow = {
  permissionKey: PermissionKey;
  effect: OverrideEffect;
};

type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  is_active: number | string;
  must_change_password?: number | string;
  created_at?: number | string;
  roles?: string | null;
  roleKeys?: string[];
  rolePermissions?: PermissionKey[];
  overrides?: UserOverrideRow[];
  effectivePermissions?: PermissionKey[];
  effectivePermissionsCount?: number;
};

type AdminRoleRow = {
  id: string;
  key: string;
  name_en: string;
  name_ar: string;
  permissions: string[];
};

type CustomizerFilter = "all" | "overridden" | "granted" | "denied";

export function UsersPage() {
  const { tx, ar, i18n } = useCopy();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api<AdminUserRow[]>("/api/v1/users")).data,
  });
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await api<AdminRoleRow[]>("/api/v1/roles")).data,
  });

  const [workspaceTab, setWorkspaceTab] = useState<"team" | "roles">("team");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [provisionOpen, setProvisionOpen] = useState(false);

  const userKey = useIdempotencyKey();
  const userLock = useSubmitLock();

  const rows = query.data ?? [];
  const roleRows = roles.data ?? [];
  const activeCount = rows.filter((user) => user.is_active === "1" || Number(user.is_active) === 1).length;
  const totalOverridesCount = rows.reduce((sum, u) => sum + (u.overrides?.length ?? 0), 0);

  const selectedUser = useMemo(
    () => rows.find((u) => u.id === selectedUserId) ?? null,
    [rows, selectedUserId],
  );

  async function toggleUserActive(user: AdminUserRow) {
    const currentlyActive = user.is_active === "1" || Number(user.is_active) === 1;
    try {
      await api(`/api/v1/users/${user.id}/active`, {
        method: "POST",
        body: JSON.stringify({ active: !currentlyActive }),
      });
      notifySuccess(
        !currentlyActive
          ? tx("userEnabled", "تم تفعيل حساب المستخدم")
          : tx("userDisabled", "تم إيقاف حساب المستخدم"),
        user.email,
      );
      await client.invalidateQueries({ queryKey: ["users"] });
    } catch (error) {
      notifyError(error);
    }
  }

  return (
    <div className="space-y-4" data-users={query.isLoading ? "loading" : "ready"}>
      <PageHeader
        title={tx("users", "إدارة المستخدمين ومصفوفة الصلاحيات المرنة")}
        subtitle={tx(
          "usersHint",
          "تخصيص الأدوار والصلاحيات الفردية لكل مستخدم (منح إضافي +Grant أو حجب خاص -Deny) مع توثيق فوري في سجل المراجعة.",
        )}
        actions={
          <Button type="button" onClick={() => setProvisionOpen((v) => !v)}>
            <UserPlus className="h-4 w-4" />
            <span>{tx("provisionUser", "إضافة مستخدم جديد")}</span>
          </Button>
        }
      />

      {/* Executive KPI Strip */}
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label={tx("users", "إجمالي المستخدمين")} value={rows.length} icon={<UsersIcon className="h-5 w-5" />} tone="blue" />
        <StatCard label={tx("active", "الحسابات النشطة")} value={activeCount} icon={<UserCheck className="h-5 w-5" />} tone="green" />
        <StatCard label={tx("roles", "قوالب الأدوار")} value={roleRows.length} icon={<ShieldCheck className="h-5 w-5" />} tone="teal" />
        <StatCard
          label={tx("customOverridesCount", "الاستثناءات الفردية النشطة")}
          value={totalOverridesCount}
          icon={<Sparkles className="h-5 w-5" />}
          tone="amber"
        />
      </div>

      {/* Collapsible Provision New User Card */}
      {provisionOpen ? (
        <SectionCard
          title={tx("provisionUser", "إنشاء حساب مستخدم جديد")}
          icon={<UserPlus className="h-4 w-4" />}
          action={
            <Button type="button" size="sm" variant="outline" onClick={() => setProvisionOpen(false)}>
              {tx("close", "إغلاق")}
            </Button>
          }
        >
          <form
            className="grid gap-3 md:grid-cols-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!userLock.acquire()) return;
              const form = new FormData(event.currentTarget);
              try {
                await api("/api/v1/users", {
                  method: "POST",
                  idempotencyKey: userKey.key.current,
                  body: JSON.stringify({
                    name: form.get("name"),
                    email: form.get("email"),
                    password: form.get("password"),
                    roleKeys: [form.get("role")],
                  }),
                });
                userKey.reset();
                notifySuccess(tx("userProvisioned", "تم إنشاء حساب المستخدم بنجاح"), String(form.get("email")));
                setProvisionOpen(false);
                await client.invalidateQueries({ queryKey: ["users"] });
              } catch (error) {
                if (isDefinitiveFailure(error)) userKey.reset();
                notifyError(error);
              } finally {
                userLock.release();
              }
            }}
          >
            <Field label={tx("name", "الاسم الكامل")}>
              <Input name="name" required placeholder="أحمد محمد" />
            </Field>
            <Field label={tx("email", "البريد الإلكتروني")}>
              <Input name="email" type="email" required dir="ltr" placeholder="officer@company.com" />
            </Field>
            <Field label={tx("initialPassword", "كلمة المرور المؤقتة (12+ حرفاً)")}>
              <Input name="password" type="password" minLength={12} required dir="ltr" />
            </Field>
            <Field label={tx("role", "الدور الأساسي")}>
              <Select name="role" defaultValue="export_officer">
                {(roleRows.length
                  ? roleRows
                  : [{ key: "export_officer", name_en: "Export officer", name_ar: "موظف تصدير", id: "role-officer", permissions: [] }]
                ).map((role) => (
                  <option key={role.key} value={role.key}>
                    {ar && role.name_ar ? role.name_ar : role.name_en}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex justify-end gap-2 md:col-span-4">
              <Button type="button" variant="outline" onClick={() => setProvisionOpen(false)}>
                {tx("cancel", "إلغاء")}
              </Button>
              <Button type="submit" disabled={userLock.busy}>
                <UserPlus className="h-4 w-4" />
                <span>{tx("provisionUser", "إنشاء الحساب")}</span>
              </Button>
            </div>
          </form>
        </SectionCard>
      ) : null}

      {/* Main 2-Tab Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={tx("permissionsWorkspaceTabs", "تبويبات إدارة المستخدمين والصلاحيات")}>
          <Button
            type="button"
            size="sm"
            role="tab"
            aria-selected={workspaceTab === "team"}
            variant={workspaceTab === "team" ? "default" : "outline"}
            onClick={() => setWorkspaceTab("team")}
          >
            <UsersIcon className="h-4 w-4" />
            <span>1. {tx("tabTeamOverrides", "فريق العمل وتخصيص الصلاحيات الفردية")}</span>
          </Button>
          <Button
            type="button"
            size="sm"
            role="tab"
            aria-selected={workspaceTab === "roles"}
            variant={workspaceTab === "roles" ? "default" : "outline"}
            onClick={() => setWorkspaceTab("roles")}
          >
            <ShieldCheck className="h-4 w-4" />
            <span>2. {tx("tabRoleTemplates", "قوالب الأدوار والصلاحيات العامة")}</span>
          </Button>
        </div>
        <span className="text-xs text-ink-muted">
          {tx("totalSystemPermissionsBadge", `إجمالي صلاحيات النظام: ${PERMISSIONS.length} صلاحية موزعة على ${PERMISSION_GROUPS.length} مجموعة`)}
        </span>
      </div>

      {/* TAB 1: TEAM & PER-USER OVERRIDES */}
      {workspaceTab === "team" ? (
        <SectionCard
          title={tx("team", "أعضاء الفريق والصلاحيات الفعلية")}
          icon={<UsersIcon className="h-4 w-4" />}
          action={
            <span className="text-xs text-ink-muted">
              <Ltr>{rows.length}</Ltr>
            </span>
          }
        >
          {query.isLoading ? (
            <SkeletonRegion label="Loading team">
              <SkeletonRows rows={4} />
            </SkeletonRegion>
          ) : rows.length === 0 ? (
            <EmptyState>{tx("noUsers", "لا يوجد مستخدمون بعد.")}</EmptyState>
          ) : (
            <ul className="grid gap-3">
              {rows.map((user) => {
                const isActive = user.is_active === "1" || Number(user.is_active) === 1;
                const roleList =
                  user.roleKeys && user.roleKeys.length > 0
                    ? user.roleKeys
                    : String(user.roles || "")
                        .split(/[,·|]/)
                        .map((r) => r.trim())
                        .filter(Boolean);
                const overrides = user.overrides ?? [];
                const grantsCount = overrides.filter((o) => o.effect === "GRANT").length;
                const deniesCount = overrides.filter((o) => o.effect === "DENY").length;
                const effectiveCount =
                  typeof user.effectivePermissionsCount === "number"
                    ? user.effectivePermissionsCount
                    : (user.effectivePermissions?.length ?? 0);

                return (
                  <li
                    key={user.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card p-3.5 shadow-2xs transition-colors hover:border-accent/40"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-2 text-xs font-bold text-white">
                        {initialsOf(user.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-semibold text-ink">{user.name}</span>
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                              isActive ? "bg-ok/15 text-ok" : "bg-danger/15 text-danger",
                            )}
                          >
                            {isActive ? tx("active", "نشط") : tx("disabled", "موقوف")}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                          <Ltr>{user.email}</Ltr>
                          {user.created_at ? (
                            <>
                              <span>·</span>
                              <Ltr>{formatWhen(String(user.created_at), i18n.language)}</Ltr>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {/* Roles & Override Summary Badges */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {roleList.map((roleKey) => {
                        const roleObj = roleRows.find((r) => r.key === roleKey);
                        const label = roleObj ? (ar && roleObj.name_ar ? roleObj.name_ar : roleObj.name_en) : tx(`role.${roleKey}`, roleKey);
                        return (
                          <span
                            key={roleKey}
                            className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent"
                          >
                            <Shield className="h-3 w-3" />
                            <span>{label}</span>
                          </span>
                        );
                      })}

                      {grantsCount > 0 ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-300">
                          +{grantsCount} {tx("grantOverrideBadge", "منح خاص")}
                        </span>
                      ) : null}

                      {deniesCount > 0 ? (
                        <span className="inline-flex items-center rounded-full border border-rose-300 bg-rose-100 px-2.5 py-0.5 text-[11px] font-bold text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/20 dark:text-rose-300">
                          -{deniesCount} {tx("denyOverrideBadge", "حجب خاص")}
                        </span>
                      ) : null}

                      <span
                        className="rounded-lg border border-line bg-paper px-2.5 py-1 text-xs font-semibold tabular-nums text-ink"
                        title={tx("effectivePermissionsCountHint", "إجمالي الصلاحيات الفعلية النشطة لهذا المستخدم")}
                      >
                        <Ltr>
                          {effectiveCount} / {PERMISSIONS.length}
                        </Ltr>{" "}
                        {tx("activePermsUnit", "صلاحية")}
                      </span>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setSelectedUserId(user.id)}
                        data-testid={`customize-user-${user.id}`}
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        <span>{tx("customizeUserPermissions", "تخصيص الصلاحيات والدور")}</span>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void toggleUserActive(user)}
                        title={isActive ? tx("disableUserAccount", "إيقاف الحساب") : tx("enableUserAccount", "تفعيل الحساب")}
                      >
                        {isActive ? <UserX className="h-3.5 w-3.5 text-danger" /> : <UserCheck className="h-3.5 w-3.5 text-ok" />}
                        <span>{isActive ? tx("disableShort", "إيقاف") : tx("enableShort", "تفعيل")}</span>
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      ) : null}

      {/* TAB 2: ROLE TEMPLATES MATRIX */}
      {workspaceTab === "roles" ? (
        <RoleTemplatesWorkspace roles={roleRows} />
      ) : null}

      {/* User Permission Customizer Modal / Drawer */}
      <UserPermissionCustomizerModal
        user={selectedUser}
        roles={roleRows}
        onClose={() => setSelectedUserId(null)}
        onToggleActive={toggleUserActive}
      />
    </div>
  );
}

function PermissionSwitch({
  checked,
  disabled,
  tone = "default",
  onToggle,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  tone?: "default" | "grant" | "deny";
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      dir="ltr"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? tone === "grant"
            ? "bg-emerald-600 dark:bg-emerald-500"
            : "bg-accent"
          : tone === "deny"
            ? "bg-rose-200 ring-1 ring-rose-400/60 dark:bg-rose-950/80 dark:ring-rose-500/50"
            : "bg-slate-300 dark:bg-slate-700",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-xs transition-transform duration-150",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function UserPermissionCustomizerModal({
  user,
  roles,
  onClose,
  onToggleActive,
}: {
  user: AdminUserRow | null;
  roles: AdminRoleRow[];
  onClose: () => void;
  onToggleActive: (user: AdminUserRow) => Promise<void>;
}) {
  const { tx, ar } = useCopy();
  const client = useQueryClient();
  const [selectedRoleKey, setSelectedRoleKey] = useState<string>("export_officer");
  const [overrideMap, setOverrideMap] = useState<Record<string, OverrideEffect>>({});
  const [activeGroupKey, setActiveGroupKey] = useState<string>(PERMISSION_GROUPS[0]?.key ?? "ALL");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CustomizerFilter>("all");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    const currentRole =
      user.roleKeys?.[0] ||
      String(user.roles || "")
        .split(/[,·|]/)
        .map((r) => r.trim())
        .filter(Boolean)[0] ||
      "export_officer";
    setSelectedRoleKey(currentRole);
    const nextMap: Record<string, OverrideEffect> = {};
    for (const item of user.overrides ?? []) {
      nextMap[item.permissionKey] = item.effect;
    }
    setOverrideMap(nextMap);
    setActiveGroupKey(PERMISSION_GROUPS[0]?.key ?? "ALL");
    setSearch("");
    setFilter("all");
  }, [user]);

  const roleObj = useMemo(
    () => roles.find((r) => r.key === selectedRoleKey) ?? null,
    [roles, selectedRoleKey],
  );

  const roleGrantSet = useMemo(
    () => new Set<string>(roleObj?.permissions ?? user?.rolePermissions ?? []),
    [roleObj, user?.rolePermissions],
  );

  const overrideList = useMemo(
    () =>
      Object.entries(overrideMap).map(([permissionKey, effect]) => ({
        permissionKey: permissionKey as PermissionKey,
        effect,
      })),
    [overrideMap],
  );

  const effectiveSet = useMemo(
    () =>
      resolveEffectivePermissions({
        roleGrants: roleGrantSet,
        overrides: overrideList,
      }),
    [roleGrantSet, overrideList],
  );

  const grantsCount = overrideList.filter((o) => o.effect === "GRANT").length;
  const deniesCount = overrideList.filter((o) => o.effect === "DENY").length;
  const isActive = user ? user.is_active === "1" || Number(user.is_active) === 1 : false;

  function setPermissionState(key: PermissionKey, state: "INHERIT" | "GRANT" | "DENY") {
    setOverrideMap((current) => {
      const next = { ...current };
      if (state === "INHERIT") {
        delete next[key];
      } else {
        next[key] = state;
      }
      return next;
    });
  }

  function toggleSmartPermission(key: PermissionKey) {
    const isCurrentlyEffective = effectiveSet.has(key);
    const inheritedFromRole = roleGrantSet.has(key);
    if (!isCurrentlyEffective) {
      // Turning ON: if already in role, return to INHERIT; otherwise GRANT
      setPermissionState(key, inheritedFromRole ? "INHERIT" : "GRANT");
    } else {
      // Turning OFF: if not in role, return to INHERIT; otherwise DENY
      setPermissionState(key, inheritedFromRole ? "DENY" : "INHERIT");
    }
  }

  function applyBulkGroupState(keys: PermissionKey[], mode: "ENABLE_ALL" | "DISABLE_ALL" | "RESET_ROLE") {
    setOverrideMap((current) => {
      const next = { ...current };
      for (const k of keys) {
        const inRole = roleGrantSet.has(k);
        if (mode === "RESET_ROLE") {
          delete next[k];
        } else if (mode === "ENABLE_ALL") {
          if (inRole) delete next[k];
          else next[k] = "GRANT";
        } else {
          if (inRole) next[k] = "DENY";
          else delete next[k];
        }
      }
      return next;
    });
  }

  async function saveChanges() {
    if (!user) return;
    setBusy(true);
    try {
      await api(`/api/v1/users/${user.id}/roles`, {
        method: "PUT",
        body: JSON.stringify({ roleKeys: [selectedRoleKey] }),
      });
      await api(`/api/v1/users/${user.id}/overrides`, {
        method: "POST",
        body: JSON.stringify({ overrides: overrideList }),
      });
      notifySuccess(
        tx("userPermissionsSaved", "تم حفظ الدور والاستثناءات الفردية للمستخدم بنجاح"),
        user.email,
      );
      await client.invalidateQueries({ queryKey: ["users"] });
      await client.invalidateQueries({ queryKey: ["me"] });
      onClose();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  const normalizedQuery = search.trim().toLowerCase();
  const isGlobalView = activeGroupKey === "ALL" || normalizedQuery.length > 0 || filter === "overridden";
  const selectedGroupObj = PERMISSION_GROUPS.find((g) => g.key === activeGroupKey) ?? PERMISSION_GROUPS[0];

  const scopedPermissions = useMemo(() => {
    const base = isGlobalView
      ? [...PERMISSIONS]
      : PERMISSIONS.filter((k) => PERMISSION_CATALOG[k]?.groupKey === activeGroupKey);
    return base.filter((key) => {
      const meta = PERMISSION_CATALOG[key];
      const override = overrideMap[key] as OverrideEffect | undefined;
      const isEffective = effectiveSet.has(key);
      if (filter === "overridden" && !override) return false;
      if (filter === "granted" && !isEffective) return false;
      if (filter === "denied" && isEffective) return false;
      if (!normalizedQuery) return true;
      const haystack = `${key} ${meta.labelAr} ${meta.labelEn} ${meta.descriptionAr} ${meta.descriptionEn}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [isGlobalView, activeGroupKey, overrideMap, effectiveSet, filter, normalizedQuery]);

  const rawSectionPerms = useMemo(
    () =>
      isGlobalView
        ? [...PERMISSIONS]
        : PERMISSIONS.filter((k) => PERMISSION_CATALOG[k]?.groupKey === activeGroupKey),
    [isGlobalView, activeGroupKey],
  );

  const sectionActiveCount = rawSectionPerms.filter((k) => effectiveSet.has(k)).length;
  const sectionOverridesCount = rawSectionPerms.filter((k) => Boolean(overrideMap[k])).length;

  return (
    <Dialog open={Boolean(user)} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-40 bg-ink/50 backdrop-blur-[1px]" />
        <DialogContent className="fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[min(100%-1.5rem,72rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-line bg-card text-start shadow-card focus:outline-none">
          {user ? (
            <>
              {/* Modal Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paper/70 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-2 text-xs font-bold text-white">
                    {initialsOf(user.name)}
                  </span>
                  <div>
                    <DialogTitle className="text-sm font-bold text-ink">
                      {tx("customizeUserTitle", "تخصيص الصلاحيات الفردية والدور")} — {user.name}
                    </DialogTitle>
                    <p className="text-xs text-ink-muted">
                      <Ltr>{user.email}</Ltr>
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void onToggleActive(user)}
                  >
                    {isActive ? <UserX className="h-3.5 w-3.5 text-danger" /> : <UserCheck className="h-3.5 w-3.5 text-ok" />}
                    <span>{isActive ? tx("disableUserAccount", "إيقاف الحساب") : tx("enableUserAccount", "تفعيل الحساب")}</span>
                  </Button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-card text-ink-muted hover:text-ink"
                    aria-label={tx("close", "إغلاق")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Compact Control Strip (Role + Summary Badges + Search + Quick Filters) */}
              <div className="border-b border-line bg-slate-50/90 px-5 py-3 dark:bg-slate-900/50">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {/* Base Role + Live Summary Pills */}
                  <div className="flex flex-wrap items-center gap-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-ink-muted">
                        {tx("baseRoleShort", "الدور الأساسي:")}
                      </span>
                      <Select
                        value={selectedRoleKey}
                        disabled={busy}
                        className="h-8 min-w-[12rem] bg-card text-xs font-semibold"
                        onChange={(e) => setSelectedRoleKey(e.target.value)}
                      >
                        {roles.map((r) => (
                          <option key={r.key} value={r.key}>
                            {ar && r.name_ar ? r.name_ar : r.name_en} ({r.permissions.length})
                          </option>
                        ))}
                      </Select>
                    </div>

                    <span className="rounded-full border border-accent/30 bg-accent/15 px-2.5 py-1 text-xs font-bold tabular-nums text-accent">
                      {effectiveSet.size} / {PERMISSIONS.length} {tx("activePermsBadge", "مفعلة")}
                    </span>

                    {grantsCount > 0 ? (
                      <span className="rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-300">
                        +{grantsCount} {tx("addedGrantsShort", "مضافة")}
                      </span>
                    ) : null}

                    {deniesCount > 0 ? (
                      <span className="rounded-full border border-rose-300 bg-rose-100 px-2.5 py-0.5 text-[11px] font-bold text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/20 dark:text-rose-300">
                        −{deniesCount} {tx("revokedDeniesShort", "محجوبة")}
                      </span>
                    ) : null}

                    {overrideList.length > 0 ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setOverrideMap({})}
                        className="inline-flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1 text-xs font-semibold text-ink-muted transition-colors hover:border-accent/40 hover:text-ink"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>{tx("restoreRoleDefaultsBtn", "استعادة افتراضي الدور")}</span>
                      </button>
                    ) : null}
                  </div>

                  {/* Search + Quick Filters */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-56 sm:w-64">
                      <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={tx("searchPermissionsShort", "بحث في الصلاحيات...")}
                        className="h-8 bg-card ps-8 text-xs"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={tx("filterPermissionsGroup", "فلترة الصلاحيات")}>
                      {(
                        [
                          ["all", `الكل`],
                          ["overridden", `المعدّلة (${overrideList.length})`],
                          ["granted", `المفعّلة (${effectiveSet.size})`],
                          ["denied", `المحجوبة (${PERMISSIONS.length - effectiveSet.size})`],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setFilter(id)}
                          className={cn(
                            "rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors",
                            filter === id
                              ? "border-accent bg-accent text-white"
                              : "border-line bg-card text-ink-muted hover:border-accent/40 hover:text-ink",
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* 2-Column Master-Detail Permissions Body */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[260px_1fr]">
                  {/* Right Column (RTL): Category Navigation Sidebar */}
                  <div className="rounded-xl border border-line bg-card p-1.5 shadow-2xs">
                    <div className="px-2.5 py-1.5 text-[11px] font-bold text-ink-muted">
                      {tx("permissionCategoriesHeading", "الأقسام الوظيفية (12)")}
                    </div>
                    <div className="space-y-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveGroupKey("ALL");
                          setSearch("");
                        }}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-start text-xs font-semibold transition-colors",
                          activeGroupKey === "ALL" && !normalizedQuery
                            ? "bg-accent text-white shadow-2xs"
                            : "text-ink hover:bg-paper/80",
                        )}
                      >
                        <span className="truncate">{tx("allPermissionCategories", "جميع الأقسام (59)")}</span>
                        <span className="flex items-center gap-1.5">
                          {overrideList.length > 0 ? (
                            <span
                              className={cn(
                                "h-2 w-2 rounded-full",
                                activeGroupKey === "ALL" && !normalizedQuery ? "bg-white" : "bg-amber-500",
                              )}
                              title={tx("hasManualOverridesDot", "يحتوي على استثناءات يدوية")}
                            />
                          ) : null}
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
                              activeGroupKey === "ALL" && !normalizedQuery
                                ? "bg-white/20 text-white"
                                : effectiveSet.size === PERMISSIONS.length
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
                                  : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
                            )}
                          >
                            {effectiveSet.size}/{PERMISSIONS.length}
                          </span>
                        </span>
                      </button>

                      {PERMISSION_GROUPS.map((group) => {
                        const groupPerms = PERMISSIONS.filter((k) => PERMISSION_CATALOG[k]?.groupKey === group.key);
                        const activeCount = groupPerms.filter((k) => effectiveSet.has(k)).length;
                        const isComplete = activeCount === groupPerms.length;
                        const hasOverride = groupPerms.some((k) => Boolean(overrideMap[k]));
                        const isSelected = activeGroupKey === group.key && !normalizedQuery && filter !== "overridden";

                        return (
                          <button
                            key={group.key}
                            type="button"
                            onClick={() => {
                              setActiveGroupKey(group.key);
                              setSearch("");
                              if (filter === "overridden") setFilter("all");
                            }}
                            className={cn(
                              "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-start text-xs font-semibold transition-colors",
                              isSelected
                                ? "bg-accent text-white shadow-2xs"
                                : "text-ink hover:bg-paper/80",
                            )}
                          >
                            <span className="truncate">{ar ? group.titleAr : group.titleEn}</span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              {hasOverride ? (
                                <span
                                  className={cn(
                                    "h-2 w-2 rounded-full",
                                    isSelected ? "bg-white" : "bg-amber-500",
                                  )}
                                  title={tx("hasManualOverridesDot", "يحتوي على استثناء يدوي (منح أو حجب)")}
                                />
                              ) : null}
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
                                  isSelected
                                    ? "bg-white/20 text-white"
                                    : isComplete
                                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
                                      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
                                )}
                              >
                                {activeCount}/{groupPerms.length}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Left Column (RTL): Active Category Permissions Card */}
                  <div className="overflow-hidden rounded-xl border border-line bg-card shadow-2xs">
                    {/* Active Category Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-slate-100/90 px-4 py-3 text-slate-800 dark:bg-slate-900/70 dark:text-slate-100">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-bold">
                          {normalizedQuery
                            ? tx("searchResultsAcrossCategories", "نتائج البحث في جميع الأقسام")
                            : activeGroupKey === "ALL" || filter === "overridden"
                              ? tx("allPermissionCategories", "جميع الأقسام (59)")
                              : ar
                                ? selectedGroupObj?.titleAr
                                : selectedGroupObj?.titleEn}
                        </h4>
                        <span className="rounded-full border border-line bg-card px-2.5 py-0.5 text-xs font-bold tabular-nums text-ink">
                          {sectionActiveCount} / {rawSectionPerms.length} {tx("activeInGroup", "مفعّلة")}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => applyBulkGroupState(rawSectionPerms, "ENABLE_ALL")}
                          className="rounded-lg border border-line bg-card px-2.5 py-1 text-xs font-semibold text-emerald-700 transition-colors hover:border-emerald-400 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
                        >
                          {tx("enableAllSection", "تفعيل كل القسم")}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => applyBulkGroupState(rawSectionPerms, "DISABLE_ALL")}
                          className="rounded-lg border border-line bg-card px-2.5 py-1 text-xs font-semibold text-rose-700 transition-colors hover:border-rose-400 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10"
                        >
                          {tx("disableAllSection", "إلغاء الكل")}
                        </button>
                        <button
                          type="button"
                          disabled={busy || sectionOverridesCount === 0}
                          onClick={() => applyBulkGroupState(rawSectionPerms, "RESET_ROLE")}
                          className="inline-flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1 text-xs font-semibold text-ink-muted transition-colors hover:border-accent/40 hover:text-ink disabled:opacity-40"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>{tx("resetSectionToRole", "إعادة ضبط القسم للدور")}</span>
                        </button>
                      </div>
                    </div>

                    {/* Permission Rows */}
                    {scopedPermissions.length === 0 ? (
                      <div className="p-8 text-center text-xs text-ink-muted">
                        {tx("noMatchingPermissionsInFilter", "لا توجد صلاحيات مطابقة للبحث أو الفلتر المحدد.")}
                      </div>
                    ) : (
                      <div className="divide-y divide-line/70">
                        {scopedPermissions.map((key) => {
                          const meta = PERMISSION_CATALOG[key];
                          const inheritedFromRole = roleGrantSet.has(key);
                          const override = overrideMap[key] as OverrideEffect | undefined;
                          const isEffective = effectiveSet.has(key);
                          const isExtraGrant = override === "GRANT" && !inheritedFromRole;
                          const isExplicitDeny = override === "DENY" && inheritedFromRole;
                          const hasAnyOverride = Boolean(override);

                          return (
                            <div
                              key={key}
                              title={key}
                              className={cn(
                                "flex flex-col justify-between gap-3 px-4 py-3 transition-colors sm:flex-row sm:items-center",
                                isExtraGrant
                                  ? "bg-emerald-50/50 dark:bg-emerald-500/[0.06]"
                                  : isExplicitDeny
                                    ? "bg-rose-50/50 dark:bg-rose-500/[0.06]"
                                    : isEffective
                                      ? "bg-accent/[0.02] hover:bg-paper/40"
                                      : "hover:bg-paper/40",
                              )}
                            >
                              {/* Permission Arabic Title & Description (English key hidden in title attribute) */}
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-semibold text-ink">
                                    {ar ? meta.labelAr : meta.labelEn}
                                  </span>
                                  {isGlobalView ? (
                                    <span className="rounded-md border border-line bg-paper px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                                      {ar ? meta.groupTitleAr : meta.groupTitleEn}
                                    </span>
                                  ) : null}
                                </div>
                                <p className="text-xs text-ink-muted">
                                  {ar ? meta.descriptionAr : meta.descriptionEn}
                                </p>
                              </div>

                              {/* Status Badge + Reset Button + Smart Toggle Switch */}
                              <div className="flex shrink-0 items-center gap-2.5 self-end sm:self-center">
                                {isExtraGrant ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-300">
                                    <span>{tx("extraGrantedBadge", "ممنوحة إضافياً")}</span>
                                  </span>
                                ) : isExplicitDeny ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-100 px-2.5 py-0.5 text-[11px] font-bold text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/20 dark:text-rose-300">
                                    <span>{tx("explicitDeniedBadge", "محجوبة استثنائياً")}</span>
                                  </span>
                                ) : (
                                  <span className="rounded-full border border-line bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                    {tx("roleDefaultBadge", "افتراضي الدور")}
                                  </span>
                                )}

                                {hasAnyOverride ? (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => setPermissionState(key, "INHERIT")}
                                    title={tx("resetSinglePermToRole", "إعادة لافتراضي الدور")}
                                    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-line bg-card text-xs font-bold text-ink-muted transition-colors hover:border-accent/50 hover:text-ink"
                                  >
                                    ↺
                                  </button>
                                ) : null}

                                <PermissionSwitch
                                  checked={isEffective}
                                  disabled={busy}
                                  tone={isExtraGrant ? "grant" : isExplicitDeny ? "deny" : "default"}
                                  label={ar ? meta.labelAr : meta.labelEn}
                                  onToggle={() => toggleSmartPermission(key)}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-slate-50/90 px-5 py-3 dark:bg-slate-900/80">
                <span className="text-xs text-ink-muted">
                  {tx(
                    "overridesAuditHint",
                    "يتم تطبيق التغييرات فوراً على جلسة المستخدم وتوثيقها في سجل المراجعة (Audit Trail).",
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                    {tx("cancel", "إلغاء")}
                  </Button>
                  <Button type="button" disabled={busy} onClick={() => void saveChanges()}>
                    <Check className="h-4 w-4" />
                    <span>{tx("saveUserEntitlements", "حفظ التخصيصات والدور")}</span>
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

function RoleTemplatesWorkspace({ roles }: { roles: AdminRoleRow[] }) {
  const { tx, ar } = useCopy();
  const client = useQueryClient();
  const roleKey = useIdempotencyKey();
  const roleLock = useSubmitLock();

  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const activeRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleId) ?? roles[0] ?? null,
    [roles, selectedRoleId],
  );

  const [draftPerms, setDraftPerms] = useState<Set<string>>(new Set());
  const [activeGroupKey, setActiveGroupKey] = useState<string>(PERMISSION_GROUPS[0]?.key ?? "ALL");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!activeRole) return;
    setDraftPerms(new Set(activeRole.permissions ?? []));
  }, [activeRole]);

  const isAdminRole = activeRole?.key === "administrator";
  const normalizedQuery = search.trim().toLowerCase();
  const isGlobalView = activeGroupKey === "ALL" || normalizedQuery.length > 0;
  const selectedGroupObj = PERMISSION_GROUPS.find((g) => g.key === activeGroupKey) ?? PERMISSION_GROUPS[0];

  const scopedPermissions = useMemo(() => {
    const base = isGlobalView
      ? [...PERMISSIONS]
      : PERMISSIONS.filter((k) => PERMISSION_CATALOG[k]?.groupKey === activeGroupKey);
    return base.filter((k) => {
      if (!normalizedQuery) return true;
      const meta = PERMISSION_CATALOG[k];
      const haystack = `${k} ${meta.labelAr} ${meta.labelEn} ${meta.descriptionAr} ${meta.descriptionEn}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [isGlobalView, activeGroupKey, normalizedQuery]);

  const rawSectionPerms = useMemo(
    () =>
      isGlobalView
        ? [...PERMISSIONS]
        : PERMISSIONS.filter((k) => PERMISSION_CATALOG[k]?.groupKey === activeGroupKey),
    [isGlobalView, activeGroupKey],
  );

  const sectionCheckedCount = rawSectionPerms.filter((k) => draftPerms.has(k)).length;

  function togglePerm(key: PermissionKey) {
    if (isAdminRole) return;
    setDraftPerms((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleGroup(groupKeys: PermissionKey[], selectAll: boolean) {
    if (isAdminRole) return;
    setDraftPerms((current) => {
      const next = new Set(current);
      for (const k of groupKeys) {
        if (selectAll) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }

  async function saveRolePermissions() {
    if (!activeRole) return;
    setBusy(true);
    try {
      await api(`/api/v1/roles/${activeRole.id}/permissions`, {
        method: "PUT",
        body: JSON.stringify({ permissions: [...draftPerms] }),
      });
      notifySuccess(
        tx("rolePermissionsSaved", "تم حفظ صلاحيات الدور بنجاح"),
        ar && activeRole.name_ar ? activeRole.name_ar : activeRole.name_en,
      );
      await client.invalidateQueries({ queryKey: ["roles"] });
      await client.invalidateQueries({ queryKey: ["users"] });
      await client.invalidateQueries({ queryKey: ["me"] });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Top Role Selector & Create Custom Role Trigger */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card p-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-muted">{tx("chooseRoleToEdit", "اختر الدور لتعديل صلاحياته:")}</span>
          {roles.map((role) => {
            const isSelected = activeRole?.id === role.id;
            return (
              <Button
                key={role.id}
                type="button"
                size="sm"
                variant={isSelected ? "default" : "outline"}
                onClick={() => setSelectedRoleId(role.id)}
              >
                <Shield className="h-3.5 w-3.5" />
                <span>{ar && role.name_ar ? role.name_ar : role.name_en}</span>
                <span className="ms-1 rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] tabular-nums">
                  {role.permissions.length}
                </span>
              </Button>
            );
          })}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setCreateOpen((v) => !v)}>
          + {tx("customRole", "إنشاء دور مخصص جديد")}
        </Button>
      </div>

      {/* Collapsible Create Custom Role Form */}
      {createOpen ? (
        <SectionCard
          title={tx("customRole", "إنشاء دور مخصص جديد")}
          icon={<ShieldCheck className="h-4 w-4" />}
          action={
            <Button type="button" size="sm" variant="outline" onClick={() => setCreateOpen(false)}>
              {tx("close", "إغلاق")}
            </Button>
          }
        >
          <form
            className="grid gap-3 md:grid-cols-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const basePerms = [...draftPerms];
              if (!basePerms.length) return;
              if (!roleLock.acquire()) return;
              try {
                const res = await api<{ id: string; key: string }>("/api/v1/roles", {
                  method: "POST",
                  idempotencyKey: roleKey.key.current,
                  body: JSON.stringify({
                    key: form.get("key"),
                    nameEn: form.get("nameEn"),
                    nameAr: form.get("nameAr") || form.get("nameEn"),
                    permissions: basePerms,
                  }),
                });
                roleKey.reset();
                notifySuccess(tx("roleCreated", "تم إنشاء الدور المخصص بنجاح"), String(form.get("key")));
                setCreateOpen(false);
                await client.invalidateQueries({ queryKey: ["roles"] });
                setSelectedRoleId(res.data.id);
              } catch (error) {
                if (isDefinitiveFailure(error)) roleKey.reset();
                notifyError(error);
              } finally {
                roleLock.release();
              }
            }}
          >
            <Field label={tx("roleKey", "الكود البرمجي للدور (بالإنجليزية الصغيرة)")}>
              <Input name="key" required dir="ltr" placeholder="customs_auditor" />
            </Field>
            <Field label={tx("name", "الاسم بالإنجليزية")}>
              <Input name="nameEn" required placeholder="Customs Auditor" />
            </Field>
            <Field label={tx("arabicName", "الاسم بالعربية")}>
              <Input name="nameAr" required placeholder="مراجع جمركي" />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-2 md:col-span-3">
              <span className="text-xs text-ink-muted">
                {tx(
                  "customRoleInheritHint",
                  `سيتم إنشاء الدور الجديد مبدئياً بالصلاحيات المحددة أدناه (${draftPerms.size} صلاحية) ويمكنك تعديلها في أي وقت.`,
                )}
              </span>
              <Button type="submit" disabled={roleLock.busy}>
                {tx("createRole", "حفظ وإنشاء الدور")}
              </Button>
            </div>
          </form>
        </SectionCard>
      ) : null}

      {/* Active Role Matrix Card */}
      {activeRole ? (
        <div className="overflow-hidden rounded-xl border border-line bg-card shadow-card">
          {/* Role Matrix Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-slate-50/90 px-4 py-3 dark:bg-slate-900/50">
            <div>
              <div className="flex items-center gap-2" title={activeRole.key}>
                <h3 className="text-sm font-bold text-ink">
                  {ar && activeRole.name_ar ? activeRole.name_ar : activeRole.name_en}
                </h3>
                <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-bold tabular-nums text-accent">
                  {draftPerms.size} / {PERMISSIONS.length} {tx("activePermsUnit", "صلاحية مفعلة")}
                </span>
              </div>
              {isAdminRole ? (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
                  <Lock className="h-3.5 w-3.5 text-accent" />
                  <span>{tx("adminRoleLockedHint", "دور مدير النظام يمتلك كافة صلاحيات النظام الـ 59 تلقائياً لحماية جذر الصلاحيات.")}</span>
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-64">
                <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={tx("searchPermissionsShort", "بحث في الصلاحيات...")}
                  className="h-8 bg-card ps-8 text-xs"
                />
              </div>
              {!isAdminRole ? (
                <Button type="button" size="sm" disabled={busy} onClick={() => void saveRolePermissions()}>
                  <Check className="h-3.5 w-3.5" />
                  <span>{tx("saveRolePermissions", "حفظ صلاحيات الدور")}</span>
                </Button>
              ) : null}
            </div>
          </div>

          {/* 2-Column Master-Detail Permissions Body */}
          <div className="p-4">
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[260px_1fr]">
              {/* Right Column (RTL): Category Navigation Sidebar */}
              <div className="rounded-xl border border-line bg-card p-1.5 shadow-2xs">
                <div className="px-2.5 py-1.5 text-[11px] font-bold text-ink-muted">
                  {tx("permissionCategoriesHeading", "الأقسام الوظيفية (12)")}
                </div>
                <div className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveGroupKey("ALL");
                      setSearch("");
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-start text-xs font-semibold transition-colors",
                      activeGroupKey === "ALL" && !normalizedQuery
                        ? "bg-accent text-white shadow-2xs"
                        : "text-ink hover:bg-paper/80",
                    )}
                  >
                    <span className="truncate">{tx("allPermissionCategories", "جميع الأقسام (59)")}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
                        activeGroupKey === "ALL" && !normalizedQuery
                          ? "bg-white/20 text-white"
                          : draftPerms.size === PERMISSIONS.length
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
                            : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
                      )}
                    >
                      {draftPerms.size}/{PERMISSIONS.length}
                    </span>
                  </button>

                  {PERMISSION_GROUPS.map((group) => {
                    const groupPerms = PERMISSIONS.filter((k) => PERMISSION_CATALOG[k]?.groupKey === group.key);
                    const checkedCount = groupPerms.filter((k) => draftPerms.has(k)).length;
                    const isComplete = checkedCount === groupPerms.length;
                    const isSelected = activeGroupKey === group.key && !normalizedQuery;

                    return (
                      <button
                        key={group.key}
                        type="button"
                        onClick={() => {
                          setActiveGroupKey(group.key);
                          setSearch("");
                        }}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-start text-xs font-semibold transition-colors",
                          isSelected
                            ? "bg-accent text-white shadow-2xs"
                            : "text-ink hover:bg-paper/80",
                        )}
                      >
                        <span className="truncate">{ar ? group.titleAr : group.titleEn}</span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
                            isSelected
                              ? "bg-white/20 text-white"
                              : isComplete
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
                                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
                          )}
                        >
                          {checkedCount}/{groupPerms.length}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Left Column (RTL): Active Category Permissions Card */}
              <div className="overflow-hidden rounded-xl border border-line bg-card shadow-2xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-slate-100/90 px-4 py-3 text-slate-800 dark:bg-slate-900/70 dark:text-slate-100">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-bold">
                      {normalizedQuery
                        ? tx("searchResultsAcrossCategories", "نتائج البحث في جميع الأقسام")
                        : activeGroupKey === "ALL"
                          ? tx("allPermissionCategories", "جميع الأقسام (59)")
                          : ar
                            ? selectedGroupObj?.titleAr
                            : selectedGroupObj?.titleEn}
                    </h4>
                    <span className="rounded-full border border-line bg-card px-2.5 py-0.5 text-xs font-bold tabular-nums text-ink">
                      {sectionCheckedCount} / {rawSectionPerms.length} {tx("activeInGroup", "مفعّلة")}
                    </span>
                  </div>

                  {!isAdminRole ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => toggleGroup(rawSectionPerms, true)}
                        className="rounded-lg border border-line bg-card px-2.5 py-1 text-xs font-semibold text-emerald-700 transition-colors hover:border-emerald-400 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
                      >
                        {tx("enableAllSection", "تفعيل كل القسم")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => toggleGroup(rawSectionPerms, false)}
                        className="rounded-lg border border-line bg-card px-2.5 py-1 text-xs font-semibold text-rose-700 transition-colors hover:border-rose-400 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10"
                      >
                        {tx("disableAllSection", "إلغاء الكل")}
                      </button>
                    </div>
                  ) : null}
                </div>

                {scopedPermissions.length === 0 ? (
                  <div className="p-8 text-center text-xs text-ink-muted">
                    {tx("noMatchingPermissionsInFilter", "لا توجد صلاحيات مطابقة للبحث.")}
                  </div>
                ) : (
                  <div className="divide-y divide-line/70">
                    {scopedPermissions.map((key) => {
                      const meta = PERMISSION_CATALOG[key];
                      const checked = draftPerms.has(key);
                      return (
                        <div
                          key={key}
                          title={key}
                          className={cn(
                            "flex items-center justify-between gap-3 px-4 py-3 transition-colors",
                            checked
                              ? "bg-emerald-50/40 dark:bg-emerald-500/[0.05]"
                              : "hover:bg-paper/40",
                          )}
                        >
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-ink">
                                {ar ? meta.labelAr : meta.labelEn}
                              </span>
                              {isGlobalView ? (
                                <span className="rounded-md border border-line bg-paper px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                                  {ar ? meta.groupTitleAr : meta.groupTitleEn}
                                </span>
                              ) : null}
                            </div>
                            <p className="text-xs text-ink-muted">
                              {ar ? meta.descriptionAr : meta.descriptionEn}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-2.5">
                            <span
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                checked
                                  ? "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-300"
                                  : "border-line bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
                              )}
                            >
                              {checked ? tx("permEnabledBadge", "مفعّلة") : tx("permDisabledBadge", "غير مفعّلة")}
                            </span>
                            <PermissionSwitch
                              checked={checked}
                              disabled={isAdminRole || busy}
                              tone={checked ? "grant" : "default"}
                              label={ar ? meta.labelAr : meta.labelEn}
                              onToggle={() => togglePerm(key)}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SettingsPage() {
  const { tx, ruleName, fail, ar } = useCopy();
  const client = useQueryClient();
  const [ruleMessage, setRuleMessage] = useState<string | null>(null);
  const fields = useQuery({
    queryKey: ["custom-fields"],
    queryFn: async () => (await api<Array<Record<string, string>>>("/api/v1/custom-fields")).data,
  });
  const rules = useQuery({
    queryKey: ["rules"],
    queryFn: async () => (await api<Array<Record<string, string>>>("/api/v1/reminder-rules")).data,
  });
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await api<Array<Record<string, unknown>>>("/api/v1/document-templates")).data,
    refetchInterval: false,
  });
  const fieldKey = useIdempotencyKey();
  const fieldLock = useSubmitLock();
  const [tab, setTab] = useState("identity");
  const tabs = [
    ["identity", "companyIdentity", "Company identity"],
    ["fields", "customFields", "Custom fields"],
    ["rules", "reminderRules", "Reminder rules"],
    ["templates", "documentTemplates", "Document templates"],
    ["whatsapp", "whatsappMessages", "WhatsApp messages"],
    ["trade", "tradeSettings", "Export documents"],
  ] as const;
  return (
    <div className="space-y-6" data-settings="ready" data-rules={rules.isLoading ? "loading" : "ready"}>
      <PageHeader title={tx("settings", "Settings")} subtitle={tx("settingsHint", "Company identity, custom fields, reminder rules and document templates. Each section stays in its own tab.")} />
      <nav className="flex flex-wrap gap-2" aria-label={tx("settingsTabs", "Settings sections")}>
        {tabs.map(([id, key, english]) => (
          <Button key={id} type="button" size="sm" variant={tab === id ? "default" : "outline"} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}>
            {tx(key, english)}
          </Button>
        ))}
      </nav>
      {tab === "identity" ? <BrandLogoCard /> : null}
      {tab === "fields" ? <div className="grid items-start gap-4 xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
      <SectionCard title={tx("addField", "Add field")} icon={<SlidersHorizontal className="h-4 w-4" />}>
        <form
          className="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!fieldLock.acquire()) return;
            const form = new FormData(event.currentTarget);
            const options = String(form.get("options") || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
            try {
              await api("/api/v1/custom-fields", {
                method: "POST",
                idempotencyKey: fieldKey.key.current,
                body: JSON.stringify({
                  targetEntity: form.get("targetEntity"),
                  fieldKey: form.get("fieldKey"),
                  labelEn: form.get("labelEn"),
                  labelAr: form.get("labelAr"),
                  dataType: form.get("dataType"),
                  required: form.get("required") === "1",
                  sensitive: form.get("sensitive") === "1",
                  options,
                }),
              });
              fieldKey.reset();
              notifySuccess(tx("fieldSaved", "Custom field saved"));
              await client.invalidateQueries({ queryKey: ["custom-fields"] });
            } catch (error) {
              if (isDefinitiveFailure(error)) fieldKey.reset();
              notifyError(error);
            } finally {
              fieldLock.release();
            }
          }}
        >
          <Field label={tx("target", "Target")}>
            <Select name="targetEntity" defaultValue="CUSTOMER">
              <option value="CUSTOMER">{tx("entity.CUSTOMER", "Customer")}</option>
              <option value="EXPORT_CASE">{tx("entity.EXPORT_CASE", "Export operation")}</option>
              <option value="INVOICE">{tx("entity.INVOICE", "Invoice")}</option>
              <option value="BOOKING">{tx("entity.BOOKING", "Booking")}</option>
              <option value="CONTAINER">{tx("entity.CONTAINER", "Container")}</option>
            </Select>
          </Field>
          <Field label={tx("key", "Key")}><Input name="fieldKey" required dir="ltr" /></Field>
          <Field label={tx("labelEn", "Label EN")}><Input name="labelEn" required /></Field>
          <Field label={tx("labelAr", "Label AR")}><Input name="labelAr" required /></Field>
          <Field label={tx("type", "Type")}>
            <Select name="dataType" defaultValue="TEXT">
              <option value="TEXT">{tx("fieldType.TEXT", "Text")}</option>
              <option value="NUMBER">{tx("fieldType.NUMBER", "Number")}</option>
              <option value="DATE">{tx("fieldType.DATE", "Date")}</option>
              <option value="BOOLEAN">{tx("fieldType.BOOLEAN", "Yes / no")}</option>
              <option value="SELECT">{tx("fieldType.SELECT", "Choice")}</option>
            </Select>
          </Field>
          <Field label={tx("fieldOptions", "Options")} hint={tx("fieldOptionsHint", "One option per line. Required for a choice field.")}><Input name="options" dir="ltr" /></Field>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="required" value="1" className="h-4 w-4 accent-accent" /> {tx("required", "required")}</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="sensitive" value="1" className="h-4 w-4 accent-accent" /> {tx("sensitive", "Sensitive")}</label>
          </div>
          <Button type="submit" disabled={fieldLock.busy}>{tx("addField", "Add field")}</Button>
        </form>
      </SectionCard>
      <SectionCard title={tx("customFields", "Custom fields")} icon={<SlidersHorizontal className="h-4 w-4" />} action={<span className="text-xs text-ink-muted"><Ltr>{fields.data?.length ?? 0}</Ltr></span>}>
        <ul className="space-y-3 text-sm">
          {fields.isLoading ? (
            <li className="rounded-xl border border-line bg-paper/40 p-3">
              <SkeletonRegion label="Loading custom fields">
                <SkeletonText lines={2} />
              </SkeletonRegion>
            </li>
          ) : null}
          {!fields.isLoading && !fields.data?.length ? <li><EmptyState>{tx("empty", "Nothing here yet.")}</EmptyState></li> : null}
          {fields.data?.map((f) => (
            <li key={f.id} className="rounded-xl border border-line bg-paper/40 p-3">
              <form
                className="grid gap-3 md:grid-cols-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  try {
                    await api(`/api/v1/custom-fields/${f.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        labelEn: form.get("labelEn"),
                        labelAr: form.get("labelAr"),
                        position: Number(form.get("position") || 0),
                        required: form.get("required") === "1",
                        sensitive: form.get("sensitive") === "1",
                        active: form.get("active") === "1",
                        options: String(form.get("options") || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean),
                      }),
                    });
                    notifySuccess(tx("fieldSaved", "Custom field saved"), String(f.field_key));
                    await client.invalidateQueries({ queryKey: ["custom-fields"] });
                  } catch (error) {
                    notifyError(error);
                  }
                }}
              >
                <span className="md:col-span-2 font-medium">{tx(`entity.${f.target_entity}`, String(f.target_entity))} · <Ltr>{f.field_key}</Ltr> · {tx(`fieldType.${f.data_type}`, String(f.data_type))}</span>
                <Field label={tx("labelEn", "Label EN")}><Input name="labelEn" defaultValue={f.label_en} required /></Field>
                <Field label={tx("labelAr", "Label AR")}><Input name="labelAr" defaultValue={f.label_ar} required /></Field>
                <Field label={tx("position", "Order")}><Input name="position" type="number" min={0} defaultValue={f.position} dir="ltr" /></Field>
                <Field label={tx("fieldOptions", "Options")}><Input name="options" defaultValue={f.data_type === "SELECT" ? safeOptions(f.options_json) : ""} dir="ltr" /></Field>
                <div className="flex flex-wrap items-center gap-4 md:col-span-2">
                  <label className="flex items-center gap-2"><input type="checkbox" name="required" value="1" defaultChecked={Number(f.required) === 1} className="h-4 w-4 accent-accent" /> {tx("required", "required")}</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="sensitive" value="1" defaultChecked={Number(f.sensitive) === 1} className="h-4 w-4 accent-accent" /> {tx("sensitive", "Sensitive")}</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="active" value="1" defaultChecked={Number(f.active) === 1} className="h-4 w-4 accent-accent" /> {tx("active", "active")}</label>
                  <Button type="submit" size="sm" variant="outline" className="ms-auto">{tx("saveField", "Save field")}</Button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      </SectionCard>
      </div> : null}
      {tab === "rules" ? <SectionCard title={tx("reminderRules", "Reminder rules")} icon={<BellRing className="h-4 w-4" />} action={<span className="text-xs text-ink-muted"><Ltr>{rules.data?.length ?? 0}</Ltr></span>}>
        <div data-rules={rules.isLoading ? "loading" : "ready"}>
        {ruleMessage ? <p className="mb-2 text-sm text-ink-muted" role="alert">{ruleMessage}</p> : null}
        {rules.isLoading ? (
          <SkeletonRegion label="Loading reminder rules">
            <SkeletonText lines={3} className="mt-2" />
          </SkeletonRegion>
        ) : null}
        <ul className="space-y-3 text-sm">
          {rules.data?.map((r) => (
            <li key={r.id} className="rounded-xl border border-line bg-paper/40 p-3">
              <form
                className="grid gap-3 md:grid-cols-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const repeat = String(form.get("repeatEveryDays") ?? "").trim();
                  setRuleMessage(null);
                  try {
                    await api(`/api/v1/reminder-rules/${r.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        offsetAmount: Number(form.get("offsetAmount")),
                        offsetDirection: form.get("offsetDirection"),
                        offsetUnit: form.get("offsetUnit"),
                        repeatEveryDays: repeat ? Number(repeat) : null,
                        repeatCap: String(form.get("repeatCap") ?? "").trim() ? Number(form.get("repeatCap")) : null,
                        enabled: form.get("enabled") === "1",
                        expected: {
                          enabled: Number(r.enabled) === 1,
                          offsetAmount: Number(r.offset_amount),
                          offsetDirection: r.offset_direction,
                          offsetUnit: r.offset_unit,
                          repeatEveryDays: r.repeat_every_days == null || r.repeat_every_days === "" ? null : Number(r.repeat_every_days),
                          repeatCap: r.repeat_cap == null || r.repeat_cap === "" ? null : Number(r.repeat_cap),
                        },
                      }),
                    });
                    notifySuccess(tx("ruleSaved", "Reminder rule saved"));
                    await client.invalidateQueries({ queryKey: ["rules"] });
                  } catch (error) {
                    setRuleMessage(fail(error));
                    await rules.refetch();
                  }
                }}
              >
                <span className="md:col-span-3 font-medium text-ink">{ruleName(r.id, r.name_en)}</span>
                <Field label={tx("offsetAmount", "Amount")}><Input name="offsetAmount" type="number" defaultValue={r.offset_amount} dir="ltr" /></Field>
                <Field label={tx("offsetDirection", "Direction")}>
                  <Select name="offsetDirection" defaultValue={r.offset_direction}>
                    <option value="BEFORE">{tx("offset.BEFORE", "Before")}</option>
                    <option value="AFTER">{tx("offset.AFTER", "After")}</option>
                  </Select>
                </Field>
                <Field label={tx("offsetUnit", "Unit")}>
                  <Select name="offsetUnit" defaultValue={r.offset_unit}>
                    <option value="DAYS">{tx("unit.DAYS", "Days")}</option>
                    <option value="HOURS">{tx("unit.HOURS", "Hours")}</option>
                  </Select>
                </Field>
                <Field label={tx("repeatDays", "Repeat every (days)")}><Input name="repeatEveryDays" placeholder={tx("reminderOnce", "Once")} defaultValue={r.repeat_every_days ?? ""} dir="ltr" /></Field>
                <Field label={tx("repeatCap", "Repeat cap")}><Input name="repeatCap" defaultValue={r.repeat_cap ?? ""} dir="ltr" /></Field>
                <div className="flex flex-wrap items-center gap-3 md:col-span-3">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" value="1" defaultChecked={Number(r.enabled) === 1} className="h-4 w-4 accent-accent" /> {tx("active", "active")}</label>
                  <Button size="sm" type="submit" variant="outline" className="ms-auto">{tx("saveField", "Save field")}</Button>
                </div>
              </form>
            </li>
          ))}
        </ul>
        </div>
      </SectionCard> : null}
      {tab === "templates" ? <SectionCard title={tx("documentTemplates", "Document templates")} icon={<FileText className="h-4 w-4" />}>
        {templates.data?.length ? (
          <ul className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {templates.data.map((t) => (
              <li key={String(t.id)} className="flex items-center gap-3 rounded-xl border border-line bg-paper/40 px-3 py-3 text-ink">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"><FileText className="h-4 w-4" /></span>
                <span className="min-w-0 truncate font-medium">{String(ar ? t.name_ar || t.name_en : t.name_en)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>{tx("noTemplates", "No document templates yet.")}</EmptyState>
        )}
      </SectionCard> : null}
      {tab === "whatsapp" ? <WhatsAppTemplateCard /> : null}
      {tab === "trade" ? <TradeSettings /> : null}
    </div>
  );
}

function safeOptions(raw?: string) {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").join(", ") : "";
  } catch {
    return "";
  }
}

export function ActivityPage() {
  const { tx, activity, i18n } = useCopy();
  const query = useQuery({
    queryKey: ["activity"],
    queryFn: async () => (await api<Array<Record<string, string>>>("/api/v1/activity")).data,
  });
  const rows = query.data ?? [];
  return (
    <div className="space-y-4" data-activity={query.isLoading ? "loading" : "ready"}>
      <PageHeader title={tx("activity", "Activity")} subtitle={tx("activityHint", "The audit trail: every recorded action, newest first.")} />
      {query.isLoading ? <SkeletonCardList rows={4} /> : null}
      {!query.isLoading && !rows.length ? <EmptyState>{tx("noActivity", "No activity recorded yet.")}</EmptyState> : null}
      {rows.length ? (
        <SectionCard title={tx("auditTrail", "Audit trail")} icon={<History className="h-4 w-4" />} action={<span className="text-xs text-ink-muted"><Ltr>{rows.length}</Ltr></span>}>
          <ol className="relative space-y-3 ps-5">
            <span className="absolute bottom-2 start-[5px] top-2 w-px bg-line" aria-hidden />
            {rows.map((row) => (
              <li key={row.id} className="relative">
                <span className="absolute -start-5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-accent" aria-hidden />
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-paper/40 px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{activity(row.action)}</span>
                    <span className="block text-xs text-ink-muted">
                      {tx(`entity.${row.entity_type}`, String(row.entity_type))} · <Ltr>{String(row.entity_id).slice(0, 8)}</Ltr>
                    </span>
                  </span>
                  <span className="text-[11px] text-ink-muted"><Ltr>{formatWhen(row.created_at, i18n.language)}</Ltr></span>
                </div>
              </li>
            ))}
          </ol>
        </SectionCard>
      ) : null}
    </div>
  );
}

function BrandLogoCard() {
  const { tx } = useCopy();
  const client = useQueryClient();
  const brand = useQuery({
    queryKey: ["brand"],
    queryFn: async () => (await api<{ name: string; theme: "light" | "dark"; hasLogo: boolean; hasFavicon: boolean; updatedAt: string | null }>("/api/v1/settings/brand")).data,
  });
  const [name, setName] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  const [logoData, setLogoData] = useState<string | null>(null);
  const [faviconData, setFaviconData] = useState<string | null>(null);
  const [clearLogo, setClearLogo] = useState(false);
  const [clearFavicon, setClearFavicon] = useState(false);
  const [busy, setBusy] = useState(false);
  const applied = useThemeName();
  const ready = brand.data;
  const shownName = name ?? ready?.name ?? "";
  const storedTheme = ready?.theme === "dark" ? "dark" : "light";
  const shownTheme = theme ?? (ready ? applied : "light");
  const logoSrc = clearLogo ? "" : logoData || (ready?.hasLogo ? `/api/v1/public/brand/logo?v=${encodeURIComponent(ready.updatedAt ?? "")}` : "");
  const iconSrc = clearFavicon ? "" : faviconData || (ready?.hasFavicon ? `/api/v1/public/brand/favicon?v=${encodeURIComponent(ready.updatedAt ?? "")}` : "");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      await api("/api/v1/settings/brand", {
        method: "POST",
        body: JSON.stringify({
          productName: shownName,
          theme: theme ?? storedTheme,
          ...(clearLogo ? { clearLogo: true } : {}),
          ...(logoData ? { logoData } : {}),
          ...(clearFavicon ? { clearFavicon: true } : {}),
          ...(faviconData ? { faviconData } : {}),
        }),
      });
      setLogoData(null);
      setFaviconData(null);
      setClearLogo(false);
      setClearFavicon(false);
      notifySuccess(tx("companyBrandSaved", "Company identity saved"));
      await client.invalidateQueries({ queryKey: ["brand"] });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title={tx("companyIdentity", "Company identity")} icon={<Image className="h-4 w-4" />}>
      <p className="mb-3 text-sm text-ink-muted">{tx("companyIdentityHint", "Only the system administrator can change the name, theme, sign-in logo and browser icon.")}</p>
      <form className="grid gap-4" onSubmit={(event) => void save(event)}>
        <Field label={tx("systemName", "System name")}>
          <Input value={shownName} maxLength={40} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={tx("systemTheme", "System theme")}>
          <Select value={ready ? shownTheme : "light"} onChange={(event) => {
            const next = event.target.value === "dark" ? "dark" : "light";
            setTheme(next);
            applyTheme(next);
          }}>
            <option value="light">{tx("lightMode", "Light mode")}</option>
            <option value="dark">{tx("darkMode", "Dark mode")}</option>
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <ImagePicker
            label={tx("companyLogo", "Company logo")}
            hint={tx("companyLogoHint", "Shown at the center of the sign-in page. PNG, JPEG, WEBP or GIF, up to 512 KB.")}
            src={logoSrc}
            accept="image/png,image/jpeg,image/webp,image/gif"
            busy={busy}
            onPick={async (file) => {
              if (file.size > 512 * 1024) return notifyError(new Error("PAYLOAD_TOO_LARGE"));
              setClearLogo(false);
              setLogoData(await fileToDataUrl(file));
            }}
            onClear={logoSrc ? () => { setLogoData(null); setClearLogo(true); } : undefined}
          />
          <ImagePicker
            label={tx("favicon", "Browser icon")}
            hint={tx("faviconHint", "Shown on the browser tab. PNG, JPEG, WEBP, GIF or ICO, up to 256 KB.")}
            src={iconSrc}
            accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon,.ico"
            busy={busy}
            onPick={async (file) => {
              if (file.size > 256 * 1024) return notifyError(new Error("PAYLOAD_TOO_LARGE"));
              setClearFavicon(false);
              setFaviconData(await fileToDataUrl(file));
            }}
            onClear={iconSrc ? () => { setFaviconData(null); setClearFavicon(true); } : undefined}
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || !ready}>{tx("save", "Save")}</Button>
        </div>
      </form>
    </SectionCard>
  );
}

function ImagePicker({
  label,
  hint,
  src,
  accept,
  busy,
  onPick,
  onClear,
}: {
  label: string;
  hint: string;
  src: string;
  accept: string;
  busy: boolean;
  onPick: (file: File) => Promise<void> | void;
  onClear?: () => void;
}) {
  const { tx } = useCopy();
  return (
    <div className="rounded-xl border border-line bg-paper/40 p-3">
      <p className="text-sm font-medium text-ink">{label}</p>
      <p className="mt-1 text-xs text-ink-muted">{hint}</p>
      <div className="mt-3 flex items-center gap-3">
        <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-card">
          {src ? <img src={src} alt="" className="h-full w-full object-contain p-1" /> : <Image className="h-4 w-4 text-ink-muted" />}
        </span>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex h-8 cursor-pointer items-center rounded-control border border-line bg-card px-2.5 text-xs font-medium text-ink shadow-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
            {tx("chooseImage", "Choose image")}
            <input
              type="file"
              accept={accept}
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onPick(file);
                event.target.value = "";
              }}
            />
          </label>
          {onClear ? (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onClear}>
              {tx("removeLogo", "Remove logo")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Two-letter monogram for avatar tiles. */
function initialsOf(value?: string) {
  return String(value || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
