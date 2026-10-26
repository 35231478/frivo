"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ArrowLeft, Loader2, MailCheck, Send } from "lucide-react";

/** Pede o e-mail; a resposta é sempre a mesma mensagem (não revela se o e-mail tem cadastro). */
export function EsqueciSenhaForm() {
  const [email, setEmail] = useState(useSearchParams().get("email") ?? "");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErro("Informe um e-mail válido."); return; }
    setEnviando(true);
    try {
      const r = await fetch("/api/publico/esqueci-senha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível enviar agora. Tente de novo."); return; }
      setMensagem(d.mensagem);
    } catch { setErro("Erro de conexão."); } finally { setEnviando(false); }
  }

  const voltar = (
    <Link href="/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 hover:text-primary-700">
      <ArrowLeft className="w-4 h-4" /> Voltar para o login
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
      <p className="text-xs text-ink-muted">O link vale por 1 hora e só pode ser usado uma vez. Não chegou? Você pode pedir de novo daqui a pouco.</p>
      {voltar}
    </div>
  );

  return (
    <form onSubmit={enviar} className="space-y-5" noValidate>
      <div>
        <h2 className="text-xl font-bold text-ink">Esqueci minha senha</h2>
        <p className="text-sm text-ink-muted mt-1">Informe o e-mail que você usa para entrar. Vamos mandar um link para você criar uma nova senha.</p>
      </div>
      {erro && <p role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2.5 flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {erro}</p>}
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-ink">E-mail</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="seu@email.com.br" disabled={enviando}
          className="w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 disabled:opacity-50" />
      </label>
      <button type="submit" disabled={enviando} className="w-full inline-flex items-center justify-center gap-2 bg-acento hover:bg-acento-hover text-white font-semibold rounded-lg py-2.5 disabled:opacity-60">
        {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Enviar link
      </button>
      <div className="text-center">{voltar}</div>
    </form>
  );
}
