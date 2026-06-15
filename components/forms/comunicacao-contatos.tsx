"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Mail, ArrowRight, Loader2, UserCircle } from "lucide-react";

interface Contato {
  id: string;
  nome: string;
  email?: string | null;
  telefone?: string | null;
  tipo: string;
}

const SECOES = [
  { tipo: "OPERACIONAL", titulo: "Contatos Operacionais", recebe: "OS • Agendamentos • PMOC • Relatórios", vazio: "Nenhum contato operacional cadastrado. Adicione na aba Contatos.", cor: "bg-blue-50 text-blue-700" },
  { tipo: "FINANCEIRO", titulo: "Contatos Financeiros", recebe: "Boletos • NF-e • Cobranças • Lembretes de vencimento", vazio: "Nenhum contato financeiro cadastrado. Adicione na aba Contatos.", cor: "bg-emerald-50 text-emerald-700" },
  { tipo: "CONTRATUAL", titulo: "Contatos Contratuais", recebe: "Contratos • Propostas • Renovações", vazio: "Nenhum contato contratual cadastrado. Adicione na aba Contatos.", cor: "bg-purple-50 text-purple-700" },
] as const;

/**
 * Exibe (somente leitura) os contatos do cliente agrupados por tipo de comunicação.
 * Os contatos são gerenciados na aba "Contatos"; aqui apenas refletimos por área.
 */
export function ComunicacaoContatos({ clienteId, ativo, onGerenciar }: { clienteId: string; ativo: boolean; onGerenciar: () => void }) {
  const [contatos, setContatos] = useState<Contato[] | null>(null);

  useEffect(() => {
    if (!ativo) return;
    let cancelado = false;
    setContatos(null);
    fetch(`/api/clientes/${clienteId}/contatos`)
      .then((r) => r.json())
      .then((d) => { if (!cancelado) setContatos(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelado) setContatos([]); });
    return () => { cancelado = true; };
  }, [clienteId, ativo]);

  return (
    <div className="space-y-6">
      {SECOES.map((s) => {
        const lista = (contatos ?? []).filter((c) => c.tipo === s.tipo);
        return (
          <div key={s.tipo} className="space-y-2">
            <h4 className="text-sm font-semibold text-ink">{s.titulo}</h4>

            {contatos === null ? (
              <div className="flex items-center gap-2 text-sm text-ink-muted py-1"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</div>
            ) : lista.length === 0 ? (
              <p className="text-sm text-ink-muted py-1">{s.vazio}</p>
            ) : (
              <div className="space-y-1.5">
                {lista.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 border border-surface-border rounded-lg p-2.5">
                    <div className="min-w-0 flex items-center gap-2.5">
                      <UserCircle className="w-4 h-4 text-ink-subtle shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink truncate">{c.nome}</p>
                        <p className="text-xs text-ink-muted flex items-center gap-1 truncate">
                          <Mail className="w-3 h-3 shrink-0" /> {c.email || "sem e-mail"}{c.telefone ? ` · ${c.telefone}` : ""}
                        </p>
                      </div>
                    </div>
                    <span className={cn("hidden md:inline text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0", s.cor)}>{s.recebe}</span>
                  </div>
                ))}
              </div>
            )}

            <button type="button" onClick={onGerenciar} className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 transition-colors">
              Gerenciar contatos <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
