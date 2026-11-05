import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark } from "lucide-react";
import { useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { AlertText, PageHeader, SectionCard } from "@/components/ui/chrome";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { CustomFieldInputs, customFieldPayload } from "@/features/fields/CustomFieldsPanel";
import { api } from "@/lib/api";
import { useCopy } from "@/lib/copy";
import { isDefinitiveFailure, useIdempotencyKey, useSubmitLock } from "@/lib/idempotency";
import { notifyError, notifySuccess } from "@/lib/notify";
import type { CustomFieldCatalogItem } from "@/features/fields/CustomFieldsPanel";

const customerDraftSchema = z.object({
  legalName: z.string().trim().min(1),
  customerCode: z.string(),
  tradeName: z.string(),
  countryCode: z.string(),
  taxId: z.string(),
  notes: z.string(),
  contactName: z.string().trim().min(1),
  phone: z.string(),
  email: z.union([z.literal(""), z.string().email()]),
  contactName2: z.string(),
  phone2: z.string(),
  addressKind: z.enum(["BILLING", "SHIPPING", "OTHER"]),
  line1: z.string().trim().min(1),
  city: z.string(),
  line1b: z.string(),
  cityb: z.string(),
  bankName: z.string(),
  accountNumber: z.string(),
  iban: z.string(),
  swift: z.string(),
});

type CustomerDraft = z.infer<typeof customerDraftSchema>;

export function CustomerFormPage() {
  const { tx } = useCopy();
  const client = useQueryClient();
  const navigate = useNavigate();
  const catalog = useQuery({
    queryKey: ["custom-field-catalog", "CUSTOMER"],
    queryFn: async () => (await api<CustomFieldCatalogItem[]>("/api/v1/custom-fields?targetEntity=CUSTOMER")).data,
    refetchInterval: false,
  });
  const { key, reset: resetKey } = useIdempotencyKey();
  const submitLock = useSubmitLock();
  const formElement = useRef<HTMLFormElement>(null);
  const form = useForm<CustomerDraft>({
    resolver: zodResolver(customerDraftSchema),
    defaultValues: {
      legalName: "",
      customerCode: "",
      tradeName: "",
      countryCode: "",
      taxId: "",
      notes: "",
      contactName: "",
      phone: "",
      email: "",
      contactName2: "",
      phone2: "",
      addressKind: "SHIPPING",
      line1: "",
      city: "",
      line1b: "",
      cityb: "",
      bankName: "",
      accountNumber: "",
      iban: "",
      swift: "",
    },
  });
  const mutation = useMutation({
    mutationFn: async (input: { values: CustomerDraft; fields: FormData }) =>
      api("/api/v1/customers", {
        method: "POST",
        idempotencyKey: key.current,
        body: JSON.stringify({
          customFields: customFieldPayload(input.fields, catalog.data ?? []),
          legalName: input.values.legalName,
          customerCode: input.values.customerCode,
          tradeName: input.values.tradeName,
          countryCode: input.values.countryCode,
          notes: input.values.notes,
          taxId: input.values.taxId,
          contacts: [
            { fullName: input.values.contactName, phone: input.values.phone, email: input.values.email, isPrimary: true },
            ...(input.values.contactName2 ? [{ fullName: input.values.contactName2, phone: input.values.phone2, isPrimary: false }] : []),
          ],
          addresses: [
            { kind: input.values.addressKind, line1: input.values.line1, city: input.values.city, countryCode: input.values.countryCode, isPrimary: true },
            ...(input.values.line1b ? [{ kind: "BILLING" as const, line1: input.values.line1b, city: input.values.cityb, countryCode: input.values.countryCode, isPrimary: false }] : []),
          ],
          banks: input.values.bankName
            ? [{ bankName: input.values.bankName, accountNumber: input.values.accountNumber, iban: input.values.iban, swift: input.values.swift }]
            : [],
        }),
      }),
    onSuccess: async (_data, variables) => {
      resetKey();
      notifySuccess(tx("customerCreated", "Customer created"), variables.values.legalName);
      await client.invalidateQueries({ queryKey: ["customers"] });
      void navigate("/customers");
    },
    onError: (error) => {
      if (isDefinitiveFailure(error)) resetKey();
      notifyError(error);
    },
    onSettled: () => submitLock.release(),
  });
  const errors = form.formState.errors;
  return (
    <form
      ref={formElement}
      className="mx-auto grid max-w-3xl gap-4"
      onSubmit={form.handleSubmit((values) => {
        const formEl = formElement.current;
        if (!formEl) return;
        if (!submitLock.acquire()) return;
        mutation.mutate({ values, fields: new FormData(formEl) });
      })}
    >
      <PageHeader title={tx("newCustomer", "New customer")} subtitle={tx("newCustomerHint", "Save the legal name and primary contact first; addresses and bank details can be added without blocking the case.")} />
      <SectionCard title={tx("identity", "Identity")}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={tx("legalName", "Legal name")} error={errors.legalName ? tx("required", "required") : undefined}><Input {...form.register("legalName")} /></Field>
          <Field label={tx("customerCode", "Customer code")}><Input {...form.register("customerCode")} dir="ltr" /></Field>
          <Field label={tx("tradeName", "Trade name")}><Input {...form.register("tradeName")} /></Field>
          <Field label={tx("countryCode", "Country code")}><Input {...form.register("countryCode")} placeholder="EG" dir="ltr" /></Field>
          <Field label={tx("taxReference", "Tax reference")}><Input {...form.register("taxId")} dir="ltr" /></Field>
          <div className="md:col-span-2">
            <Field label={tx("notes", "Notes")}><Textarea {...form.register("notes")} /></Field>
          </div>
        </div>
      </SectionCard>
      <SectionCard title={tx("primaryContact", "Primary contact")}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={tx("name", "Name")} error={errors.contactName ? tx("required", "required") : undefined}><Input {...form.register("contactName")} /></Field>
          <Field label={tx("phone", "Phone")}><Input {...form.register("phone")} dir="ltr" /></Field>
          <Field label={tx("email", "Email")} error={errors.email ? tx("email", "Email") : undefined}><Input {...form.register("email")} type="email" dir="ltr" /></Field>
          <Field label={tx("secondContact", "Second contact")}><Input {...form.register("contactName2")} /></Field>
          <Field label={tx("secondPhone", "Second phone")}><Input {...form.register("phone2")} dir="ltr" /></Field>
        </div>
      </SectionCard>
      <SectionCard title={tx("address", "Address")}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={tx("kind", "Kind")}>
            <Select {...form.register("addressKind")}>
              <option>BILLING</option>
              <option>SHIPPING</option>
              <option>OTHER</option>
            </Select>
          </Field>
          <Field label={tx("line1", "Line 1")} error={errors.line1 ? tx("required", "required") : undefined}><Input {...form.register("line1")} /></Field>
          <Field label={tx("city", "City")}><Input {...form.register("city")} /></Field>
          <Field label={tx("billingAddress", "Billing address")}><Input {...form.register("line1b")} /></Field>
          <Field label={tx("billingCity", "Billing city")}><Input {...form.register("cityb")} /></Field>
        </div>
      </SectionCard>
      <CustomFieldInputs target="CUSTOMER" />
      <SectionCard title={tx("bankAccount", "Bank account (restricted)")} icon={<Landmark className="h-4 w-4" />}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={tx("bankName", "Bank name")}><Input {...form.register("bankName")} /></Field>
          <Field label={tx("accountNumber", "Account number")}><Input {...form.register("accountNumber")} dir="ltr" /></Field>
          <Field label={tx("iban", "IBAN")}><Input {...form.register("iban")} dir="ltr" /></Field>
          <Field label={tx("swift", "SWIFT")}><Input {...form.register("swift")} dir="ltr" /></Field>
        </div>
      </SectionCard>
      {catalog.isError ? <AlertText>{tx("customFieldsError", "Could not load custom fields. The customer can still be saved.")}</AlertText> : null}
      {mutation.isError ? <AlertText>{tx("customerSaveError", "Could not save customer. Bank fields require bank-details permission.")}</AlertText> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={mutation.isPending || submitLock.busy}>{tx("saveCustomer", "Save customer")}</Button>
      </div>
    </form>
  );
}
