import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { EmptyState, Ltr, PageHeader } from "@/components/ui/chrome";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { CustomFieldInputs, CustomFieldsPanel, customFieldPayload } from "@/features/fields/CustomFieldsPanel";
import { api } from "@/lib/api";
import { useCopy } from "@/lib/copy";
import type { CustomFieldCatalogItem } from "@/features/fields/CustomFieldsPanel";

export function CustomersListPage() {
  const { tx } = useCopy();
  const q = new URLSearchParams(window.location.search).get("q") ?? "";
  const query = useQuery({
    queryKey: ["customers", q],
    queryFn: async () => (await api<Array<Record<string, string>>>(`/api/v1/customers?q=${encodeURIComponent(q)}`)).data,
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <PageHeader
          title={tx("customers", "Customers")}
          actions={<Button asChild><Link to="/customers/new">{tx("newCustomer", "New customer")}</Link></Button>}
        />
      </div>
      {query.isLoading ? <p>{tx("loadingCustomers", "Loading customers…")}</p> : null}
      {query.isError ? <p className="text-danger">{tx("customersError", "Could not load customers.")}</p> : null}
      {!query.isLoading && !query.data?.length ? <EmptyState>{tx("noCustomers", "No customers yet. Create one to start an export case.")}</EmptyState> : null}
      <div className="grid gap-3 md:hidden">
        {query.data?.map((row) => (
          <Link key={row.id} className="rounded-2xl border border-line bg-card p-4" to={`/customers/${row.id}`}>
            <p className="font-semibold">{row.legal_name}</p>
            <p className="text-sm text-ink-muted"><Ltr>{row.country_code || "—"}</Ltr></p>
          </Link>
        ))}
      </div>
      <div className="hidden overflow-auto rounded-xl border border-line bg-card md:block">
        <table className="w-full min-w-[640px] text-start text-sm">
          <thead className="bg-paper text-ink-muted">
            <tr>
              <th className="p-3 text-start">{tx("legalName", "Legal name")}</th>
              <th className="p-3 text-start">{tx("country", "Country")}</th>
              <th className="p-3 text-start">{tx("updated", "Updated")}</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="p-3">
                  <Link className="underline" to={`/customers/${row.id}`}>
                    {row.legal_name}
                  </Link>
                </td>
                <td className="p-3">{row.country_code || "—"}</td>
                <td className="p-3">{row.updated_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CustomerFormPage() {
  const { tx } = useCopy();
  const client = useQueryClient();
  const catalog = useQuery({
    queryKey: ["custom-field-catalog", "CUSTOMER"],
    queryFn: async () => (await api<CustomFieldCatalogItem[]>("/api/v1/custom-fields?targetEntity=CUSTOMER")).data,
  });
  const mutation = useMutation({
    mutationFn: async (form: FormData) =>
      api("/api/v1/customers", {
        method: "POST",
        body: JSON.stringify({
          customFields: customFieldPayload(form, catalog.data ?? []),
          legalName: form.get("legalName"),
          tradeName: form.get("tradeName"),
          countryCode: form.get("countryCode"),
          notes: form.get("notes"),
          taxId: form.get("taxId"),
          contacts: [
            { fullName: form.get("contactName"), phone: form.get("phone"), email: form.get("email"), isPrimary: true },
            ...(form.get("contactName2") ? [{ fullName: form.get("contactName2"), phone: form.get("phone2"), isPrimary: false }] : []),
          ],
          addresses: [
            { kind: form.get("addressKind"), line1: form.get("line1"), city: form.get("city"), countryCode: form.get("countryCode"), isPrimary: true },
            ...(form.get("line1b") ? [{ kind: "BILLING" as const, line1: form.get("line1b"), city: form.get("cityb"), countryCode: form.get("countryCode"), isPrimary: false }] : []),
          ],
          banks: form.get("bankName")
            ? [{ bankName: form.get("bankName"), accountNumber: form.get("accountNumber"), iban: form.get("iban"), swift: form.get("swift") }]
            : [],
        }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["customers"] });
      window.location.href = "/customers";
    },
  });
  return (
    <form
      className="mx-auto grid max-w-3xl gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(new FormData(event.currentTarget));
      }}
    >
      <PageHeader title={tx("newCustomer", "New customer")} />
      <div className="grid gap-3 rounded-xl border border-line bg-card p-4 md:grid-cols-2">
        <Field label={tx("legalName", "Legal name")}><Input name="legalName" required /></Field>
        <Field label={tx("tradeName", "Trade name")}><Input name="tradeName" /></Field>
        <Field label={tx("countryCode", "Country code")}><Input name="countryCode" placeholder="EG" dir="ltr" /></Field>
        <Field label={tx("taxReference", "Tax reference")}><Input name="taxId" dir="ltr" /></Field>
        <Field label={tx("notes", "Notes")}><Textarea name="notes" /></Field>
      </div>
      <div className="grid gap-3 rounded-xl border border-line bg-card p-4 md:grid-cols-2">
        <h2 className="md:col-span-2 font-medium">{tx("primaryContact", "Primary contact")}</h2>
        <Field label={tx("name", "Name")}><Input name="contactName" required /></Field>
        <Field label={tx("phone", "Phone")}><Input name="phone" dir="ltr" /></Field>
        <Field label={tx("email", "Email")}><Input name="email" type="email" dir="ltr" /></Field>
        <Field label={tx("secondContact", "Second contact")}><Input name="contactName2" /></Field>
        <Field label={tx("secondPhone", "Second phone")}><Input name="phone2" dir="ltr" /></Field>
      </div>
      <div className="grid gap-3 rounded-xl border border-line bg-card p-4 md:grid-cols-2">
        <h2 className="md:col-span-2 font-medium">{tx("address", "Address")}</h2>
        <Field label={tx("kind", "Kind")}>
          <Select name="addressKind" defaultValue="SHIPPING">
            <option>BILLING</option>
            <option>SHIPPING</option>
            <option>OTHER</option>
          </Select>
        </Field>
        <Field label={tx("line1", "Line 1")}><Input name="line1" required /></Field>
        <Field label={tx("city", "City")}><Input name="city" /></Field>
        <Field label={tx("billingAddress", "Billing address")}><Input name="line1b" /></Field>
        <Field label={tx("billingCity", "Billing city")}><Input name="cityb" /></Field>
      </div>
      <CustomFieldInputs target="CUSTOMER" />
      <div className="grid gap-3 rounded-xl border border-line bg-card p-4 md:grid-cols-2">
        <h2 className="md:col-span-2 font-medium">{tx("bankAccount", "Bank account (restricted)")}</h2>
        <Field label={tx("bankName", "Bank name")}><Input name="bankName" /></Field>
        <Field label={tx("accountNumber", "Account number")}><Input name="accountNumber" dir="ltr" /></Field>
        <Field label={tx("iban", "IBAN")}><Input name="iban" dir="ltr" /></Field>
        <Field label={tx("swift", "SWIFT")}><Input name="swift" dir="ltr" /></Field>
      </div>
      {mutation.isError ? <p className="text-danger">{tx("customerSaveError", "Could not save customer. Bank fields require bank-details permission.")}</p> : null}
      <Button type="submit" disabled={mutation.isPending}>{tx("saveCustomer", "Save customer")}</Button>
    </form>
  );
}

export function CustomerDetailPage() {
  const { tx } = useCopy();
  const { id } = useParams();
  const query = useQuery({
    queryKey: ["customer", id],
    queryFn: async () => (await api<{
      customer: Record<string, string>;
      contacts: Array<Record<string, string>>;
      addresses: Array<Record<string, string>>;
      banks: Array<Record<string, string>>;
      cases: Array<Record<string, string>>;
    }>(`/api/v1/customers/${id}`)).data,
  });
  if (query.isLoading) return <p>{tx("loadingCustomer", "Loading customer…")}</p>;
  if (!query.data) return <p className="text-danger">{tx("customerMissing", "Customer not found.")}</p>;
  const { customer, contacts, addresses, banks, cases } = query.data;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{customer.legal_name}</h1>
      <p className="text-ink-muted">{customer.trade_name} · <Ltr>{customer.country_code}</Ltr> · {tx("taxReference", "Tax reference")} <Ltr>{customer.tax_id || "—"}</Ltr></p>
      <section className="rounded-xl border border-line bg-card p-4">
        <h2 className="mb-2 font-medium">{tx("contacts", "Contacts")}</h2>
        {contacts.map((c) => <p key={c.id}>{c.full_name} · {c.phone} · {c.email}</p>)}
      </section>
      <section className="rounded-xl border border-line bg-card p-4">
        <h2 className="mb-2 font-medium">{tx("addresses", "Addresses")}</h2>
        {addresses.map((a) => <p key={a.id}>{a.kind}: {a.line1}, {a.city}</p>)}
      </section>
      <section className="rounded-xl border border-line bg-card p-4">
        <h2 className="mb-2 font-medium">{tx("bankAccounts", "Bank accounts")}</h2>
        {banks.length === 0 ? <p className="text-ink-muted">{tx("bankHidden", "Hidden or none. Bank identifiers are permission-gated.")}</p> : banks.map((b) => <p key={b.id}>{b.bank_name} · <Ltr>{`last4 ${b.account_number_last4}`}</Ltr> · SWIFT <Ltr>{b.swift}</Ltr></p>)}
      </section>
      <CustomFieldsPanel endpoint={`/api/v1/customers/${id}/custom-fields`} />
      <section className="rounded-xl border border-line bg-card p-4">
        <h2 className="mb-2 font-medium">{tx("exportHistory", "Export history")}</h2>
        {cases.map((item) => (
          <p key={item.id}><Link className="underline" to={`/export-cases/${item.id}`}>{item.case_reference}</Link> · {item.status}</p>
        ))}
      </section>
    </div>
  );
}
