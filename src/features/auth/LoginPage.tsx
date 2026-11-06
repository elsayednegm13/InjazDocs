import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { brandAsset, useCompanyBrand } from "@/app/brand";
import { applyDir } from "@/app/i18n";
import { useSession, useSessionPending } from "@/app/access";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api, ApiRequestError } from "@/lib/api";
import { useCopy } from "@/lib/copy";
import { loginRequestGate, refetchWhenReadable } from "@/lib/query-retry";

export function LoginPage() {
  const { tx, i18n } = useCopy();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();
  const sessionPending = useSessionPending();
  const bootstrapGate = loginRequestGate({ sessionPending, hasSession: session != null, bootstrapSettled: false });
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: async () => (await api<{ required: boolean }>("/api/v1/auth/bootstrap-status")).data,
    enabled: bootstrapGate.bootstrap,
    retry: false,
    refetchOnWindowFocus: (query) => refetchWhenReadable(query.state.status),
  });
  const brandGate = loginRequestGate({
    sessionPending,
    hasSession: session != null,
    bootstrapSettled: bootstrap.isSuccess || bootstrap.isError,
  });
  const brand = useCompanyBrand(brandGate.brand);
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

  const logoSrc = brand?.hasLogo ? brandAsset("logo", brand.updatedAt) : "";

  if (session) {
    return <Navigate to={session.mustChangePassword ? "/change-password" : "/dashboard"} replace />;
  }

  const productName = brand?.name || "ExportFlow";
  return (
    <div className="login-stage relative flex min-h-screen items-center justify-center px-4 py-16">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="absolute end-4 top-4 rounded-full"
        onClick={() => {
          const next = ar ? "en" : "ar";
          void i18n.changeLanguage(next);
          applyDir(next);
        }}
      >
        {ar ? "English" : "العربية"}
      </Button>
      <section className="w-full max-w-[420px] rounded-card border border-line bg-card px-7 py-10 shadow-card sm:px-10">
          <div className="mb-8 flex flex-col items-center text-center">
            {logoSrc ? (
              <img src={logoSrc} alt="" className="mb-5 h-20 w-20 rounded-card border border-line bg-paper object-contain p-2 shadow-sm" />
            ) : (
              <span className="mb-5 grid h-16 w-16 place-items-center rounded-card bg-accent-2 text-lg font-semibold text-white">{productName.slice(0, 1)}</span>
            )}
            <p className="text-sm font-medium text-ink-muted">{productName}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{tx("loginWelcome", "Welcome")}</h1>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-ink-muted">{tx("loginLead", "Sign in with the email and password on your staff account.")}</p>
          </div>
          {error ? (
            <p role="alert" className="mb-4 rounded-control bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <form
            className="grid gap-4"
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute end-1 top-1 text-ink-muted hover:bg-paper hover:text-ink"
                  aria-label={showPassword ? tx("hidePassword", "Hide password") : tx("showPassword", "Show password")}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </Field>
            <Button type="submit" className="mt-1" disabled={signIn.isPending}>
              {signIn.isPending ? tx("signingIn", "Signing in…") : tx("signIn", "Sign in")}
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
    <div className="mx-auto mt-16 w-full max-w-md rounded-card border border-line bg-card p-6 shadow-card">
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
