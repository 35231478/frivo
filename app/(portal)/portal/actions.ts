"use server";

import { AuthError } from "next-auth";
import { portalSignIn, portalSignOut } from "@/lib/auth-portal";
import { destinoSeguroDoPortal } from "@/lib/portal/senha-provisoria";

export interface LoginState { erro?: string; email?: string }

/** Código do CredentialsSignin, onde quer que o NextAuth o tenha embrulhado. */
function codigoDoErro(e: AuthError): string | undefined {
  const direto = (e as { code?: unknown }).code;
  if (typeof direto === "string") return direto;
  const causa = (e.cause as { err?: { code?: unknown } } | undefined)?.err?.code;
  return typeof causa === "string" ? causa : undefined;
}

export async function portalLogin(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const senha = String(formData.get("senha") ?? "");
  try {
    // O link do e-mail (lembrete do pedido) volta para onde ia; só rota interna do portal (lib/portal/senha-provisoria)
    await portalSignIn("credentials", { email, senha, redirectTo: destinoSeguroDoPortal(formData.get("destino")) ?? "/portal/dashboard" });
    return {};
  } catch (e) {
    if (e instanceof AuthError) {
      const minutos = /^bloqueado-(\d+)$/.exec(codigoDoErro(e) ?? "")?.[1];
      // Y12: o erro devolve o e-mail digitado — a tela o preserva (só a senha é redigitada)
      if (minutos) return { erro: `Muitas tentativas sem sucesso. Por segurança, aguarde ${minutos} min e tente de novo.`, email };
      return { erro: "E-mail ou senha inválidos.", email };
    }
    throw e; // redirect (NEXT_REDIRECT) deve propagar
  }
}

export async function portalLogout() {
  await portalSignOut({ redirectTo: "/portal/login" });
}
