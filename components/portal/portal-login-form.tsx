"use client";

import { useActionState, useEffect, type FormEvent } from "react";
import Link from "next/link";
import { portalLogin, type LoginState } from "@/app/(portal)/portal/actions";
import { LogIn } from "lucide-react";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ErrosDoFormulario, ResumoDeErros, useErrosDoFormulario } from "@/components/ui/formulario-erros";
import { validarFormato } from "@/lib/forms/erros";

export function PortalLoginForm({ destino = null }: { destino?: string | null }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(portalLogin, {});
  // ERRO NO CAMPO: e-mail mal digitado/senha vazia no campo (antes de enviar); e-mail ou senha errados (o
  // servidor não diz qual, para não revelar se o acesso existe) e o bloqueio ficam na faixa do topo
  const erros = useErrosDoFormulario();
  useEffect(() => { erros.definir({}, state?.erro ?? null); }, [state, erros.definir]);

  function conferir(e: FormEvent<HTMLFormElement>) {
    const dados = new FormData(e.currentTarget);
    const email = String(dados.get("email") ?? "");
    const campos: Record<string, string> = {};
    const fEmail = email.trim() ? validarFormato("email", email) : "Informe o e-mail.";
    if (fEmail) campos.email = fEmail;
    if (!String(dados.get("senha") ?? "")) campos.senha = "Informe a senha.";
    if (!erros.validar(campos)) e.preventDefault();
  }

  return (
    <ErrosDoFormulario valor={erros}>
    <form ref={erros.ref} action={formAction} onSubmit={conferir} className="space-y-4" noValidate>
      {destino && <input type="hidden" name="destino" value={destino} />}
      <ResumoDeErros className="py-2 px-3" />
      <FormField label="E-mail" name="email" formato="email">
        <Input
          // Y12: errou a senha? O e-mail digitado FICA (o action devolve e o reset do form usa o default)
          name="email" type="email" required autoComplete="email" placeholder="seu@email.com"
          defaultValue={state?.email ?? ""} className="min-h-[44px]"
        />
      </FormField>
      <FormField label="Senha" name="senha">
        <Input name="senha" type="password" required autoComplete="current-password" placeholder="••••••••" className="min-h-[44px]" />
      </FormField>
      <button
        type="submit" disabled={pending}
        className="w-full inline-flex items-center justify-center gap-2 bg-primary-500 hover:bg-primary-600 text-white font-semibold px-4 py-3 rounded-lg transition-all disabled:opacity-60"
      >
        <LogIn className="w-4 h-4" /> {pending ? "Entrando…" : "Entrar"}
      </button>
      {/* Y13: o cliente travado fora do horário comercial tem saída sozinho */}
      <p className="text-center">
        <Link href="/portal/esqueci-senha" className="text-sm text-primary-600 hover:underline" data-esqueci-senha>
          Esqueci minha senha
        </Link>
      </p>
    </form>
    </ErrosDoFormulario>
  );
}
