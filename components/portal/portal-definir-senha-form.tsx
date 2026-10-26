"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowLeft, Check, CheckCircle2, Loader2 } from "lucide-react";
import { REQUISITOS_SENHA, problemaSenha } from "@/lib/acesso/senha";

/** Define a nova senha do portal pelo link do e-mail (assinado, 1 hora, uso único). */
export function PortalDefinirSenhaForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    const problema = problemaSenha(senha);
    if (problema) { setErro(problema); return; }
    if (senha !== confirmar) { setErro("As senhas não são iguais."); return; }
    setSalvando(true);
    try {
      const r = await fetch("/api/portal/definir-senha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, senha }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível salvar a nova senha."); return; }
      setOk(true);
      setTimeout(() => router.push("/portal/login"), 2500);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
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
      <h2 className="text-xl font-bold text-ink">Senha criada!</h2>
      <p className="text-sm text-ink-muted">Você já pode entrar com a nova senha. Levando você para a entrada…</p>
      <Link href="/portal/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600">Ir agora</Link>
    </div>
  );

  return (
    <form onSubmit={salvar} className="space-y-5" noValidate>
      <div>
        <h2 className="text-xl font-bold text-ink">Criar nova senha</h2>
        <p className="text-sm text-ink-muted mt-1">Escolha a senha que você vai usar para entrar no portal.</p>
      </div>
      {erro && <p role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2.5 flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {erro}</p>}
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-ink">Nova senha</span>
        <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" disabled={salvando}
          className="w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 disabled:opacity-50" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-ink">Repita a senha</span>
        <input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" disabled={salvando}
          className="w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 disabled:opacity-50" />
      </label>
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
  );
}
