"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Check, CheckCircle2, Loader2 } from "lucide-react";
import { REQUISITOS_SENHA, problemaSenha } from "@/lib/acesso/senha";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ErrosDoFormulario, ResumoDeErros, useErrosDoFormulario } from "@/components/ui/formulario-erros";

/** Define a nova senha do portal pelo link do e-mail (assinado, 1 hora, uso único). */
export function PortalDefinirSenhaForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [salvando, setSalvando] = useState(false);
  // ERRO NO CAMPO: senha fraca na senha, as duas diferentes na repetição; link vencido/conexão na faixa
  const erros = useErrosDoFormulario();
  const [ok, setOk] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const problema = problemaSenha(senha);
    if (!erros.validar(problema ? { senha: problema } : senha !== confirmar ? { confirmar: "As senhas não são iguais." } : {})) return;
    setSalvando(true);
    try {
      const r = await fetch("/api/portal/definir-senha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, senha }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { erros.erroDaApi(d, "Não foi possível salvar a nova senha."); return; }
      setOk(true);
      setTimeout(() => router.push("/portal/login"), 2500);
    } catch { erros.definirGeral("Erro de conexão."); erros.focar(); } finally { setSalvando(false); }
  }

  if (!token) return (
    <div className="space-y-4">
      <p role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2.5">
        Link inválido. Peça um novo em “Esqueci minha senha”, na tela de entrada do portal.
      </p>
      <Link href="/portal/esqueci-senha" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600"><ArrowLeft className="w-4 h-4" /> Pedir um novo link</Link>
    </div>
  );

  if (ok) return (
    <div className="space-y-4 text-center">
      <CheckCircle2 className="w-10 h-10 text-success-600 mx-auto" />
      <h2 className="text-xl font-bold text-ink">Senha criada.</h2>
      <p className="text-sm text-ink-muted">A nova senha já vale. Redirecionando para a entrada…</p>
      <Link href="/portal/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600">Ir agora</Link>
    </div>
  );

  return (
    <ErrosDoFormulario valor={erros}>
    <form ref={erros.ref} onSubmit={salvar} className="space-y-5" noValidate>
      <div>
        <h2 className="text-xl font-bold text-ink">Criar nova senha</h2>
        <p className="text-sm text-ink-muted mt-1">Escolha a senha de acesso ao portal.</p>
      </div>
      <ResumoDeErros className="py-2.5 px-3" />
      <FormField label="Nova senha" name="senha">
        <Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" disabled={salvando} className="min-h-[44px] disabled:opacity-50" />
      </FormField>
      <FormField label="Repita a senha" name="confirmar">
        <Input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" disabled={salvando} className="min-h-[44px] disabled:opacity-50" />
      </FormField>
      <ul className="text-xs text-ink-muted space-y-1">
        {REQUISITOS_SENHA.map((r) => (
          <li key={r.texto} className={r.ok(senha) ? "text-success-700" : undefined}>
            <Check className="inline w-3 h-3 mr-1" /> {r.texto}
          </li>
        ))}
      </ul>
      <button type="submit" disabled={salvando} className="w-full inline-flex items-center justify-center gap-2 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-lg py-2.5 disabled:opacity-60">
        {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar nova senha
      </button>
    </form>
    </ErrosDoFormulario>
  );
}
