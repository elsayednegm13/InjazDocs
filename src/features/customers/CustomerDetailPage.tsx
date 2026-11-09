import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, FilePlus, FolderOpen, Landmark, Mail, MapPin, Pencil, Phone, Users } from "lucide-react";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { Link, useParams } from "react-router";
import { can, useSession } from "@/app/access";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { AlertText, EmptyState, Ltr, SectionCard, StatCard } from "@/components/ui/chrome";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status";
import { PageSkeleton } from "@/components/ui/skeleton";
import { CustomFieldsPanel } from "@/features/fields/CustomFieldsPanel";
import { api } from "@/lib/api";
import { formatWhen, useCopy } from "@/lib/copy";
import { notifyError, notifySuccess } from "@/lib/notify";

const blank = z.string();
const customerProfileSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  customerCode: blank,
  tradeName: blank,
  countryCode: blank,
  taxId: blank,
  notes: blank,
  contacts: z.array(z.object({
    fullName: blank,
    title: blank,
    phone: blank,
    email: blank,
    isPrimary: z.boolean(),
  })).max(20),
  addresses: z.array(z.object({
    kind: z.enum(["BILLING", "SHIPPING", "OTHER"]),
    line1: blank,
    line2: blank,
    city: blank,
    region: blank,
    postalCode: blank,
    countryCode: blank,
    isPrimary: z.boolean(),
  })).max(20),
  banks: z.array(z.object({
    id: blank,
    bankName: blank,
    accountName: blank,
    accountNumber: blank,
    iban: blank,
    swift: blank,
    accountEnding: blank,
    ibanEnding: blank,
  })).max(10),
}).superRefine((value, ctx) => {
  value.contacts.forEach((contact, index) => {
    const used = [contact.fullName, contact.title, contact.phone, contact.email].some((part) => part.trim());
    if (!used) return;
    if (!contact.fullName.trim()) ctx.addIssue({ code: "custom", path: ["contacts", index, "fullName"], message: "required" });
    if (contact.email.trim() && !z.string().email().safeParse(contact.email.trim()).success) {
      ctx.addIssue({ code: "custom", path: ["contacts", index, "email"], message: "email" });
    }
  });
  value.addresses.forEach((address, index) => {
    const used = [address.line1, address.line2, address.city, address.region, address.postalCode, address.countryCode].some((part) => part.trim());
    if (!used) return;
    if (!address.line1.trim()) ctx.addIssue({ code: "custom", path: ["addresses", index, "line1"], message: "required" });
  });
  value.banks.forEach((bank, index) => {
    const used = [bank.bankName, bank.accountName, bank.accountNumber, bank.iban, bank.swift].some((part) => part.trim()) || bank.id.trim();
    if (!used) return;
    if (!bank.bankName.trim()) ctx.addIssue({ code: "custom", path: ["banks", index, "bankName"], message: "required" });
  });
});

type CustomerProfile = z.infer<typeof customerProfileSchema>;

export function CustomerDetailPage() {
  const { tx, i18n } = useCopy();
  const user = useSession();
  const { id } = useParams();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const query = useQuery({
    queryKey: ["customer", id],
    queryFn: async () => (await api<{
      customer: {
        legal_name: string;
        customer_code: string | null;
        trade_name: string | null;
        country_code: string | null;
        tax_id: string | null;
        notes: string | null;
        updated_at: string;
        version: number;
      };
      contacts: Array<Record<string, string>>;
      addresses: Array<Record<string, string>>;
      banks: Array<Record<string, string>>;
      cases: Array<Record<string, string>>;
    }>(`/api/v1/customers/${id}`)).data,
  });
  const form = useForm<CustomerProfile>({
    resolver: zodResolver(customerProfileSchema),
    defaultValues: emptyProfile(),
  });
  const contactRows = useFieldArray({ control: form.control, name: "contacts" });
  const addressRows = useFieldArray({ control: form.control, name: "addresses" });
  const bankRows = useFieldArray({ control: form.control, name: "banks" });
  const canEditBanks = can(user, "customers.bank_details.edit");
  const mutation = useMutation({
    mutationFn: async (values: CustomerProfile) => {
      const version = Number(query.data?.customer.version);
      const contacts = values.contacts
        .filter((contact) => [contact.fullName, contact.title, contact.phone, contact.email].some((part) => part.trim()))
        .map((contact) => ({
          fullName: contact.fullName,
          title: contact.title,
          phone: contact.phone,
          email: contact.email,
          isPrimary: contact.isPrimary,
        }));
      const addresses = values.addresses
        .filter((address) => [address.line1, address.line2, address.city, address.region, address.postalCode, address.countryCode].some((part) => part.trim()))
        .map((address) => ({
          kind: address.kind,
          line1: address.line1,
          line2: address.line2,
          city: address.city,
          region: address.region,
          postalCode: address.postalCode,
          countryCode: address.countryCode,
          isPrimary: address.isPrimary,
        }));
      const banks = canEditBanks
        ? values.banks
            .filter((bank) => [bank.bankName, bank.accountName, bank.accountNumber, bank.iban, bank.swift].some((part) => part.trim()) || bank.id.trim())
            .map((bank) => ({
              id: bank.id,
              bankName: bank.bankName,
              accountName: bank.accountName,
              accountNumber: bank.accountNumber,
              iban: bank.iban,
              swift: bank.swift,
            }))
        : undefined;
      return api(`/api/v1/customers/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          legalName: values.legalName,
          customerCode: values.customerCode,
          tradeName: values.tradeName,
          countryCode: values.countryCode,
          taxId: values.taxId,
          notes: values.notes,
          contacts,
          addresses,
          ...(banks ? { banks } : {}),
          version,
        }),
      });
    },
    onSuccess: async () => {
      notifySuccess(tx("customerUpdated", "Customer profile saved"));
      setEditing(false);
      await client.invalidateQueries({ queryKey: ["customer", id] });
      await client.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (error) => notifyError(error),
  });
  if (query.isLoading) return <PageSkeleton cards={3} rows={4} />;
  if (!query.data) return <p className="text-danger">{tx("customerMissing", "Customer not found.")}</p>;
  const { customer, contacts, addresses, banks, cases } = query.data;
  const profileErrors = form.formState.errors;
  function beginEdit() {
    form.reset({
      legalName: customer.legal_name ?? "",
      customerCode: String(customer.customer_code ?? ""),
      tradeName: customer.trade_name ?? "",
      countryCode: customer.country_code ?? "",
      taxId: customer.tax_id ?? "",
      notes: customer.notes ?? "",
      contacts: contacts.length
        ? contacts.map((contact) => ({
            fullName: String(contact.full_name ?? ""),
            title: String(contact.title ?? ""),
            phone: String(contact.phone ?? ""),
            email: String(contact.email ?? ""),
            isPrimary: isPrimary(contact.is_primary),
          }))
        : [{ fullName: "", title: "", phone: "", email: "", isPrimary: true }],
      addresses: addresses.length
        ? addresses.map((address) => ({
            kind: (address.kind === "BILLING" || address.kind === "OTHER" ? address.kind : "SHIPPING") as "BILLING" | "SHIPPING" | "OTHER",
            line1: String(address.line1 ?? ""),
            line2: String(address.line2 ?? ""),
            city: String(address.city ?? ""),
            region: String(address.region ?? ""),
            postalCode: String(address.postal_code ?? ""),
            countryCode: String(address.country_code ?? ""),
            isPrimary: isPrimary(address.is_primary),
          }))
        : [{ kind: "SHIPPING", line1: "", line2: "", city: "", region: "", postalCode: "", countryCode: "", isPrimary: true }],
      banks: banks.map((bank) => ({
        id: String(bank.id ?? ""),
        bankName: String(bank.bank_name ?? ""),
        accountName: String(bank.account_name ?? ""),
        accountNumber: String(bank.account_number ?? bank.account_number_last4 ?? ""),
        iban: String(bank.iban ?? bank.iban_last4 ?? ""),
        swift: String(bank.swift ?? ""),
        accountEnding: String(bank.account_number_last4 ?? ""),
        ibanEnding: String(bank.iban_last4 ?? ""),
      })),
    });
    setEditing(true);
  }
  const openCases = cases.filter((item) => !["COMPLETED", "CANCELLED", "ARCHIVED"].includes(item.status)).length;
  return (
    <div className="space-y-4" data-customer="ready">
      <section className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        <div className="flex flex-wrap items-start gap-4 p-4">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-card bg-accent-2 text-white">
            <Building2 className="h-7 w-7" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold tracking-tight text-ink">
              {customer.customer_code ? <Ltr className="me-2 text-accent">{String(customer.customer_code)}</Ltr> : null}
              {customer.legal_name}
            </h1>
            {customer.trade_name ? <p className="mt-0.5 text-sm text-ink-muted">{customer.trade_name}</p> : null}
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold text-ink-muted">
              {customer.country_code ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-paper px-2.5 py-1">
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  <Ltr>{customer.country_code}</Ltr>
                </span>
              ) : null}
              {customer.tax_id ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-paper px-2.5 py-1">
                  {tx("taxReference", "Tax reference")}
                  <Ltr>{customer.tax_id}</Ltr>
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1 rounded-full bg-paper px-2.5 py-1">
                {tx("updated", "Updated")}
                <Ltr>{formatWhen(customer.updated_at, i18n.language)}</Ltr>
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {can(user, "customers.edit") ? (
              <Button type="button" variant="outline" onClick={() => (editing ? setEditing(false) : beginEdit())}>
                <Pencil className="me-1.5 h-4 w-4" aria-hidden />
                {editing ? tx("cancel", "Cancel") : tx("editProfile", "Edit profile")}
              </Button>
            ) : null}
            {can(user, "export_cases.create") ? (
              <Button asChild>
                <Link to={`/export-cases/new?customerId=${id}`}>
                  <FilePlus className="me-1.5 h-4 w-4" aria-hidden />
                  {tx("newCase", "New export case")}
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
        <Reveal open={editing}>
          <form
            className="grid gap-3 border-t border-line bg-paper/40 p-4 md:grid-cols-2"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          >
            <Field label={tx("legalName", "Legal name")} error={profileErrors.legalName ? tx("required", "required") : undefined}>
              <Input {...form.register("legalName")} />
            </Field>
            <Field label={tx("customerCode", "Customer code")}>
              <Input {...form.register("customerCode")} dir="ltr" />
            </Field>
            <Field label={tx("tradeName", "Trade name")}>
              <Input {...form.register("tradeName")} />
            </Field>
            <Field label={tx("countryCode", "Country code")}>
              <Input {...form.register("countryCode")} placeholder="EG" dir="ltr" />
            </Field>
            <Field label={tx("taxReference", "Tax reference")}>
              <Input {...form.register("taxId")} dir="ltr" />
            </Field>
            <div className="md:col-span-2">
              <Field label={tx("notes", "Notes")}>
                <Textarea {...form.register("notes")} />
              </Field>
            </div>
            <div className="md:col-span-2 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">{tx("contacts", "Contacts")}</h2>
                <Button type="button" size="sm" variant="outline" onClick={() => contactRows.append({ fullName: "", title: "", phone: "", email: "", isPrimary: contactRows.fields.length === 0 })}>{tx("addContact", "Add contact")}</Button>
              </div>
              {contactRows.fields.map((field, index) => (
                <div key={field.id} className="grid gap-3 rounded-control border border-line bg-card p-3 md:grid-cols-2">
                  <Field label={tx("name", "Name")} error={profileErrors.contacts?.[index]?.fullName ? tx("required", "required") : undefined}>
                    <Input {...form.register(`contacts.${index}.fullName`)} />
                  </Field>
                  <Field label={tx("contactTitle", "Title")}><Input {...form.register(`contacts.${index}.title`)} /></Field>
                  <Field label={tx("phone", "Phone")}><Input {...form.register(`contacts.${index}.phone`)} dir="ltr" /></Field>
                  <Field label={tx("email", "Email")} error={profileErrors.contacts?.[index]?.email ? tx("email", "Email") : undefined}>
                    <Input {...form.register(`contacts.${index}.email`)} type="email" dir="ltr" />
                  </Field>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" className="h-4 w-4 accent-accent" {...form.register(`contacts.${index}.isPrimary`)} />
                    {tx("primary", "Primary")}
                  </label>
                  <div className="flex justify-end">
                    <Button type="button" size="sm" variant="outline" onClick={() => contactRows.remove(index)}>{tx("removeRow", "Remove")}</Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="md:col-span-2 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">{tx("addresses", "Addresses")}</h2>
                <Button type="button" size="sm" variant="outline" onClick={() => addressRows.append({ kind: "SHIPPING", line1: "", line2: "", city: "", region: "", postalCode: "", countryCode: customer.country_code ?? "", isPrimary: addressRows.fields.length === 0 })}>{tx("addAddress", "Add address")}</Button>
              </div>
              {addressRows.fields.map((field, index) => (
                <div key={field.id} className="grid gap-3 rounded-control border border-line bg-card p-3 md:grid-cols-2">
                  <Field label={tx("kind", "Kind")}>
                    <Select {...form.register(`addresses.${index}.kind`)}>
                      <option value="SHIPPING">{tx("addressKind.SHIPPING", "Shipping")}</option>
                      <option value="BILLING">{tx("addressKind.BILLING", "Billing")}</option>
                      <option value="OTHER">{tx("addressKind.OTHER", "Other")}</option>
                    </Select>
                  </Field>
                  <Field label={tx("line1", "Line 1")} error={profileErrors.addresses?.[index]?.line1 ? tx("required", "required") : undefined}>
                    <Input {...form.register(`addresses.${index}.line1`)} />
                  </Field>
                  <Field label={tx("line2", "Line 2")}><Input {...form.register(`addresses.${index}.line2`)} /></Field>
                  <Field label={tx("city", "City")}><Input {...form.register(`addresses.${index}.city`)} /></Field>
                  <Field label={tx("region", "Region")}><Input {...form.register(`addresses.${index}.region`)} /></Field>
                  <Field label={tx("postalCode", "Postal code")}><Input {...form.register(`addresses.${index}.postalCode`)} dir="ltr" /></Field>
                  <Field label={tx("countryCode", "Country code")}><Input {...form.register(`addresses.${index}.countryCode`)} dir="ltr" /></Field>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" className="h-4 w-4 accent-accent" {...form.register(`addresses.${index}.isPrimary`)} />
                    {tx("primary", "Primary")}
                  </label>
                  <div className="flex justify-end md:col-span-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => addressRows.remove(index)}>{tx("removeRow", "Remove")}</Button>
                  </div>
                </div>
              ))}
            </div>
            {canEditBanks ? (
              <div className="md:col-span-2 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-ink">{tx("bankAccounts", "Bank accounts")}</h2>
                  <Button type="button" size="sm" variant="outline" onClick={() => bankRows.append({ id: "", bankName: "", accountName: "", accountNumber: "", iban: "", swift: "", accountEnding: "", ibanEnding: "" })}>{tx("addBank", "Add bank account")}</Button>
                </div>
                {bankRows.fields.map((field, index) => (
                  <div key={field.id} className="grid gap-3 rounded-control border border-line bg-card p-3 md:grid-cols-2">
                    <input type="hidden" {...form.register(`banks.${index}.id`)} />
                    <input type="hidden" {...form.register(`banks.${index}.accountEnding`)} />
                    <input type="hidden" {...form.register(`banks.${index}.ibanEnding`)} />
                    <Field label={tx("bankName", "Bank name")} error={profileErrors.banks?.[index]?.bankName ? tx("required", "required") : undefined}>
                      <Input {...form.register(`banks.${index}.bankName`)} />
                    </Field>
                    <Field label={tx("name", "Name")}><Input {...form.register(`banks.${index}.accountName`)} /></Field>
                    <Field label={tx("accountNumber", "Account number")}>
                      <Input {...form.register(`banks.${index}.accountNumber`)} dir="ltr" autoComplete="off" />
                    </Field>
                    <Field label={tx("iban", "IBAN")}>
                      <Input {...form.register(`banks.${index}.iban`)} dir="ltr" autoComplete="off" />
                    </Field>
                    <Field label={tx("swift", "SWIFT")}><Input {...form.register(`banks.${index}.swift`)} dir="ltr" /></Field>
                    <div className="flex items-end justify-end">
                      <Button type="button" size="sm" variant="outline" onClick={() => bankRows.remove(index)}>{tx("removeRow", "Remove")}</Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {mutation.isError ? (
              <div className="md:col-span-2">
                <AlertText>{tx("customerProfileError", "Could not save the customer profile. Reload if someone else changed it.")}</AlertText>
              </div>
            ) : null}
            <div className="flex justify-end md:col-span-2">
              <Button type="submit" disabled={mutation.isPending}>{tx("saveCustomer", "Save customer")}</Button>
            </div>
          </form>
        </Reveal>
        {!editing && customer.notes ? (
          <p className="border-t border-line bg-paper/50 px-4 py-3 text-sm leading-relaxed text-ink-muted">{customer.notes}</p>
        ) : null}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={tx("contacts", "Contacts")} value={contacts.length} icon={<Users className="h-5 w-5" />} tone="blue" />
        <StatCard label={tx("addresses", "Addresses")} value={addresses.length} icon={<MapPin className="h-5 w-5" />} tone="teal" />
        <StatCard label={tx("bankAccounts", "Bank accounts")} value={banks.length} icon={<Landmark className="h-5 w-5" />} tone="amber" />
        <StatCard
          label={tx("exportHistory", "Export history")}
          value={cases.length}
          icon={<FolderOpen className="h-5 w-5" />}
          tone="green"
          hint={`${tx("openCases", "Open cases")}: ${openCases}`}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {!editing ? <SectionCard title={tx("contacts", "Contacts")} icon={<Users className="h-4 w-4" />}>
          {contacts.length === 0 ? (
            <EmptyState>{tx("noContacts", "No contacts recorded yet.")}</EmptyState>
          ) : (
            <ul className="grid gap-2">
              {contacts.map((contact) => (
                <li key={contact.id} className="rounded-xl border border-line bg-paper/40 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-ink">{contact.full_name}</p>
                    {isPrimary(contact.is_primary) ? (
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                        {tx("primary", "Primary")}
                      </span>
                    ) : null}
                    {contact.title ? <span className="text-xs text-ink-muted">{contact.title}</span> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                    {contact.phone ? (
                      <a className="inline-flex items-center gap-1 hover:text-accent" href={`tel:${contact.phone}`} dir="ltr">
                        <Phone className="h-3.5 w-3.5" aria-hidden />
                        {contact.phone}
                      </a>
                    ) : null}
                    {contact.email ? (
                      <a className="inline-flex items-center gap-1 hover:text-accent" href={`mailto:${contact.email}`} dir="ltr">
                        <Mail className="h-3.5 w-3.5" aria-hidden />
                        {contact.email}
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard> : null}

        {!editing ? <SectionCard title={tx("addresses", "Addresses")} icon={<MapPin className="h-4 w-4" />}>
          {addresses.length === 0 ? (
            <EmptyState>{tx("noAddresses", "No addresses recorded yet.")}</EmptyState>
          ) : (
            <ul className="grid gap-2">
              {addresses.map((address) => (
                <li key={address.id} className="rounded-xl border border-line bg-paper/40 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                      {tx(`addressKind.${address.kind}`, address.kind)}
                    </span>
                    {isPrimary(address.is_primary) ? (
                      <span className="text-[10px] font-semibold text-ink-muted">{tx("primary", "Primary")}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-ink">{address.line1}</p>
                  <p className="text-xs text-ink-muted">
                    {[address.city, address.region, address.postal_code].filter(Boolean).join(" · ")}
                    {address.country_code ? <Ltr className="ms-1">{address.country_code}</Ltr> : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard> : null}

        {editing && canEditBanks ? null : <SectionCard title={tx("bankAccounts", "Bank accounts")} icon={<Landmark className="h-4 w-4" />}>
          {banks.length === 0 ? (
            <EmptyState>{tx("bankHidden", "Hidden or none. Bank identifiers are permission-gated.")}</EmptyState>
          ) : (
            <ul className="grid gap-2">
              {banks.map((bank) => (
                <li key={bank.id} className="rounded-xl border border-line bg-paper/40 px-3 py-2.5">
                  <p className="font-medium text-ink">{bank.bank_name}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
                    {bank.account_name ? <span>{bank.account_name}</span> : null}
                    {bank.account_number || bank.account_number_last4 ? <span><Ltr>{String(bank.account_number || bank.account_number_last4)}</Ltr></span> : null}
                    {bank.iban || bank.iban_last4 ? <span><Ltr>{String(bank.iban || bank.iban_last4)}</Ltr></span> : null}
                    {bank.swift ? <span>SWIFT <Ltr>{bank.swift}</Ltr></span> : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>}

        <CustomFieldsPanel endpoint={`/api/v1/customers/${id}/custom-fields`} />
      </div>

      <SectionCard
        title={tx("exportHistory", "Export history")}
        icon={<FolderOpen className="h-4 w-4" />}
        action={<span className="text-xs text-ink-muted"><Ltr>{cases.length}</Ltr></span>}
      >
        {cases.length === 0 ? (
          <EmptyState>{tx("noCasesForCustomer", "No export cases for this customer yet.")}</EmptyState>
        ) : (
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-paper/80 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="p-3 text-start">{tx("case", "Case")}</th>
                  <th className="p-3 text-start">{tx("destination", "Destination")}</th>
                  <th className="p-3 text-start">{tx("status", "Status")}</th>
                  <th className="p-3 text-start">{tx("updated", "Updated")}</th>
                  <th className="p-3 text-end">{tx("actionCol", "Action")}</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((item) => (
                  <tr key={item.id} className="border-t border-line/70 transition hover:bg-paper/60">
                    <td className="whitespace-nowrap p-3 font-semibold text-ink"><Ltr>{item.case_reference}</Ltr></td>
                    <td className="p-3"><Ltr>{item.destination_country || "—"}</Ltr></td>
                    <td className="p-3"><StatusBadge value={item.status} /></td>
                    <td className="whitespace-nowrap p-3 text-xs text-ink-muted"><Ltr>{formatWhen(item.updated_at, i18n.language)}</Ltr></td>
                    <td className="p-3 text-end">
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/export-cases/${item.id}`}>{tx("openRecord", "Open")}</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/** D1 and JSON both hand back flags as `1`, `"1"` or `true`. */
function isPrimary(value: unknown) {
  return value === 1 || value === "1" || value === true || value === "true";
}

function emptyProfile(): CustomerProfile {
  return {
    legalName: "",
    customerCode: "",
    tradeName: "",
    countryCode: "",
    taxId: "",
    notes: "",
    contacts: [],
    addresses: [],
    banks: [],
  };
}
