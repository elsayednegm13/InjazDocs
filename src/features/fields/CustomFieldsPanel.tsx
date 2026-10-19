import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Ltr } from "@/components/ui/chrome";
import { Field, Input, Select } from "@/components/ui/input";
import { api } from "@/lib/api";
import { fieldErrorsOf } from "@/lib/fail";
import { useCopy } from "@/lib/copy";

export type CustomFieldView = {
  id: string;
  key: string;
  labelEn: string;
  labelAr: string;
  dataType: string;
  required: boolean;
  sensitive: boolean;
  active: boolean;
  redacted: boolean;
  options: string[];
  value: string | null;
};

export type CustomFieldCatalogItem = {
  id: string;
  fieldKey: string;
  labelEn: string;
  labelAr: string;
  dataType: string;
  required: boolean;
  sensitive: boolean;
  redacted: boolean;
  options: string[];
};

function labelOf(field: { labelEn: string; labelAr: string }, arabic: boolean) {
  return arabic ? field.labelAr : field.labelEn;
}

function boxedValue(dataType: string, raw: FormDataEntryValue | null): unknown {
  if (dataType === "BOOLEAN") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    return "";
  }
  return raw == null ? "" : String(raw);
}

export function customFieldPayload(form: FormData, fields: CustomFieldCatalogItem[]) {
  const body: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.redacted) continue;
    body[field.fieldKey] = boxedValue(field.dataType, form.get(field.fieldKey));
  }
  return body;
}

export function CustomFieldInputs({ target }: { target: string }) {
  const { tx, ar } = useCopy();
  const query = useQuery({
    queryKey: ["custom-field-catalog", target],
    queryFn: async () => (await api<CustomFieldCatalogItem[]>(`/api/v1/custom-fields?targetEntity=${target}`)).data,
  });
  if (!query.data?.length) return null;
  return (
    <div className="grid gap-3 rounded-xl border border-line bg-card p-4 md:grid-cols-2" data-testid={`custom-fields-${target}`}>
      <h2 className="md:col-span-2 font-medium">{tx("customFields", "Custom fields")}</h2>
      {query.data.map((field) => {
        const label = labelOf(field, ar);
        if (field.redacted) {
          return <p key={field.id} className="text-sm text-ink-muted">{label}: {tx("restrictedField", "Restricted")}</p>;
        }
        return (
          <Field key={field.id} label={label} hint={field.required ? tx("required", "required") : undefined}>
            <FieldControl name={field.fieldKey} dataType={field.dataType} options={field.options} required={field.required} />
          </Field>
        );
      })}
    </div>
  );
}

export function CustomFieldsPanel({ endpoint, draft = false, locked = false }: { endpoint: string; draft?: boolean; locked?: boolean }) {
  const { tx, fail, ar } = useCopy();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const query = useQuery({
    queryKey: ["custom-field-values", endpoint],
    queryFn: async () => (await api<CustomFieldView[]>(endpoint)).data,
  });
  if (query.isLoading || query.isError || !query.data?.length) return null;
  return (
    <form
      className="grid gap-3 rounded-xl border border-line bg-card p-4 md:grid-cols-2"
      data-testid="custom-fields-panel"
      onSubmit={async (event) => {
        event.preventDefault();
        if (locked) return;
        setError(null);
        setSaved(false);
        const form = new FormData(event.currentTarget);
        const body: Record<string, unknown> = {};
        for (const field of query.data ?? []) {
          if (!field.active || field.redacted) continue;
          body[field.key] = boxedValue(field.dataType, form.get(field.key));
        }
        try {
          await api(endpoint, { method: "PUT", body: JSON.stringify(body) });
          setFieldErrors({});
          setSaved(true);
          await client.invalidateQueries({ queryKey: ["custom-field-values", endpoint] });
        } catch (err) {
          const next = fieldErrorsOf(err);
          setFieldErrors(next);
          setError(fail(err));
        }
      }}
    >
      <h2 className="md:col-span-2 font-medium">{tx("customFields", "Custom fields")}</h2>
      {draft ? <p className="md:col-span-2 text-xs text-ink-muted">{tx("draftFieldsHint", "Required extra fields can wait while this record is still a draft.")}</p> : null}
      {locked ? <p className="md:col-span-2 text-xs text-ink-muted">{tx("lockedFieldsHint", "These extra fields are locked with the invoice. An exceptional correction is required to change them.")}</p> : null}
      {query.data.map((field) => {
        const label = labelOf(field, ar);
        const code = fieldErrors[field.key];
        const message = code ? tx(`errors.${code}`, tx("errors.VALIDATION_ERROR", "Check the highlighted fields and try again.")) : undefined;
        if (field.redacted) {
          return <p key={field.id} className="text-sm text-ink-muted">{label}: {tx("restrictedField", "Restricted")}</p>;
        }
        if (!field.active) {
          return (
            <p key={field.id} className="text-sm">
              {label}: <Ltr>{field.value || "—"}</Ltr> · {tx("historicalField", "Kept from a disabled field")}
            </p>
          );
        }
        return (
          <Field key={field.id} label={label} error={message} hint={field.required ? tx("required", "required") : undefined}>
            <FieldControl name={field.key} dataType={field.dataType} options={field.options} required={field.required && !draft && !locked} defaultValue={field.value} disabled={locked} />
          </Field>
        );
      })}
      {error ? <p role="alert" className="text-sm text-danger md:col-span-2">{error}</p> : null}
      {saved ? <p className="text-sm text-ink-muted md:col-span-2">{tx("customFieldsSaved", "Custom fields saved.")}</p> : null}
      {locked ? null : <Button type="submit">{tx("saveCustomFields", "Save custom fields")}</Button>}
    </form>
  );
}

function FieldControl({
  name,
  dataType,
  options,
  required,
  defaultValue,
  disabled = false,
}: {
  name: string;
  dataType: string;
  options: string[];
  required: boolean;
  defaultValue?: string | null;
  disabled?: boolean;
}) {
  const { tx } = useCopy();
  if (dataType === "SELECT" || dataType === "BOOLEAN") {
    return (
      <Select name={name} defaultValue={defaultValue ?? ""} required={required} disabled={disabled} dir="ltr">
        <option value="">{tx("select", "Select")}</option>
        {dataType === "BOOLEAN" ? (
          <>
            <option value="true">{tx("fieldYes", "Yes")}</option>
            <option value="false">{tx("fieldNo", "No")}</option>
          </>
        ) : options.map((option) => <option key={option} value={option}>{option}</option>)}
      </Select>
    );
  }
  return (
    <Input
      name={name}
      defaultValue={defaultValue ?? ""}
      required={required}
      disabled={disabled}
      dir="ltr"
      type={dataType === "DATE" ? "date" : dataType === "NUMBER" ? "number" : "text"}
      step={dataType === "NUMBER" ? "any" : undefined}
    />
  );
}
