import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useCopy } from "@/lib/copy";
import { defaultPrintFields, profileFieldValue, type CustomerPrintProfile, type PrintField } from "@shared/trade-print-fields";

export function useCustomerPrintProfile(customerId: string) {
  return useQuery({
    queryKey: ["customer-print-profile", customerId],
    enabled: Boolean(customerId),
    queryFn: async () => (await api<CustomerPrintProfile>(`/api/v1/customer-print-profiles/${customerId}`)).data,
  });
}

export function PrintFieldsPanel({
  customerId,
  fields,
  disabled,
  document,
  onChange,
}: {
  customerId: string;
  fields: PrintField[];
  disabled?: boolean;
  document: { date: string; invoiceNumber: string; reference: string };
  onChange: (fields: PrintField[]) => void;
}) {
  const { tx } = useCopy();
  const profile = useCustomerPrintProfile(customerId);
  const current = fields.length ? fields : defaultPrintFields();
  const emptyProfile: CustomerPrintProfile = {
    name: "", address: "", taxId: "", phone: "", email: "", bankName: "", accountName: "", accountLast4: "", ibanLast4: "", swift: "", code: "", country: "",
  };
  const shown = profile.data ?? emptyProfile;

  function update(id: string, patch: Partial<PrintField>) {
    onChange(current.map((field) => field.id === id ? { ...field, ...patch } : field));
  }

  function add(side: "buyer" | "meta") {
    onChange([...current, { id: crypto.randomUUID(), side, source: "custom", key: `custom-${Date.now()}`, label: "", value: "", visible: true }]);
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <FieldList title={tx("tradeBuyerFields", "Customer fields on the PDF")} hint={tx("tradeBuyerFieldsHint", "Edit any value for this invoice. Hide a row or add your own.")} fields={current.filter((field) => field.side === "buyer")} profile={shown} document={document} disabled={disabled} onUpdate={update} onAdd={() => add("buyer")} addLabel={tx("tradeAddBuyerField", "Add customer field")} />
      <FieldList title={tx("tradeMetaFields", "Invoice number and date fields")} hint={tx("tradeMetaFieldsHint", "Edit the date box, or add another row beside it.")} fields={current.filter((field) => field.side === "meta")} profile={shown} document={document} disabled={disabled} onUpdate={update} onAdd={() => add("meta")} addLabel={tx("tradeAddMetaField", "Add document field")} />
    </div>
  );
}

function FieldList({
  title,
  hint,
  fields,
  profile,
  document,
  disabled,
  onUpdate,
  onAdd,
  addLabel,
}: {
  title: string;
  hint: string;
  fields: PrintField[];
  profile: CustomerPrintProfile;
  document: { date: string; invoiceNumber: string; reference: string };
  disabled?: boolean;
  onUpdate: (id: string, patch: Partial<PrintField>) => void;
  onAdd: () => void;
  addLabel: string;
}) {
  return (
    <section className="rounded-control border border-line bg-paper p-3">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-xs text-ink-muted">{hint}</p>
      <ul className="mt-3 space-y-2">
        {fields.map((field) => {
          const preview = field.source === "custom" ? field.value ?? "" : profileFieldValue(profile, field.key, document);
          return (
            <li key={field.id} className="grid grid-cols-[auto_1fr] items-start gap-2">
              <button type="button" disabled={disabled} className={`mt-1 rounded-full border px-2 py-1 text-[11px] ${field.visible ? "border-accent bg-accent/10 text-accent" : "border-line text-ink-muted"}`} onClick={() => onUpdate(field.id, { visible: !field.visible })}>
                {field.visible ? "PDF" : "—"}
              </button>
              <div className="grid gap-1 sm:grid-cols-2">
                <Input dir="ltr" disabled={disabled} value={field.label} placeholder="Label" onChange={(event) => onUpdate(field.id, { label: event.target.value })} />
                <Input dir="ltr" disabled={disabled} value={field.value || preview} placeholder={preview || "Value"} onChange={(event) => onUpdate(field.id, { value: event.target.value })} />
              </div>
            </li>
          );
        })}
      </ul>
      <Button type="button" size="sm" variant="outline" className="mt-3" disabled={disabled} onClick={onAdd}>{addLabel}</Button>
    </section>
  );
}
