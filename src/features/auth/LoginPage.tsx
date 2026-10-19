import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { applyDir } from "@/app/i18n";
import { useSession } from "@/app/access";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api, ApiRequestError } from "@/lib/api";
import { useCopy } from "@/lib/copy";

export function LoginPage() {
  const { tx, i18n } = useCopy();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: async () => (await api<{ required: boolean }>("/api/v1/auth/bootstrap-status")).data,
  });
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const ar = i18n.language.startsWith("ar");

  const signIn = useMutation({
    mutationFn: async (form: FormData) => {
      const res = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: String(form.get("email") ?? "").trim(),
          password: String(form.get("password") ?? ""),
        }),
      });
      if (!res.ok) {
        throw new Error("Sign-in failed");
      }
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ["me"] });
      const next = queryClient.getQueryData<{ mustChangePassword: boolean }>(["me"]);
      navigate(next?.mustChangePassword ? "/change-password" : "/dashboard");
    },
    onError: () => setError(tx("signInFailed", "Sign-in failed")),
  });

  const setup = useMutation({
    mutationFn: async (form: FormData) => {
      await api("/api/v1/auth/bootstrap", {
        method: "POST",
        headers: { "x-bootstrap-secret": String(form.get("secret") ?? "") },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
          name: form.get("name") || "Administrator",
        }),
      });
    },
    onSuccess: () => setError(tx("adminCreated", "Administrator created. Sign in with the same email, then change the password.")),
    onError: (err) => setError(err instanceof ApiRequestError ? tx(`errors.${err.code}`, tx("setupFailed", "Setup failed")) : tx("setupFailed", "Setup failed")),
  });

  if (session) {
    return <Navigate to={session.mustChangePassword ? "/change-password" : "/dashboard"} replace />;
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,480px)]">
      <section className="hidden flex-col justify-between bg-accent-2 px-10 py-12 text-white lg:flex">
        <div>
          <h1 className="max-w-xl text-4xl font-semibold leading-tight">ExportFlow</h1>
          <p className="mt-3 text-lg text-white/80">{tx("productMark", "Export operations")}</p>
          <p className="mt-4 max-w-md text-base text-white/75">{tx("tagline", "Export operations, without the spreadsheet chase.")}</p>
          <div className="mt-10 grid max-w-md gap-3 text-sm text-white/70">
            <p>{tx("documentTrack", "Document track")} · {tx("goodsTrack", "Goods track")}</p>
            <p>{tx("manualSourceNote", "Courier and milestone dates are entered manually. This is not a live carrier feed.")}</p>
          </div>
        </div>
      </section>
      <section className="flex items-center justify-center bg-paper px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-[var(--shadow-card)]">
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink lg:hidden">ExportFlow</p>
              <h2 className="text-2xl font-semibold">{tx("signIn", "Sign in")}</h2>
              <p className="mt-1 text-sm text-ink-muted lg:hidden">{tx("tagline", "Export operations, without the spreadsheet chase.")}</p>
            </div>
            <button
              className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold"
              onClick={() => {
                const next = ar ? "en" : "ar";
                void i18n.changeLanguage(next);
                applyDir(next);
              }}
            >
              {ar ? "English" : "العربية"}
            </button>
          </div>
          {error ? (
            <p role="alert" className="mb-3 rounded-lg bg-[#f8e8e6] px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              signIn.mutate(new FormData(event.currentTarget));
            }}
          >
            <Field label={tx("email", "Email")}>
              <Input name="email" type="text" required autoComplete="username" inputMode="email" dir="ltr" />
            </Field>
            <Field label={tx("password", "Password")}>
              <div className="relative">
                <Input name="password" type={showPassword ? "text" : "password"} required autoComplete="current-password" className="pe-10" />
                <button
                  type="button"
                  className="absolute end-2 top-2 rounded p-1 text-ink-muted"
                  aria-label={showPassword ? tx("hidePassword", "Hide password") : tx("showPassword", "Show password")}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
            <Button type="submit" disabled={signIn.isPending}>
              {tx("signIn", "Sign in")}
            </Button>
          </form>
          {bootstrap.data?.required ? (
            <form
              className="mt-8 grid gap-3 border-t border-line pt-6"
              onSubmit={(event) => {
                event.preventDefault();
                setup.mutate(new FormData(event.currentTarget));
              }}
            >
              <div>
                <h3 className="font-semibold">{tx("firstSetup", "First-time setup")}</h3>
                <p className="text-sm text-ink-muted">{tx("setupHint", "Used once, when no staff account exists yet.")}</p>
              </div>
              <Field label={tx("bootstrapSecret", "Bootstrap secret")}>
                <Input name="secret" type="password" required />
              </Field>
              <Field label={tx("name", "Name")}>
                <Input name="name" required />
              </Field>
              <Field label={tx("email", "Email")}>
                <Input name="email" type="email" required dir="ltr" />
              </Field>
              <Field label={tx("password", "Password")}>
                <Input name="password" type="password" minLength={12} required />
              </Field>
              <Button type="submit" variant="outline" disabled={setup.isPending}>
                {tx("createAdmin", "Create administrator")}
              </Button>
            </form>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function ChangePasswordPage() {
  const { tx } = useCopy();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-auto mt-16 w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-[var(--shadow-card)]">
      <h1 className="mb-4 text-xl font-semibold">{tx("changePassword", "Change password")}</h1>
      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          try {
            await api("/api/v1/me/password", {
              method: "POST",
              body: JSON.stringify({
                currentPassword: form.get("currentPassword"),
                newPassword: form.get("newPassword"),
              }),
            });
            await queryClient.refetchQueries({ queryKey: ["me"] });
            navigate("/dashboard");
          } catch (err) {
            setError(err instanceof ApiRequestError ? tx(`errors.${err.code}`, tx("passwordFailed", "Could not change password")) : tx("passwordFailed", "Could not change password"));
          }
        }}
      >
        <Field label={tx("currentPassword", "Current password")}>
          <Input name="currentPassword" type="password" required />
        </Field>
        <Field label={tx("newPassword", "New password")}>
          <Input name="newPassword" type="password" minLength={12} required />
        </Field>
        <Button type="submit">{tx("save", "Save")}</Button>
      </form>
    </div>
  );
}
