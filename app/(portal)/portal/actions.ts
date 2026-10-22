"use server";

import { AuthError } from "next-auth";
import { portalSignIn, portalSignOut } from "@/lib/auth-portal";

export interface LoginState { erro?: string }

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
    await portalSignIn("credentials", { email, senha, redirectTo: "/portal/dashboard" });
    return {};
  } catch (e) {
    if (e instanceof AuthError) {
      const minutos = /^bloqueado-(\d+)$/.exec(codigoDoErro(e) ?? "")?.[1];
      if (minutos) return { erro: `Muitas tentativas sem sucesso. Por segurança, aguarde ${minutos} min e tente de novo.` };
      return { erro: "E-mail ou senha inválidos." };
    }
    throw e; // redirect (NEXT_REDIRECT) deve propagar
  }
}

export async function portalLogout() {
  await portalSignOut({ redirectTo: "/portal/login" });
}
