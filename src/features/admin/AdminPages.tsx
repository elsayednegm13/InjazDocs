import { PERMISSIONS } from "@shared/permissions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, FileText, History, Image, ShieldCheck, SlidersHorizontal, UserCheck, UserPlus, Users as UsersIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, Ltr, PageHeader, SectionCard, StatCard } from "@/components/ui/chrome";
import { SkeletonCardList, SkeletonRegion, SkeletonRows, SkeletonText } from "@/components/ui/skeleton";
import { Field, Input, Select } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatWhen, useCopy } from "@/lib/copy";
import { isDefinitiveFailure, useIdempotencyKey, useSubmitLock } from "@/lib/idempotency";
import { notifyError, notifySuccess } from "@/lib/notify";

export function UsersPage() {
  const { tx, ar, i18n } = useCopy();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api<Array<Record<string, string>>>("/api/v1/users")).data,
  });
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await api<Array<{ id: string; key: string; name_en: string; name_ar: string; permissions: string[] }>>("/api/v1/roles")).data,
  });
  const userKey = useIdempotencyKey();
  const userLock = useSubmitLock();
  const roleKey = useIdempotencyKey();
  const roleLock = useSubmitLock();
  const rows = query.data ?? [];
  const activeCount = rows.filter((user) => user.is_active === "1" || Number(user.is_active) === 1).length;
  return (
    <div className="space-y-4" data-users={query.isLoading ? "loading" : "ready"}>
      <PageHeader title={tx("users", "Users")} subtitle={tx("usersHint", "Provision accounts and shape roles; every change is written to the audit log.")} />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={tx("users", "Users")} value={rows.length} icon={<UsersIcon className="h-5 w-5" />} tone="blue" />
        <StatCard label={tx("active", "Active")} value={activeCount} icon={<UserCheck className="h-5 w-5" />} tone="green" />
        <StatCard label={tx("roles", "Roles")} value={(roles.data ?? []).length} icon={<ShieldCheck className="h-5 w-5" />} tone="teal" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard title={tx("provisionUser", "Provision user")} icon={<UserPlus className="h-4 w-4" />}>
          <form
            className="grid gap-3"
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
                notifySuccess(tx("userProvisioned", "User provisioned"), String(form.get("email")));
                await client.invalidateQueries({ queryKey: ["users"] });
              } catch (error) {
                if (isDefinitiveFailure(error)) userKey.reset();
                notifyError(error);
              } finally {
                userLock.release();
              }
            }}
          >
            <Field label={tx("name", "Name")}><Input name="name" required /></Field>
            <Field label={tx("email", "Email")}><Input name="email" type="email" required dir="ltr" /></Field>
            <Field label={tx("initialPassword", "Initial password")}><Input name="password" type="password" minLength={12} required /></Field>
            <Field label={tx("role", "Role")}>
              <Select name="role" defaultValue="export_officer">
                {(roles.data ?? [{ key: "export_officer", name_en: "Export officer", name_ar: "مسؤول تصدير", id: "role-officer" }]).map((role) => (
                  <option key={role.key} value={role.key}>{(ar && role.name_ar) ? role.name_ar : role.name_en}</option>
                ))}
              </Select>
            </Field>
            <div className="flex justify-end"><Button type="submit" disabled={userLock.busy}>{tx("provisionUser", "Provision user")}</Button></div>
          </form>
        </SectionCard>

        <SectionCard title={tx("customRole", "Custom role")} icon={<ShieldCheck className="h-4 w-4" />}>
          <form
            className="grid gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const permissions = form.getAll("permissions").map(String);
              if (!permissions.length) return;
              if (!roleLock.acquire()) return;
              try {
                await api("/api/v1/roles", {
                  method: "POST",
                  idempotencyKey: roleKey.key.current,
                  body: JSON.stringify({
                    key: form.get("key"),
                    nameEn: form.get("nameEn"),
                    nameAr: form.get("nameAr") || form.get("nameEn"),
                    permissions,
                  }),
                });
                roleKey.reset();
                notifySuccess(tx("roleCreated", "Role created"), String(form.get("key")));
                await client.invalidateQueries({ queryKey: ["roles"] });
              } catch (error) {
                if (isDefinitiveFailure(error)) roleKey.reset();
                notifyError(error);
              } finally {
                roleLock.release();
              }
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={tx("roleKey", "Role key")}><Input name="key" required dir="ltr" /></Field>
              <Field label={tx("name", "Name")}><Input name="nameEn" required /></Field>
              <div className="sm:col-span-2">
                <Field label={tx("arabicName", "Arabic name")}><Input name="nameAr" /></Field>
              </div>
            </div>
            <fieldset>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{tx("permissions", "Permissions")}</legend>
              <div className="grid max-h-64 gap-2 overflow-y-auto rounded-xl border border-line bg-paper/40 p-3 sm:grid-cols-2">
                {PERMISSIONS.map((key) => (
                  <label key={key} className="flex items-start gap-2 text-sm text-ink">
                    <input type="checkbox" name="permissions" value={key} className="mt-1 h-4 w-4 accent-accent" />
                    <span>{tx(`perm.${key}`, key)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex justify-end"><Button type="submit" variant="outline" disabled={roleLock.busy}>{tx("createRole", "Create role")}</Button></div>
          </form>
        </SectionCard>
      </div>

      <SectionCard title={tx("completedInvoicePermission", "Completed invoices")} icon={<ShieldCheck className="h-4 w-4" />}>
        <p className="mb-3 text-xs leading-relaxed text-ink-muted">{tx("completedInvoicePermissionHint", "Choose which roles may edit an invoice after the export operation is completed, or open it for editing and lock it again. The administrator already has this permission.")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(roles.data ?? []).map((role) => {
            const granted = (role.permissions ?? []).includes("invoices.correct_completed");
            return (
              <label key={role.id} className="flex items-start gap-2 rounded-xl border border-line bg-paper/40 px-3 py-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-accent"
                  checked={granted}
                  onChange={async (event) => {
                    const next = event.target.checked
                      ? [...(role.permissions ?? []), "invoices.correct_completed"]
                      : (role.permissions ?? []).filter((key) => key !== "invoices.correct_completed");
                    try {
                      await api(`/api/v1/roles/${role.id}/permissions`, { method: "PUT", body: JSON.stringify({ permissions: next }) });
                      notifySuccess(tx("rolePermissionsSaved", "Role permissions saved"));
                      await client.invalidateQueries({ queryKey: ["roles"] });
                    } catch (error) {
                      notifyError(error);
                    }
                  }}
                />
                <span>
                  <span className="block font-medium">{ar && role.name_ar ? role.name_ar : role.name_en}</span>
                  <span className="block text-xs text-ink-muted">{tx("perm.invoices.correct_completed", "Edit a completed invoice, or open it and lock it again")}</span>
                </span>
              </label>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title={tx("team", "Team")} icon={<UsersIcon className="h-4 w-4" />} action={<span className="text-xs text-ink-muted"><Ltr>{rows.length}</Ltr></span>}>
        {query.isLoading ? (
          <SkeletonRegion label="Loading team">
            <SkeletonRows rows={4} />
          </SkeletonRegion>
        ) : rows.length === 0 ? (
          <EmptyState>{tx("noUsers", "No users yet.")}</EmptyState>
        ) : (
          <ul className="grid gap-2">
            {rows.map((user) => {
              const isActive = user.is_active === "1" || Number(user.is_active) === 1;
              return (
                <li key={user.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-paper/40 px-3 py-2.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-2 text-xs font-semibold text-white">
                    {initialsOf(user.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{user.name}</span>
                    <span className="block truncate text-xs text-ink-muted"><Ltr>{user.email}</Ltr></span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {String(user.roles || "")
                      .split(/[,·|]/)
                      .map((role) => role.trim())
                      .filter(Boolean)
                      .map((role) => (
                        <span key={role} className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                          {tx(`role.${role}`, role)}
                        </span>
                      ))}
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${isActive ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"}`}>
                    {isActive ? tx("active", "Active") : tx("disabled", "Disabled")}
                  </span>
                  {user.created_at ? (
                    <span className="text-[11px] text-ink-muted"><Ltr>{formatWhen(user.created_at, i18n.language)}</Ltr></span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
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
  const ready = brand.data;
  const shownName = name ?? ready?.name ?? "";
  const shownTheme = theme ?? (ready?.theme === "dark" ? "dark" : "light");
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
          theme: shownTheme,
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
          <Select value={ready ? shownTheme : "light"} onChange={(event) => setTheme(event.target.value === "dark" ? "dark" : "light")}>
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
