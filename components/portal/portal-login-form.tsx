"use client";

import { useActionState } from "react";
import { portalLogin, type LoginState } from "@/app/(portal)/portal/actions";
import { AlertCircle, LogIn } from "lucide-react";

export function PortalLoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(portalLogin, {});

  return (
    <form action={formAction} className="space-y-4">
      {state?.erro && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {state.erro}
        </div>
      )}
      <div>
        <label className="text-sm font-semibold text-ink">E-mail</label>
        <input
          name="email" type="email" required autoComplete="email" placeholder="seu@email.com"
          className="mt-1 w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all"
        />
      </div>
      <div>
        <label className="text-sm font-semibold text-ink">Senha</label>
        <input
          name="senha" type="password" required autoComplete="current-password" placeholder="••••••••"
          className="mt-1 w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all"
        />
      </div>
      <button
        type="submit" disabled={pending}
        className="w-full inline-flex items-center justify-center gap-2 bg-primary-500 hover:bg-primary-600 text-white font-semibold px-4 py-3 rounded-lg transition-all disabled:opacity-60"
      >
        <LogIn className="w-4 h-4" /> {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
