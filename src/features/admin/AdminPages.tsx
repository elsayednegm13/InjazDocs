import { PERMISSIONS } from "@shared/permissions";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Ltr, PageHeader } from "@/components/ui/chrome";
import { Field, Input, Select } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useCopy } from "@/lib/copy";

export function UsersPage() {
  const { tx, ar } = useCopy();
  const query = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api<Array<Record<string, string>>>("/api/v1/users")).data,
  });
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await api<Array<{ id: string; key: string; name_en: string; name_ar: string }>>("/api/v1/roles")).data,
  });
  return (
    <div className="space-y-4">
      <PageHeader title={tx("users", "Users")} />
      <form
        className="grid gap-2 rounded-xl border border-line bg-card p-4 md:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          await api("/api/v1/users", {
            method: "POST",
            body: JSON.stringify({
              name: form.get("name"),
              email: form.get("email"),
              password: form.get("password"),
              roleKeys: [form.get("role")],
            }),
          });
          window.location.reload();
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
        <Button type="submit">{tx("provisionUser", "Provision user")}</Button>
      </form>
      <form
        className="grid gap-2 rounded-xl border border-line bg-card p-4 md:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const permissions = form.getAll("permissions").map(String);
          if (!permissions.length) return;
          await api("/api/v1/roles", {
            method: "POST",
            body: JSON.stringify({
              key: form.get("key"),
              nameEn: form.get("nameEn"),
              nameAr: form.get("nameAr") || form.get("nameEn"),
              permissions,
            }),
          });
          window.location.reload();
        }}
      >
        <h2 className="md:col-span-2 font-medium">{tx("customRole", "Custom role")}</h2>
        <Field label={tx("roleKey", "Role key")}><Input name="key" required dir="ltr" /></Field>
        <Field label={tx("name", "Name")}><Input name="nameEn" required /></Field>
        <Field label={tx("arabicName", "Arabic name")}><Input name="nameAr" /></Field>
        <fieldset className="md:col-span-2">
          <legend className="mb-2 text-sm font-medium">{tx("permissions", "Permissions")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {PERMISSIONS.map((key) => (
              <label key={key} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="permissions" value={key} className="mt-1" />
                <span>{tx(`perm.${key}`, key)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit" variant="outline">{tx("createRole", "Create role")}</Button>
      </form>
      {query.data?.map((u) => (
        <div key={u.id} className="rounded-xl border border-line bg-card p-4 text-sm">
          {u.name} · <Ltr>{u.email}</Ltr> · {u.roles} · {u.is_active === "1" || Number(u.is_active) === 1 ? tx("active", "active") : tx("disabled", "disabled")}
        </div>
      ))}
    </div>
  );
}

export function SettingsPage() {
  const { tx, ruleName, fail } = useCopy();
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
  });
  return (
    <div className="space-y-6">
      <PageHeader title={tx("settings", "Settings")} />
      <section className="rounded-xl border border-line bg-card p-4">
        <h2 className="mb-2 font-medium">{tx("customFields", "Custom fields")}</h2>
        <form
          className="grid gap-2 md:grid-cols-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const options = String(form.get("options") || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
            await api("/api/v1/custom-fields", {
              method: "POST",
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
            window.location.reload();
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
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="required" value="1" /> {tx("required", "required")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sensitive" value="1" /> {tx("sensitive", "Sensitive")}</label>
          <Button type="submit">{tx("addField", "Add field")}</Button>
        </form>
        <ul className="mt-3 space-y-2 text-sm">
          {fields.data?.map((f) => (
            <li key={f.id} className="rounded-lg border border-line p-2">
              <form
                className="grid gap-2 md:grid-cols-4"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
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
                  window.location.reload();
                }}
              >
                <span className="md:col-span-4 font-medium">{tx(`entity.${f.target_entity}`, String(f.target_entity))} · <Ltr>{f.field_key}</Ltr> · {tx(`fieldType.${f.data_type}`, String(f.data_type))}</span>
                <Input name="labelEn" defaultValue={f.label_en} required />
                <Input name="labelAr" defaultValue={f.label_ar} required />
                <Input name="position" type="number" min={0} defaultValue={f.position} dir="ltr" aria-label={tx("position", "Order")} />
                <Input name="options" defaultValue={f.data_type === "SELECT" ? safeOptions(f.options_json) : ""} dir="ltr" aria-label={tx("fieldOptions", "Options")} />
                <label className="flex items-center gap-2"><input type="checkbox" name="required" value="1" defaultChecked={Number(f.required) === 1} /> {tx("required", "required")}</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="sensitive" value="1" defaultChecked={Number(f.sensitive) === 1} /> {tx("sensitive", "Sensitive")}</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="active" value="1" defaultChecked={Number(f.active) === 1} /> {tx("active", "active")}</label>
                <Button type="submit" size="sm" variant="outline">{tx("saveField", "Save field")}</Button>
              </form>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-xl border border-line bg-card p-4" data-rules={rules.isLoading ? "loading" : "ready"}>
        <h2 className="mb-2 font-medium">{tx("reminderRules", "Reminder rules")}</h2>
        {ruleMessage ? <p className="mb-2 text-sm text-ink-muted" role="alert">{ruleMessage}</p> : null}
        {rules.isLoading ? <p className="text-sm text-ink-muted">{tx("loadingData", "Loading…")}</p> : null}
        <ul className="space-y-2 text-sm">
          {rules.data?.map((r) => (
            <li key={r.id} className="flex justify-between gap-2">
              <form
                className="grid flex-1 gap-2 md:grid-cols-4"
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
                    window.location.reload();
                  } catch (error) {
                    setRuleMessage(fail(error));
                    await rules.refetch();
                  }
                }}
              >
                <span className="md:col-span-4 font-medium">{ruleName(r.id, r.name_en)}</span>
                <Input name="offsetAmount" type="number" defaultValue={r.offset_amount} aria-label={tx("type", "Type")} dir="ltr" />
                <Select name="offsetDirection" defaultValue={r.offset_direction}>
                  <option value="BEFORE">{tx("offset.BEFORE", "Before")}</option>
                  <option value="AFTER">{tx("offset.AFTER", "After")}</option>
                </Select>
                <Select name="offsetUnit" defaultValue={r.offset_unit}>
                  <option value="DAYS">{tx("unit.DAYS", "Days")}</option>
                  <option value="HOURS">{tx("unit.HOURS", "Hours")}</option>
                </Select>
                <Input name="repeatEveryDays" placeholder={tx("reminderOnce", "Once")} defaultValue={r.repeat_every_days ?? ""} aria-label={tx("repeatDays", "Repeat every (days)")} dir="ltr" />
                <Input name="repeatCap" defaultValue={r.repeat_cap ?? ""} aria-label={tx("repeatCap", "Repeat cap")} dir="ltr" />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" value="1" defaultChecked={Number(r.enabled) === 1} /> {tx("active", "active")}</label>
                <Button size="sm" type="submit" variant="outline">{tx("saveField", "Save field")}</Button>
              </form>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-xl border border-line bg-card p-4">
        <h2 className="mb-2 font-medium">{tx("documentTemplates", "Document templates")}</h2>
        <ul className="text-sm">{templates.data?.map((t) => <li key={String(t.id)}>{String(t.name_en)}</li>)}</ul>
      </section>
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
  const { tx, activity } = useCopy();
  const query = useQuery({
    queryKey: ["activity"],
    queryFn: async () => (await api<Array<Record<string, string>>>("/api/v1/activity")).data,
  });
  return (
    <div className="space-y-3">
      <PageHeader title={tx("activity", "Activity")} />
      {query.data?.map((row) => (
        <div key={row.id} className="rounded-xl border border-line bg-card p-3 text-sm">
          {activity(row.action)} · {tx("updated", "Updated")} <Ltr>{row.created_at}</Ltr>
        </div>
      ))}
    </div>
  );
}
