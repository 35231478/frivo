"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, MailCheck, Send } from "lucide-react";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ErrosDoFormulario, ResumoDeErros, useErrosDoFormulario } from "@/components/ui/formulario-erros";
import { validarFormato } from "@/lib/forms/erros";

/** "Esqueci minha senha" do portal: a resposta é sempre a mesma (não revela se o e-mail tem acesso). */
export function PortalEsqueciSenhaForm() {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  // ERRO NO CAMPO: e-mail mal digitado no campo; limite de pedidos/conexão na faixa
  const erros = useErrosDoFormulario();
  const [mensagem, setMensagem] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!erros.validar(email.trim() && !validarFormato("email", email) ? {} : { email: "Informe um e-mail válido." })) return;
    setEnviando(true);
    try {
      const r = await fetch("/api/portal/esqueci-senha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { erros.erroDaApi(d, "Não foi possível enviar agora. Tente de novo."); return; }
      setMensagem(d.mensagem);
    } catch { erros.definirGeral("Erro de conexão."); erros.focar(); } finally { setEnviando(false); }
  }

  const voltar = (
    <Link href="/portal/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 hover:text-primary-700">
      <ArrowLeft className="w-4 h-4" /> Voltar para a entrada
    </Link>
  );

  if (mensagem) return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-ink">Verifique o seu e-mail</h2>
        <p className="text-sm text-ink-muted mt-1">Pedido recebido para <strong>{email.trim()}</strong>.</p>
      </div>
      <p role="status" className="bg-ok-claro border border-ok/20 text-ok-texto text-sm rounded-lg px-3 py-2.5 flex items-start gap-2">
        <MailCheck className="w-4 h-4 shrink-0 mt-0.5" /> {mensagem}
      </p>
      <p className="text-xs text-ink-muted">O link vale por 1 hora e só pode ser usado uma vez. Se não chegar, peça de novo em alguns minutos.</p>
      {voltar}
    </div>
  );

  return (
    <ErrosDoFormulario valor={erros}>
    <form ref={erros.ref} onSubmit={enviar} className="space-y-5" noValidate>
      <div>
        <h2 className="text-xl font-bold text-ink">Esqueci minha senha</h2>
        <p className="text-sm text-ink-muted mt-1">Informe o e-mail de acesso ao portal. O link para criar uma nova senha é enviado por e-mail.</p>
      </div>
      <ResumoDeErros className="py-2.5 px-3" />
      <FormField label="E-mail" name="email" formato="email">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="seu@email.com" disabled={enviando}
          className="min-h-[44px] disabled:opacity-50" />
      </FormField>
      <button type="submit" disabled={enviando} className="w-full inline-flex items-center justify-center gap-2 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-lg py-2.5 disabled:opacity-60">
        {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Enviar link
      </button>
      <div className="text-center">{voltar}</div>
    </form>
    </ErrosDoFormulario>
  );
}
