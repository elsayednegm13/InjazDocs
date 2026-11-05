import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Mail, UserRound } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useSession } from "@/app/access";
import { Button } from "@/components/ui/button";
import { PageHeader, SectionCard } from "@/components/ui/chrome";
import { Field, Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useCopy } from "@/lib/copy";
import { notifyError, notifySuccess } from "@/lib/notify";

const nameSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

const emailSchema = z.object({
  email: z.string().trim().email(),
  currentPassword: z.string().min(1),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12).max(128),
  confirmPassword: z.string().min(1),
}).refine((value) => value.newPassword === value.confirmPassword, {
  path: ["confirmPassword"],
  message: "mismatch",
});

type NameValues = z.infer<typeof nameSchema>;
type EmailValues = z.infer<typeof emailSchema>;
type PasswordValues = z.infer<typeof passwordSchema>;

export function ProfilePage() {
  const { tx } = useCopy();
  const user = useSession();
  const client = useQueryClient();
  const nameForm = useForm<NameValues>({
    resolver: zodResolver(nameSchema),
    values: { name: user?.name ?? "" },
  });
  const emailForm = useForm<EmailValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: "", currentPassword: "" },
  });
  const passwordForm = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const saveName = useMutation({
    mutationFn: (values: NameValues) => api("/api/v1/me/profile", { method: "POST", body: JSON.stringify(values) }),
    onSuccess: async () => {
      notifySuccess(tx("profileNameSaved", "Name saved"));
      await client.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => notifyError(error),
  });
  const saveEmail = useMutation({
    mutationFn: (values: EmailValues) => api("/api/v1/me/email", { method: "POST", body: JSON.stringify(values) }),
    onSuccess: async () => {
      notifySuccess(tx("profileEmailSaved", "Email saved"));
      emailForm.reset({ email: "", currentPassword: "" });
      await client.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => notifyError(error),
  });
  const savePassword = useMutation({
    mutationFn: (values: PasswordValues) =>
      api("/api/v1/me/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: values.currentPassword, newPassword: values.newPassword }),
      }),
    onSuccess: () => {
      notifySuccess(tx("profilePasswordSaved", "Password saved"));
      passwordForm.reset();
    },
    onError: (error) => notifyError(error),
  });

  if (!user) return null;
  const initials = user.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <PageHeader title={tx("profile", "Profile")} subtitle={tx("profileHint", "Update the name, email and password for this account.")} />
      <section className="flex items-center gap-4 rounded-2xl border border-line bg-card p-5 shadow-[var(--shadow-card)]">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-accent-2 text-lg font-semibold text-white">{initials}</span>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-ink">{user.name}</h2>
          <p className="truncate text-sm text-ink-muted" dir="ltr">{user.email}</p>
        </div>
      </section>

      <SectionCard title={tx("profileName", "Name")} icon={<UserRound className="h-4 w-4" />}>
        <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={nameForm.handleSubmit((values) => saveName.mutate(values))}>
          <Field label={tx("name", "Name")} error={nameForm.formState.errors.name ? tx("required", "required") : undefined}>
            <Input {...nameForm.register("name")} autoComplete="name" />
          </Field>
          <Button type="submit" disabled={saveName.isPending}>{tx("save", "Save")}</Button>
        </form>
      </SectionCard>

      <SectionCard title={tx("profileEmail", "Email")} icon={<Mail className="h-4 w-4" />}>
        <p className="mb-3 text-sm text-ink-muted">{tx("profileEmailHint", "Confirm with your current password. The new address is used the next time you sign in.")}</p>
        <form className="grid gap-3" onSubmit={emailForm.handleSubmit((values) => saveEmail.mutate(values))}>
          <Field label={tx("newEmail", "New email")} error={emailForm.formState.errors.email ? tx("email", "Email") : undefined}>
            <Input {...emailForm.register("email")} type="email" dir="ltr" autoComplete="email" />
          </Field>
          <Field label={tx("currentPassword", "Current password")} error={emailForm.formState.errors.currentPassword ? tx("currentPassword", "Current password") : undefined}>
            <Input {...emailForm.register("currentPassword")} type="password" autoComplete="current-password" dir="ltr" />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={saveEmail.isPending}>{tx("saveEmail", "Save email")}</Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title={tx("profilePassword", "Password")} icon={<KeyRound className="h-4 w-4" />}>
        <p className="mb-3 text-sm text-ink-muted">{tx("profilePasswordHint", "Enter the current password, then choose a new one of at least 12 characters.")}</p>
        <form className="grid gap-3" onSubmit={passwordForm.handleSubmit((values) => savePassword.mutate(values))}>
          <Field label={tx("currentPassword", "Current password")} error={passwordForm.formState.errors.currentPassword ? tx("currentPassword", "Current password") : undefined}>
            <Input {...passwordForm.register("currentPassword")} type="password" autoComplete="current-password" dir="ltr" />
          </Field>
          <Field label={tx("newPassword", "New password")} error={passwordForm.formState.errors.newPassword ? tx("passwordTooShort", "Use at least 12 characters.") : undefined}>
            <Input {...passwordForm.register("newPassword")} type="password" autoComplete="new-password" dir="ltr" />
          </Field>
          <Field label={tx("confirmPassword", "Confirm new password")} error={passwordForm.formState.errors.confirmPassword ? tx("passwordMismatch", "The two passwords do not match.") : undefined}>
            <Input {...passwordForm.register("confirmPassword")} type="password" autoComplete="new-password" dir="ltr" />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={savePassword.isPending}>{tx("savePassword", "Save password")}</Button>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
