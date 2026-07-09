"use client";

import { useEffect, useState } from "react";
import { cn, SECOES_COMUNICACAO, LABELS_CANAL_COMUNICACAO } from "@/lib/utils";
import { UserCircle, Loader2, ArrowRight, Check, AlertCircle, Send } from "lucide-react";

interface Contato {
  id: string;
  nome: string;
  email?: string | null;
  telefone?: string | null;
  whatsapp?: string | null;
}

interface Pref { contatoId: string; tipo: string; canal: string }

const CANAIS = ["EMAIL", "WHATSAPP", "AMBOS"] as const;

type Selecao = Record<string, Record<string, string>>; // tipo -> contatoId -> canal
const vazio = (): Selecao => ({ ORDENS: {}, ORCAMENTOS: {}, FINANCEIRO: {} });

/**
 * Configura QUEM recebe O QUE e por qual CANAL. Três seções (Ordens/Orçamentos/
 * Financeiro), cada uma listando os contatos cadastrados com checkbox + canal.
 * Persiste automaticamente via PUT /api/clientes/[id]/comunicacao.
 */
export function ComunicacaoPreferencias({ clienteId, ativo, onGerenciar }: { clienteId: string; ativo: boolean; onGerenciar: () => void }) {
  const [contatos, setContatos] = useState<Contato[] | null>(null);
  const [sel, setSel] = useState<Selecao>(vazio());
  const [status, setStatus] = useState<"idle" | "salvando" | "salvo" | "erro">("idle");

  useEffect(() => {
    if (!ativo) return;
    let cancelado = false;
    setContatos(null);
    Promise.all([
      fetch(`/api/clientes/${clienteId}/contatos`).then((r) => r.json()).catch(() => []),
      fetch(`/api/clientes/${clienteId}/comunicacao`).then((r) => r.json()).catch(() => []),
    ]).then(([cts, prefs]: [Contato[], Pref[]]) => {
      if (cancelado) return;
      setContatos(Array.isArray(cts) ? cts : []);
      const s = vazio();
      (Array.isArray(prefs) ? prefs : []).forEach((p) => {
        if (s[p.tipo]) s[p.tipo][p.contatoId] = p.canal;
      });
      setSel(s);
    });
    return () => { cancelado = true; };
  }, [clienteId, ativo]);

  async function persistir(next: Selecao) {
    setStatus("salvando");
    const preferencias: Pref[] = [];
    for (const tipo of Object.keys(next)) {
      for (const [contatoId, canal] of Object.entries(next[tipo])) preferencias.push({ contatoId, tipo, canal });
    }
    try {
      const res = await fetch(`/api/clientes/${clienteId}/comunicacao`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferencias }),
      });
      setStatus(res.ok ? "salvo" : "erro");
    } catch { setStatus("erro"); }
  }

  function toggle(tipo: string, contatoId: string) {
    setSel((prev) => {
      const nextTipo = { ...prev[tipo] };
      if (nextTipo[contatoId]) delete nextTipo[contatoId];
      else nextTipo[contatoId] = "EMAIL";
      const next = { ...prev, [tipo]: nextTipo };
      persistir(next);
      return next;
    });
  }

  function setCanal(tipo: string, contatoId: string, canal: string) {
    setSel((prev) => {
      const next = { ...prev, [tipo]: { ...prev[tipo], [contatoId]: canal } };
      persistir(next);
      return next;
    });
  }

  if (contatos === null) {
    return <div className="flex items-center gap-2 text-sm text-ink-muted py-3"><Loader2 className="w-4 h-4 animate-spin" /> Carregando contatos…</div>;
  }

  if (contatos.length === 0) {
    return (
      <div className="text-center py-8 border border-dashed border-surface-border rounded-xl">
        <Send className="w-6 h-6 text-ink-subtle mx-auto mb-2" />
        <p className="text-sm text-ink-muted">Nenhum contato cadastrado ainda.</p>
        <button type="button" onClick={onGerenciar} className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 mt-1">
          Cadastrar contatos <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-muted">
          Marque quem recebe cada tipo de comunicação e por qual canal. Um mesmo contato pode receber várias comunicações.
        </p>
        <StatusSalvamento status={status} />
      </div>

      {SECOES_COMUNICACAO.map((s) => (
        <div key={s.tipo} className="rounded-xl border border-surface-border overflow-hidden">
          <div className="bg-surface-alt/60 px-4 py-3 border-b border-surface-border">
            <h4 className="text-sm font-semibold text-ink">{s.titulo}</h4>
            <p className="text-xs text-ink-muted mt-0.5">{s.descricao}</p>
          </div>
          <div className="divide-y divide-surface-border">
            {contatos.map((c) => {
              const canal = sel[s.tipo]?.[c.id];
              const marcado = !!canal;
              const semWhats = marcado && (canal === "WHATSAPP" || canal === "AMBOS") && !c.whatsapp;
              return (
                <div key={c.id} className={cn("flex items-center justify-between gap-3 px-4 py-2.5 transition-colors", marcado ? "bg-primary-50/40" : "hover:bg-surface-alt/40")}>
                  <label className="flex items-center gap-2.5 min-w-0 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() => toggle(s.tipo, c.id)}
                      className="accent-primary-600 w-4 h-4 shrink-0"
                    />
                    <UserCircle className="w-4 h-4 text-ink-subtle shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{c.nome}</p>
                      <p className="text-xs text-ink-muted truncate">
                        {c.email || "sem e-mail"}{c.telefone ? ` · ${c.telefone}` : ""}
                      </p>
                    </div>
                  </label>

                  {marcado && (
                    <div className="flex items-center gap-2 shrink-0">
                      {semWhats && (
                        <span title="Contato sem WhatsApp cadastrado" className="text-amber-500"><AlertCircle className="w-4 h-4" /></span>
                      )}
                      <select
                        value={canal}
                        onChange={(e) => setCanal(s.tipo, c.id, e.target.value)}
                        className="bg-white border border-surface-border rounded-lg px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/10 transition-all"
                      >
                        {CANAIS.map((ch) => (<option key={ch} value={ch}>{LABELS_CANAL_COMUNICACAO[ch]}</option>))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <p className="text-xs text-ink-subtle">
        O envio por WhatsApp será habilitado em breve — por enquanto apenas o e-mail é enviado automaticamente; o canal fica salvo para quando o envio por WhatsApp estiver disponível.
      </p>
    </div>
  );
}

function StatusSalvamento({ status }: { status: "idle" | "salvando" | "salvo" | "erro" }) {
  if (status === "idle") return null;
  if (status === "salvando") return <span className="inline-flex items-center gap-1 text-xs text-ink-muted shrink-0"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Salvando…</span>;
  if (status === "salvo") return <span className="inline-flex items-center gap-1 text-xs text-success-700 shrink-0"><Check className="w-3.5 h-3.5" /> Salvo</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-red-600 shrink-0"><AlertCircle className="w-3.5 h-3.5" /> Erro ao salvar</span>;
}
