import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { SkeletonForm, SkeletonRegion } from "@/components/ui/skeleton";
import { api, createIdempotencyKey } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
import { QUOTATION_PATHS } from "@shared/api";

import { useCatalog } from "./quotation-model";
import type { CustomerOption, ItemDraft, QuotationDetail } from "./quotation-model";

const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];

export function NewQuotationPage() {
  const { tx } = useCopy();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const customers = useCatalog<CustomerOption>("/api/v1/customers?pageSize=100");
  const create = useMutation({
    mutationFn: async (body: QuotationWriteBody) =>
      (await api<{ id: string }>(QUOTATION_PATHS.list, {
        method: "POST",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify(body),
      })).data,
    onSuccess: (data) => {
      notifySuccess(tx("quotationCreated", "Quotation created."));
      void queryClient.invalidateQueries({ queryKey: ["quotations"] });
      void navigate(`/quotations/${data.id}`);
    },
    onError: notifyError,
  });
  return (
    <QuotationForm
      heading={tx("quotationNew", "New quotation")}
      submitLabel={tx("quotationCreate", "Create quotation")}
      customers={customers.data ?? []}
      pending={create.isPending}
      onSubmit={(body) => create.mutate(body)}
    />
  );
}

export function QuotationEditPage() {
  const { id = "" } = useParams();
  const { tx } = useCopy();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["quotation", id],
    queryFn: async () => (await api<QuotationDetail>(QUOTATION_PATHS.detail(id))).data,
  });
  const customers = useCatalog<CustomerOption>("/api/v1/customers?pageSize=100");
  const update = useMutation({
    mutationFn: async (body: QuotationWriteBody & { version: number }) => {
      await api(QUOTATION_PATHS.detail(id), {
        method: "PUT",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      notifySuccess(tx("quotationUpdated", "Quotation updated."));
      void queryClient.invalidateQueries({ queryKey: ["quotation", id] });
      void queryClient.invalidateQueries({ queryKey: ["quotations"] });
      void navigate(`/quotations/${id}`);
    },
    onError: notifyError,
  });
  if (detail.isLoading) {
    return (
      <SkeletonRegion label={tx("loading", "Loading…")}>
        <SkeletonForm fields={6} />
      </SkeletonRegion>
    );
  }
  if (detail.isError || !detail.data) return <p className="text-sm text-danger">{tx("errorState", "Could not load the quotation.")}</p>;
  const quote = detail.data.quote;
  return (
    <QuotationForm
      heading={`${tx("quotationEdit", "Edit draft")} — ${quote.quote_number_display}`}
      submitLabel={tx("quotationUpdate", "Save changes")}
      customers={customers.data ?? []}
      pending={update.isPending}
      initial={{
        quoteNumber: quote.quote_number_display,
        customerId: quote.customer_id,
        title: quote.title ?? "",
        incoterm: quote.incoterm ?? "",
        validityDays: quote.validity_days,
        paymentTerms: quote.payment_terms ?? "",
        notes: quote.notes ?? "",
      }}
      onSubmit={(body) => update.mutate({ ...body, version: quote.version })}
    />
  );
}

type QuotationWriteBody = {
  quoteNumber: string;
  customerId: string;
  title: string;
  incoterm: string;
  validityDays: number;
  paymentTerms: string;
  notes: string;
  items: ItemDraft[];
};

const blankItem: ItemDraft = { description: "", quantity: "", unitLabel: "", unitPrice: "" };

const quotationDraftSchema = z.object({
  quoteNumber: z.string().trim().min(1).max(40).refine((value) => !/\s/.test(value)),
  customerId: z.string().min(1),
  title: z.string(),
  incoterm: z.string(),
  validityDays: z.number().int().min(1).max(365),
  paymentTerms: z.string(),
  notes: z.string(),
  items: z.array(z.object({
    description: z.string(),
    quantity: z.string(),
    unitLabel: z.string(),
    unitPrice: z.string(),
  })).superRefine((items, ctx) => {
    items.forEach((item, index) => {
      const started = item.description.trim() || item.quantity.trim() || item.unitPrice.trim() || item.unitLabel.trim();
      if (!started) return;
      if (!item.description.trim() || !item.quantity.trim() || !item.unitPrice.trim()) {
        ctx.addIssue({ code: "custom", message: "incomplete", path: [index, "description"] });
      }
    });
  }),
});

function QuotationForm({
  heading,
  submitLabel,
  customers,
  initial,
  pending,
  onSubmit,
}: {
  heading: string;
  submitLabel: string;
  customers: CustomerOption[];
  initial?: Partial<QuotationWriteBody>;
  pending: boolean;
  onSubmit: (body: QuotationWriteBody) => void;
}) {
  const { tx } = useCopy();
  const form = useForm<QuotationWriteBody>({
    resolver: zodResolver(quotationDraftSchema),
    defaultValues: {
      quoteNumber: initial?.quoteNumber ?? "",
      customerId: initial?.customerId ?? "",
      title: initial?.title ?? "",
      incoterm: initial?.incoterm ?? "FOB",
      validityDays: initial?.validityDays ?? 30,
      paymentTerms: initial?.paymentTerms ?? "",
      notes: initial?.notes ?? "",
      items: initial?.items ?? [blankItem],
    },
  });
  const items = useFieldArray({ control: form.control, name: "items" });
  const errors = form.formState.errors;

  return (
    <form
      className="space-y-4"
      data-testid="quotation-form"
      onSubmit={form.handleSubmit((values) => {
        onSubmit({
          quoteNumber: values.quoteNumber.trim(),
          customerId: values.customerId,
          title: values.title.trim(),
          incoterm: values.incoterm,
          validityDays: values.validityDays,
          paymentTerms: values.paymentTerms.trim(),
          notes: values.notes.trim(),
          items: values.items
            .filter((item) => item.description.trim() || item.quantity.trim() || item.unitPrice.trim())
            .map((item) => ({
              description: item.description.trim(),
              quantity: item.quantity.trim(),
              unitLabel: item.unitLabel.trim(),
              unitPrice: item.unitPrice.trim(),
            })),
        });
      })}
    >
      <h1 className="text-xl font-semibold tracking-tight">{heading}</h1>
      <div className="grid gap-3 rounded-card border border-line bg-card p-4 shadow-card md:grid-cols-2">
        <Field label={tx("quotationNumber", "Quote number")} hint={tx("required", "required")} error={errors.quoteNumber ? tx("quotationNumber", "Quote number") : undefined}>
          <Input {...form.register("quoteNumber")} dir="ltr" aria-invalid={errors.quoteNumber ? true : undefined} />
        </Field>
        <Field label={tx("quotationCustomer", "Customer")} hint={tx("required", "required")} error={errors.customerId ? tx("select", "Select") : undefined}>
          <Select {...form.register("customerId")}>
            <option value="">—</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.trade_name ? `${customer.trade_name} (${customer.legal_name})` : customer.legal_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tx("quotationTitle", "Title")}>
          <Input {...form.register("title")} />
        </Field>
        <Field label={tx("quotationIncoterm", "Incoterm")}>
          <Select {...form.register("incoterm")}>
            <option value="">—</option>
            {INCOTERMS.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tx("quotationValidityDays", "Validity (days)")} error={errors.validityDays ? tx("quotationValidityDays", "Validity (days)") : undefined}>
          <Input {...form.register("validityDays", { valueAsNumber: true })} inputMode="numeric" />
        </Field>
        <Field label={tx("quotationPaymentTerms", "Payment terms")}>
          <Input {...form.register("paymentTerms")} />
        </Field>
        <Field label={tx("quotationNotes", "Notes")}>
          <Textarea {...form.register("notes")} rows={2} />
        </Field>
      </div>

      <div className="rounded-card border border-line bg-card p-4 shadow-card">
        <h2 className="font-medium">{tx("quotationItems", "Items")}</h2>
        {items.fields.map((item, index) => (
          <div key={item.id} className="mt-2 grid gap-2 md:grid-cols-[1fr_120px_100px_120px_auto]">
            <Input
              {...form.register(`items.${index}.description`)}
              placeholder={tx("quotationItemDescription", "Description")}
              aria-label={tx("quotationItemDescription", "Description")}
              aria-invalid={errors.items?.[index]?.description ? true : undefined}
            />
            <Input
              {...form.register(`items.${index}.quantity`)}
              placeholder={tx("quotationItemQuantity", "Quantity")}
              aria-label={tx("quotationItemQuantity", "Quantity")}
              inputMode="decimal"
            />
            <Input
              {...form.register(`items.${index}.unitLabel`)}
              placeholder={tx("quotationItemUnit", "Unit")}
              aria-label={tx("quotationItemUnit", "Unit")}
            />
            <Input
              {...form.register(`items.${index}.unitPrice`)}
              placeholder={tx("quotationItemPrice", "Unit price")}
              aria-label={tx("quotationItemPrice", "Unit price")}
              inputMode="decimal"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={items.fields.length === 1}
              onClick={() => items.remove(index)}
              aria-label={tx("quotationRemoveItem", "Remove item")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => items.append(blankItem)}>
          <Plus className="h-4 w-4" />
          {tx("quotationAddItem", "Add item")}
        </Button>
        {errors.items?.length ? <p className="mt-2 text-sm text-danger">{tx("quotationItems", "Items")}</p> : null}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
