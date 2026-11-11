"use client";

import { useState } from "react";
import { ChevronDown, KeyRound, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/avisos";
import { RequisitosSenha } from "@/components/auth/requisitos-senha";
import { problemaSenha } from "@/lib/acesso/senha";
import { useTecnico } from "@/components/tecnico/contexto";

const CAMPO = "w-full rounded-card border border-surface-border bg-white px-3 py-3 text-base text-ink focus:outline-none focus:border-primary-500 touch-target";

/**
 * Perfil do app: o técnico troca a PRÓPRIA senha (senha atual + nova). Usa a mesma rota do "Meu
 * perfil › Segurança" do sistema (/api/perfil/senha): o usuário vem da sessão — não há como apontar
 * para outra pessoa —, a senha nova segue a regra forte do sistema e é guardada só como hash.
 * Precisa de sinal (senha não entra na fila do aparelho).
 */
export function TrocarSenha() {
  const { estado } = useTecnico();
  const [aberto, setAberto] = useState(false);
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const semSinal = estado.situacao === "offline";

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    if (!atual) { setErro("Informe a senha atual."); return; }
    const problema = problemaSenha(nova);
    if (problema) { setErro(problema); return; }
    if (nova !== confirmar) { setErro("A confirmação da nova senha não coincide."); return; }
    if (nova === atual) { setErro("A nova senha precisa ser diferente da atual."); return; }
    setSalvando(true);
    try {
      const res = await fetch("/api/perfil/senha", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senhaAtual: atual, novaSenha: nova, confirmar }),
      });
      const dados = await res.json().catch(() => null);
      if (!res.ok) { setErro(dados?.erro ?? "Não foi possível trocar a senha."); return; }
      setAtual(""); setNova(""); setConfirmar(""); setAberto(false);
      toast("Senha alterada. Este aparelho continua conectado; os outros pedem a senha nova.");
    } catch {
      setErro("Sem conexão. Tente de novo quando houver sinal.");
    } finally { setSalvando(false); }
  }

  return (
    <section className="bg-white rounded-card border border-surface-border" data-trocar-senha>
      <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} className="w-full flex items-center justify-between gap-3 p-4 font-semibold text-ink touch-target">
        <span className="inline-flex items-center gap-3"><KeyRound className="w-5 h-5 text-ink-muted" /> Trocar senha</span>
        <ChevronDown className={cn("w-5 h-5 transition-transform", aberto && "rotate-180")} />
      </button>
      {aberto && (
        <form onSubmit={salvar} className="border-t border-surface-border p-4 space-y-3" noValidate>
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-ink">Senha atual</span>
            <input type="password" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" className={CAMPO} data-senha-atual />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-ink">Nova senha</span>
            <input type="password" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" className={CAMPO} data-senha-nova />
            <RequisitosSenha senha={nova} className="pt-1" />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-ink">Confirmar nova senha</span>
            <input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" className={CAMPO} data-senha-confirmar />
          </label>
          {erro && <p role="alert" className="rounded-card bg-atrasado-claro border border-atrasado/20 px-3 py-2 text-sm text-atrasado-texto" data-erro-senha>{erro}</p>}
          {semSinal && <p className="text-xs text-ink-muted" data-senha-sem-sinal>Trocar a senha precisa de sinal.</p>}
          <button type="submit" disabled={salvando || semSinal} data-salvar-senha
            className="w-full rounded-card bg-primary-600 text-white py-3 font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 touch-target">
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Trocar senha
          </button>
        </form>
      )}
    </section>
  );
}
