"use server";

import { AuthError } from "next-auth";
import { portalSignIn, portalSignOut } from "@/lib/auth-portal";

export interface LoginState { erro?: string }

export async function portalLogin(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const senha = String(formData.get("senha") ?? "");
  try {
    await portalSignIn("credentials", { email, senha, redirectTo: "/portal/dashboard" });
    return {};
  } catch (e) {
    if (e instanceof AuthError) return { erro: "E-mail ou senha inválidos." };
    throw e; // redirect (NEXT_REDIRECT) deve propagar
  }
}

export async function portalLogout() {
  await portalSignOut({ redirectTo: "/portal/login" });
}
