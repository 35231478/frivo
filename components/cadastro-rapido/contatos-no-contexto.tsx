"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Pencil, Plus, X } from "lucide-react";
import { toast } from "@/components/ui/avisos";
import { camposAlterados } from "@/lib/edicao-contexto";
import { cn } from "@/lib/utils";

interface Contato { id: string; nome: string; cargo: string | null; telefone: string | null; email: string | null; principal?: boolean }
type Form = { nome: string; cargo: string; telefone: string; email: string };
const CAMPOS = ["nome", "cargo", "telefone", "email"] as const;
const VAZIO: Form = { nome: "", cargo: "", telefone: "", email: "" };
const doContato = (c: Contato): Form => ({ nome: c.nome ?? "", cargo: c.cargo ?? "", telefone: c.telefone ?? "", email: c.email ?? "" });
const campo = "w-full bg-white border border-surface-campo rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10";

/**
 * Os contatos do cliente dentro do painel "Editando o cadastro do cliente" (edição no contexto): lista,
 * adiciona e corrige nome, cargo, telefone e e-mail sem sair da OS nem do orçamento. É o cadastro-mãe —
 * muda em todo lugar, como diz a faixa do painel. Só o que mudou vai para o servidor; excluir, marcar o
 * principal e o acesso ao portal continuam no cadastro completo.
 */
export function ContatosNoContexto({ clienteId, aoMudar }: { clienteId: string; aoMudar?: () => void }) {
  const [contatos, setContatos] = useState<Contato[] | null>(null);
  const [erro, setErro] = useState("");
  /** id do contato em edição, "novo" ou null (lista) */
  const [aberto, setAberto] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(VAZIO);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/clientes/${clienteId}/contatos`, { cache: "no-store" });
      const d = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(d)) { setErro(d?.erro ?? "Não foi possível carregar os contatos."); setContatos([]); return; }
      setContatos(d);
    } catch { setErro("Erro de conexão."); setContatos([]); }
  }, [clienteId]);
  useEffect(() => { void carregar(); }, [carregar]);

  const abrir = (c: Contato | null) => { setErro(""); setForm(c ? doContato(c) : VAZIO); setAberto(c ? c.id : "novo"); };

  async function salvar() {
    if (form.nome.trim().length < 2) { setErro("Informe o nome do contato."); return; }
    const atual = aberto === "novo" ? null : contatos?.find((c) => c.id === aberto) ?? null;
    const limpo = Object.fromEntries(CAMPOS.map((k) => [k, form[k].trim()])) as Form;
    const mudou = (atual ? camposAlterados(doContato(atual), limpo, CAMPOS) : CAMPOS.filter((k) => limpo[k])) as (keyof Form)[];
    // Nada mudou: fecha sem chamar o servidor
    if (atual && !mudou.length) { setAberto(null); return; }
    setSalvando(true); setErro("");
    try {
      const r = await fetch(atual ? `/api/clientes/${clienteId}/contatos/${atual.id}` : `/api/clientes/${clienteId}/contatos`, {
        method: atual ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(mudou.map((k) => [k, limpo[k]]))),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.id) { setErro(d?.erro ?? "Não foi possível salvar o contato."); return; }
      setContatos((l) => (atual ? (l ?? []).map((c) => (c.id === d.id ? { ...c, ...d } : c)) : [...(l ?? []), d]));
      toast(atual ? "Contato atualizado." : "Contato adicionado.");
      setAberto(null);
      aoMudar?.();
    } catch { setErro("Erro de conexão: nada foi salvo."); } finally { setSalvando(false); }
  }

  return (
    <section data-contatos-no-contexto className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-ink">Contatos</h4>
        {aberto === null && contatos && (
          <button type="button" onClick={() => abrir(null)} data-novo-contato className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700">
            <Plus className="w-3.5 h-3.5" aria-hidden /> Adicionar contato
          </button>
        )}
      </div>

      {contatos === null && <p className="flex items-center gap-2 text-xs text-ink-muted"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Carregando…</p>}
      {contatos?.length === 0 && aberto === null && !erro && <p className="text-xs text-ink-muted" data-sem-contatos>Nenhum contato cadastrado.</p>}

      {aberto === null && !!contatos?.length && (
        <ul className="divide-y divide-surface-linha rounded-lg border border-surface-border">
          {contatos.map((c) => (
            <li key={c.id} data-contato={c.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink truncate">{c.nome}{c.cargo && <span className="text-ink-muted"> · {c.cargo}</span>}</p>
                <p className="text-xs text-ink-muted truncate">{[c.telefone, c.email].filter(Boolean).join(" · ") || "Sem telefone nem e-mail"}</p>
              </div>
              <button type="button" onClick={() => abrir(c)} aria-label={`Editar o contato ${c.nome}`} title={`Editar o contato ${c.nome}`}
                className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg text-ink-muted hover:text-primary-600 hover:bg-primary-50">
                <Pencil className="w-4 h-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {aberto !== null && (
        <div data-form-contato className="space-y-2 rounded-lg border border-surface-border bg-surface-page p-3"
          onKeyDown={(e) => {
            // Enter grava o contato, não o painel do cliente em volta
            if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); e.stopPropagation(); void salvar(); }
          }}>
          <p className="text-xs font-semibold text-ink">{aberto === "novo" ? "Novo contato" : "Editar contato"}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input autoFocus aria-label="Nome do contato" placeholder="Nome" value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} className={cn(campo, "sm:col-span-2")} />
            <input aria-label="Cargo" placeholder="Cargo" value={form.cargo} onChange={(e) => setForm((f) => ({ ...f, cargo: e.target.value }))} className={campo} />
            <input aria-label="Telefone do contato" placeholder="Telefone" inputMode="tel" value={form.telefone} onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))} className={campo} />
            <input aria-label="E-mail do contato" placeholder="E-mail" inputMode="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={cn(campo, "sm:col-span-2")} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setAberto(null); setErro(""); }} className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium rounded-lg border border-surface-border text-ink hover:bg-surface-alt">
              <X className="w-3.5 h-3.5" aria-hidden /> Cancelar
            </button>
            <button type="button" onClick={salvar} disabled={salvando} data-salvar-contato className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold rounded-lg bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-60">
              {salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Check className="w-3.5 h-3.5" aria-hidden />} Salvar contato
            </button>
          </div>
        </div>
      )}

      {erro && <p role="alert" className="text-xs text-atrasado bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2">{erro}</p>}
    </section>
  );
}
