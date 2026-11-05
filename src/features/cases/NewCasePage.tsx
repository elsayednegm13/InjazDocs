import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useNavigate, useSearchParams } from "react-router";
import { commercialInvoiceTotal } from "@shared/money";
import { Button } from "@/components/ui/button";
import { AlertText, PageHeader } from "@/components/ui/chrome";
import { Field, Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { isDefinitiveFailure, useIdempotencyKey, useSubmitLock } from "@/lib/idempotency";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";

const caseDraftSchema = z.object({
  customerId: z.string().min(1),
  documentRoute: z.enum(["DIRECT_ROUTE", "BANK_ROUTE"]),
  destinationCountry: z.string(),
  templateId: z.string(),
  invoiceNumber: z.string(),
  invoiceDate: z.string(),
  incoterm: z.string(),
  namedPlace: z.string(),
  paymentTermCode: z.string(),
  paymentTermDetails: z.string(),
  currency: z.string(),
  goodsValue: z.string(),
  invoicedFreight: z.string(),
  actualFreightExpense: z.string(),
  invoiceTotal: z.string(),
  portOfLoading: z.string(),
  portOfDischarge: z.string(),
  grossWeight: z.string(),
  netWeight: z.string(),
});

type CaseDraft = z.infer<typeof caseDraftSchema>;

export function NewCasePage() {
  const { tx, fail } = useCopy();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [params] = useSearchParams();
  const bookingId = params.get("bookingId") ?? "";
  const linkedBooking = useQuery({
    queryKey: ["booking", bookingId],
    enabled: Boolean(bookingId),
    queryFn: async () => (await api<{ booking: Record<string, string | null> }>(`/api/v1/bookings/${bookingId}`)).data,
  });
  const customers = useQuery({
    queryKey: ["customers"],
    queryFn: async () => (await api<Array<Record<string, string>>>("/api/v1/customers?pageSize=100")).data,
  });
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await api<Array<Record<string, unknown>>>("/api/v1/document-templates")).data,
    refetchInterval: false,
  });
  const { key, reset: resetKey } = useIdempotencyKey();
  const submitLock = useSubmitLock();
  const form = useForm<CaseDraft>({
    resolver: zodResolver(caseDraftSchema),
    defaultValues: {
      customerId: params.get("customerId") ?? "",
      documentRoute: "DIRECT_ROUTE",
      destinationCountry: "",
      templateId: "",
      invoiceNumber: "",
      invoiceDate: "",
      incoterm: "FOB",
      namedPlace: "",
      paymentTermCode: "TT",
      paymentTermDetails: "",
      currency: "USD",
      goodsValue: "",
      invoicedFreight: "",
      actualFreightExpense: "",
      invoiceTotal: "",
      portOfLoading: "",
      portOfDischarge: "",
      grossWeight: "",
      netWeight: "",
    },
  });
  const goodsValue = form.watch("goodsValue");
  const invoicedFreight = form.watch("invoicedFreight");
  const currency = form.watch("currency");
  const computedTotal = commercialInvoiceTotal(goodsValue, invoicedFreight, currency || "USD");
  useEffect(() => {
    const booking = linkedBooking.data?.booking;
    if (!booking) return;
    if (!form.getValues("portOfLoading") && booking.port_of_loading) form.setValue("portOfLoading", booking.port_of_loading);
    if (!form.getValues("portOfDischarge") && booking.port_of_discharge) form.setValue("portOfDischarge", booking.port_of_discharge);
  }, [linkedBooking.data, form]);
  const mutation = useMutation({
    mutationFn: async (values: CaseDraft) => {
      const created = await api<{ id: string }>("/api/v1/export-cases", {
        method: "POST",
        idempotencyKey: key.current,
        body: JSON.stringify({
          customerId: values.customerId,
          documentRoute: values.documentRoute,
          destinationCountry: values.destinationCountry,
          templateId: values.templateId || undefined,
          invoice: values.invoiceNumber
            ? {
                invoiceNumber: values.invoiceNumber,
                invoiceDate: values.invoiceDate,
                paymentTermCode: values.paymentTermCode,
                paymentTermDetails: values.paymentTermDetails,
                incoterm: values.incoterm,
                namedPlace: values.namedPlace,
                currency: values.currency,
                goodsValue: values.goodsValue,
                invoicedFreight: values.invoicedFreight || "0",
                actualFreightExpense: values.actualFreightExpense || "0",
                invoiceTotal: commercialInvoiceTotal(values.goodsValue, values.invoicedFreight, values.currency || "USD"),
                portOfLoading: values.portOfLoading,
                portOfDischarge: values.portOfDischarge,
                grossWeight: Number(values.grossWeight),
                netWeight: Number(values.netWeight),
                weightUnit: "KG",
              }
            : undefined,
        }),
      });
      if (bookingId) {
        await api(`/api/v1/bookings/${bookingId}/link`, {
          method: "POST",
          body: JSON.stringify({ caseId: created.data.id }),
        });
      }
      return created;
    },
    onSuccess: async (res) => {
      resetKey();
      notifySuccess(tx("caseCreated", "Export case created"));
      await client.invalidateQueries({ queryKey: ["cases"] });
      await client.invalidateQueries({ queryKey: ["bookings"] });
      await client.invalidateQueries({ queryKey: ["dashboard"] });
      void navigate(`/export-cases/${res.data.id}`);
    },
    onError: (error) => {
      if (isDefinitiveFailure(error)) resetKey();
      notifyError(error);
    },
    onSettled: () => submitLock.release(),
  });
  return (
    <form
      className="mx-auto grid max-w-4xl gap-4"
      onSubmit={form.handleSubmit((values) => {
        if (!submitLock.acquire()) return;
        mutation.mutate(values);
      })}
    >
      <PageHeader title={tx("newCase", "New export case")} subtitle={tx("newCaseHint", "Save a draft as soon as the customer is known. The invoice total is goods plus the freight written on the invoice.")} />
      {bookingId ? (
        <p className="rounded-card border border-accent/30 bg-accent/[0.06] px-4 py-3 text-sm text-ink">
          {tx("createCaseAndLink", "Create the export case and link this booking")}
          {linkedBooking.data?.booking?.booking_number ? <span className="ms-2 font-semibold" dir="ltr">{linkedBooking.data.booking.booking_number}</span> : null}
        </p>
      ) : null}
      <section className="grid gap-3 rounded-card border border-line bg-card p-4 shadow-card md:grid-cols-2">
        <Field label={tx("customer", "Customer")} error={form.formState.errors.customerId ? tx("select", "Select") : undefined}>
          {customers.isLoading ? (
            <Skeleton className="h-10 w-full rounded-lg" />
          ) : (
            <Select {...form.register("customerId")}>
              <option value="">{tx("select", "Select")}</option>
              {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.customer_code ? `${c.customer_code} · ${c.legal_name}` : c.legal_name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={tx("documentRoute", "Document route")}>
          <Select {...form.register("documentRoute")}>
            <option value="DIRECT_ROUTE">{tx("directCourier", "Direct courier")}</option>
            <option value="BANK_ROUTE">{tx("bankRoute", "Bank route")}</option>
          </Select>
        </Field>
        <Field label={tx("destinationCountry", "Destination country")}><Input {...form.register("destinationCountry")} dir="ltr" /></Field>
        <Field label={tx("documentTemplate", "Document template")}>
          <Select {...form.register("templateId")}>
            <option value="">{tx("defaultTemplate", "Default")}</option>
            {templates.data?.map((t) => <option key={String(t.id)} value={String(t.id)}>{String(t.name_en)}</option>)}
          </Select>
        </Field>
      </section>
      <section className="grid gap-3 rounded-card border border-line bg-card p-4 shadow-card md:grid-cols-2">
        <h2 className="md:col-span-2 font-medium">{tx("commercialInvoice", "Commercial invoice (optional at draft)")}</h2>
        <Field label={tx("invoiceNumber", "Invoice number")}><Input {...form.register("invoiceNumber")} dir="ltr" /></Field>
        <Field label={tx("invoiceDate", "Invoice date")}><Input {...form.register("invoiceDate")} type="date" dir="ltr" /></Field>
        <Field label={tx("incoterm", "Incoterm")}>
          <Select {...form.register("incoterm")}>
            <option>FOB</option>
            <option>CFR</option>
          </Select>
        </Field>
        <Field label={tx("namedPlace", "Named place / port")}><Input {...form.register("namedPlace")} /></Field>
        <Field label={tx("paymentTerms", "Payment terms")}>
          <Select {...form.register("paymentTermCode")}>
            <option value="TT">T/T</option>
            <option value="LC">L/C</option>
            <option value="DP">D/P</option>
            <option value="DA">D/A</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field label={tx("paymentDetails", "Payment details")}><Input {...form.register("paymentTermDetails")} /></Field>
        <Field label={tx("currency", "Currency")}><Input {...form.register("currency")} dir="ltr" /></Field>
        <Field label={tx("goodsValue", "Goods value")}><Input {...form.register("goodsValue")} placeholder="0.00" dir="ltr" inputMode="decimal" /></Field>
        <Field label={tx("invoicedFreight", "Invoiced freight (CFR only)")}><Input {...form.register("invoicedFreight")} placeholder="0.00" dir="ltr" inputMode="decimal" /></Field>
        <Field label={tx("actualFreight", "Actual freight expense")}><Input {...form.register("actualFreightExpense")} placeholder="0.00" dir="ltr" inputMode="decimal" /></Field>
        <Field label={tx("invoiceTotal", "Invoice total")}><Input name="invoiceTotal" readOnly value={computedTotal} placeholder="0.00" dir="ltr" /></Field>
        <p className="md:col-span-2 text-xs text-ink-muted">{tx("commercialTotalHint", "The commercial total is goods plus the freight written on the invoice. Actual freight is an internal cost and is not added. On FOB, leave invoiced freight at zero.")}</p>
        <Field label={tx("portOfLoading", "Port of loading")}><Input {...form.register("portOfLoading")} /></Field>
        <Field label={tx("portOfDischarge", "Port of discharge")}><Input {...form.register("portOfDischarge")} /></Field>
        <Field label={tx("grossWeight", "Gross weight (kg)")}><Input {...form.register("grossWeight")} type="number" step="0.001" dir="ltr" /></Field>
        <Field label={tx("netWeight", "Net weight (kg)")}><Input {...form.register("netWeight")} type="number" step="0.001" dir="ltr" /></Field>
      </section>
      {customers.isError ? <AlertText>{tx("customersError", "Could not load customers.")}</AlertText> : null}
      {mutation.isError ? <AlertText>{fail(mutation.error)}</AlertText> : null}
      <Button type="submit" disabled={mutation.isPending || submitLock.busy || customers.isLoading}>{tx("createDraft", "Create draft case")}</Button>
    </form>
  );
}
