"use client";

import { useState } from "react";
import { AlertCircle, Check, Eye, EyeOff, Loader2 } from "lucide-react";
import { SENHA_MINIMA, problemaSenha } from "@/lib/acesso/senha";
import { API_TROCA_PORTAL, ROTA_INICIO_PORTAL } from "@/lib/portal/senha-provisoria";
import { RequisitosSenha } from "@/components/auth/requisitos-senha";
import { portalLogout } from "@/app/(portal)/portal/actions";

/**
 * Portal do cliente, 1º acesso com a senha provisória (gerada pela empresa): o contato cria a própria
 * antes de usar o portal. Senha recebida + nova + confirmação; deu certo, a sessão continua (o cookie
 * volta regravado, sem a troca pendente) e o portal abre.
 */
export function PortalTrocarSenhaForm({ nome, email }: { nome: string; email: string }) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (!atual) { setErro("Informe a senha recebida."); return; }
    const problema = problemaSenha(nova);
    if (problema) { setErro(problema); return; }
    if (nova !== confirmar) { setErro("A confirmação não confere com a nova senha."); return; }
    if (nova === atual) { setErro("A nova senha precisa ser diferente da recebida."); return; }
    setSalvando(true);
    try {
      const r = await fetch(API_TROCA_PORTAL, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senhaAtual: atual, novaSenha: nova, confirmar }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível trocar a senha."); return; }
      window.location.assign(ROTA_INICIO_PORTAL);
    } catch { setErro("Erro de conexão. Tente de novo."); } finally { setSalvando(false); }
  }

  const cls = "w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10";
  return (
    <form onSubmit={salvar} className="space-y-5" data-portal-trocar-senha>
      <div>
        <h1 className="text-lg font-bold text-ink">Crie a sua senha, {nome.split(" ")[0]}</h1>
        <p className="text-sm text-ink-muted mt-1">A senha de <strong>{email}</strong> foi gerada pela empresa. Troque-a para continuar.</p>
      </div>
      {erro && <p role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2.5 flex items-center gap-2" data-erro-troca><AlertCircle className="w-4 h-4 shrink-0" /> {erro}</p>}
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-ink">Senha recebida</span>
        <input type={mostrar ? "text" : "password"} value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" className={cls} data-senha-atual />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-ink">Nova senha</span>
        <div className="relative">
          <input type={mostrar ? "text" : "password"} value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" className={`${cls} pr-12`} placeholder={`Pelo menos ${SENHA_MINIMA} caracteres, com letra e número`} data-senha-nova />
          <button type="button" onClick={() => setMostrar((v) => !v)} className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 inline-flex items-center justify-center text-ink-subtle" aria-label={mostrar ? "Ocultar senhas" : "Mostrar senhas"}>
            {mostrar ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <RequisitosSenha senha={nova} className="pt-1" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-ink">Confirme a nova senha</span>
        <input type={mostrar ? "text" : "password"} value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" className={cls} data-senha-confirmar />
      </label>
      <button type="submit" disabled={salvando} className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-lg py-2.5 disabled:opacity-60" data-salvar-senha>
        {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar e continuar
      </button>
      <button type="button" onClick={() => void portalLogout()} className="w-full min-h-[44px] text-sm font-semibold text-ink-muted hover:text-ink" data-sair>
        Sair
      </button>
    </form>
  );
}
