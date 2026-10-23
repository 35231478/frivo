"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { cn, formatarData } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { ROTULO_COBRANCA, type StatusCobranca } from "@/lib/execucao/adicional";
import { ehTecnicoPuro } from "@/lib/tecnico/modo";

export interface AdicionalOs {
  id: string; descricao: string; statusCobranca: StatusCobranca; valor?: number | string | null; criadoEm: string | Date;
  atividade: { titulo: string }; equipamento: { nome: string | null; marca: string; modelo: string; patrimonio: string | null } | null;
  criadoPor: { nome: string } | null; fotos: { id: string }[];
}

const COR: Record<StatusCobranca, string> = {
  A_AVALIAR: "bg-amber-100 text-amber-800 border-amber-200",
  COBRAR: "bg-success-100 text-success-700 border-success-200",
  NAO_COBRAR: "bg-slate-100 text-slate-600 border-slate-200",
};

/**
 * Serviços ADICIONAIS pedidos na visita (registrados pelo técnico no app), em destaque na OS para o
 * escritório decidir a cobrança. A cobrança em si (orçamento/fatura) é a Etapa 3.
 */
export function OsAdicionais({ osId, adicionais }: { osId: string; adicionais: AdicionalOs[] }) {
  const { pode, role, permissoes } = usePermissoes();
  const decide = pode("ordens", "editar") && !ehTecnicoPuro(role, permissoes);
  const [lista, setLista] = useState(adicionais);
  const [erro, setErro] = useState<string | null>(null);
  // Marcar COBRAR exige o preço (modal da casa, não window.prompt): vira item da medição da OS
  const [cobrando, setCobrando] = useState<AdicionalOs | null>(null);
  const [preco, setPreco] = useState("");
  const [erroPreco, setErroPreco] = useState("");
  if (!lista.length) return null;
  const aAvaliar = lista.filter((a) => a.statusCobranca === "A_AVALIAR").length;

  function clicar(a: AdicionalOs, statusCobranca: StatusCobranca) {
    if (statusCobranca === "COBRAR") {
      setPreco(a.valor ? String(Number(a.valor)).replace(".", ",") : "");
      setErroPreco("");
      setCobrando(a);
      return;
    }
    void mudar(a, statusCobranca);
  }

  function confirmarCobranca() {
    if (!cobrando) return;
    const valor = Number(preco.trim().replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(valor) || valor <= 0) { setErroPreco("Informe um preço válido (maior que zero)."); return; }
    const a = cobrando;
    setCobrando(null);
    void mudar(a, "COBRAR", valor);
  }

  async function mudar(a: AdicionalOs, statusCobranca: StatusCobranca, valor?: number) {
    setErro(null);
    const antes = { statusCobranca: a.statusCobranca, valor: a.valor };
    setLista((l) => l.map((x) => (x.id === a.id ? { ...x, statusCobranca, valor: valor ?? x.valor } : x)));
    const r = await fetch(`/api/ordens/${osId}/servicos-adicionais/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statusCobranca, ...(valor !== undefined ? { valor } : {}) }) }).catch(() => null);
    if (!r?.ok) {
      setLista((l) => l.map((x) => (x.id === a.id ? { ...x, ...antes } : x)));
      setErro((await r?.json().catch(() => null))?.erro ?? "Não foi possível gravar a cobrança.");
    }
  }

  return (
    <section className="rounded-xl border-2 border-violet-300 bg-violet-50/50 p-4 space-y-3" data-os-adicionais>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-violet-900 inline-flex items-center gap-1.5">
          <Sparkles className="w-4 h-4" /> Serviços adicionais pedidos na visita ({lista.length})
        </h2>
        {aAvaliar > 0 && <span className="text-xs font-semibold rounded-full bg-amber-100 text-amber-800 px-2 py-0.5" data-a-avaliar>{aAvaliar} a avaliar para cobrança</span>}
      </div>
      {erro && <p className="text-xs text-red-600">{erro}</p>}
      <ul className="space-y-2">
        {lista.map((a) => {
          const eq = a.equipamento ? [(a.equipamento.nome ?? "").trim() || `${a.equipamento.marca} ${a.equipamento.modelo}`, a.equipamento.patrimonio && `TAG ${a.equipamento.patrimonio}`].filter(Boolean).join(" · ") : null;
          return (
            <li key={a.id} className="rounded-lg bg-white border border-violet-200 p-3 flex flex-col sm:flex-row sm:items-start gap-3" data-adicional-os={a.id}>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm text-ink whitespace-pre-wrap">{a.descricao}</p>
                <p className="text-xs text-ink-muted">{[a.atividade.titulo, eq, a.criadoPor && `por ${a.criadoPor.nome}`, formatarData(a.criadoEm)].filter(Boolean).join(" · ")}</p>
                {a.statusCobranca === "COBRAR" && a.valor != null && (
                  <p className="text-xs font-semibold text-success-700" data-valor-adicional>Preço a cobrar: {Number(a.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
                )}
                {a.fotos.length > 0 && (
                  <div className="flex gap-1.5 overflow-x-auto pt-1">
                    {a.fotos.map((f) => (
                      <a key={f.id} href={`/api/servicos-adicionais/fotos/${f.id}`} target="_blank" rel="noreferrer" className="shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/servicos-adicionais/fotos/${f.id}`} alt="Foto do serviço adicional" loading="lazy" className="w-14 h-14 rounded object-cover border border-violet-200" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
              {decide ? (
                <div className="flex sm:flex-col gap-1 shrink-0" role="group" aria-label="Cobrança">
                  {(Object.keys(ROTULO_COBRANCA) as StatusCobranca[]).map((s) => (
                    <button key={s} type="button" aria-pressed={a.statusCobranca === s} data-cobranca={s} onClick={() => a.statusCobranca !== s && clicar(a, s)}
                      className={cn("text-xs font-semibold rounded-lg border px-2.5 py-1.5", a.statusCobranca === s ? COR[s] : "bg-white border-gray-200 text-gray-500 hover:border-gray-300")}>
                      {ROTULO_COBRANCA[s]}
                    </button>
                  ))}
                </div>
              ) : (
                <span className={cn("text-xs font-semibold rounded-lg border px-2.5 py-1 shrink-0", COR[a.statusCobranca])}>{ROTULO_COBRANCA[a.statusCobranca]}</span>
              )}
            </li>
          );
        })}
      </ul>

      <Modal aberto={!!cobrando} onFechar={() => setCobrando(null)} titulo="Preço do serviço adicional" tamanho="sm">
        <div className="space-y-4" data-modal-preco-adicional>
          {cobrando && <p className="text-sm text-ink-muted whitespace-pre-wrap">{cobrando.descricao}</p>}
          <label className="block">
            <span className="block text-xs font-medium text-ink mb-1">Preço a cobrar (R$) <span className="text-red-500">*</span></span>
            <input
              autoFocus inputMode="decimal" value={preco} placeholder="0,00" data-preco-adicional
              onChange={(e) => setPreco(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmarCobranca(); } }}
              className="w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10"
            />
          </label>
          <p className="text-xs text-ink-muted">O serviço entra na medição da OS com este preço.</p>
          {erroPreco && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-erro-preco>{erroPreco}</p>}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="secondary" onClick={() => setCobrando(null)}>Cancelar</Button>
            <Button type="button" onClick={confirmarCobranca} data-confirmar-preco>Cobrar este serviço</Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
