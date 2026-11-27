"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Minus, Package, Plus, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Dica } from "@/components/ui/dica";
import { confirmar, toast } from "@/components/ui/avisos";
import { useTecnico } from "@/components/tecnico/contexto";
import { lerNumero } from "@/components/tecnico/equipamento";
import { novoClientId } from "@/lib/tecnico/offline/motor";
import { arred } from "@/lib/estoque/regras";
import { buscarNoCatalogo, QTD_MAX, textoQuantidade, type MaterialTela, type ProdutoCatalogo } from "@/lib/tecnico/materiais";
import type { ExecucaoTela, NovaOperacao } from "@/lib/tecnico/offline/tipos";

type Registrar = (ops: NovaOperacao[]) => Promise<void>;

/** O catálogo guardado no aparelho (baixa de novo quando há sinal; sem sinal, o que ficou). */
export function useCatalogo(ativo: boolean) {
  const { motor } = useTecnico();
  const [produtos, setProdutos] = useState<ProdutoCatalogo[] | null>(null);
  useEffect(() => {
    if (!ativo || !motor) return;
    let vivo = true;
    void motor.baixarLista<{ produtos: ProdutoCatalogo[] }>("catalogo", "/api/tecnico/catalogo").then((r) => { if (vivo) setProdutos(r.dados?.produtos ?? []); });
    return () => { vivo = false; };
  }, [ativo, motor]);
  return produtos;
}

/**
 * MATERIAIS USADOS — um lugar só, na OS e em cada equipamento. Com `equipamentoId`, mostra e lança os
 * daquele equipamento; sem, todos da atividade. O técnico corrige ou tira o que ELE lançou, com a atividade aberta.
 */
export function MateriaisUsados({ x, registrar, equipamentoId, nomeEquipamento }: {
  x: ExecucaoTela; registrar: Registrar;
  /** undefined = todos da atividade; string = só os deste equipamento */ equipamentoId?: string;
  nomeEquipamento?: (id: string) => string | null;
}) {
  const so = x.bloqueada;
  const todos = x.materiais ?? [];
  const lista = equipamentoId === undefined ? todos : todos.filter((m) => m.equipamentoId === equipamentoId);
  const [aberto, setAberto] = useState<MaterialTela | "novo" | null>(null);
  return (
    <section className="space-y-2" data-materiais={equipamentoId ?? "atividade"}>
      <h2 className="text-base font-bold text-ink inline-flex items-center gap-1.5">
        <Package className="w-4 h-4 text-ink-muted" /> Materiais usados
        {lista.length > 0 && <span className="text-xs font-semibold rounded-full bg-surface-linha text-ink px-2 py-0.5" data-contagem-materiais>{lista.length}</span>}
        <Dica rotulo="Materiais usados" texto="Busque no catálogo e informe a quantidade. A baixa sai do estoque com o veículo registrado; o que foi separado para esta OS é abatido da separação. Funciona sem sinal." />
      </h2>
      {lista.length > 0 && (
        <ul className="rounded-card border border-surface-border bg-white divide-y divide-surface-border">
          {lista.map((m) => {
            const pode = !so && m.meu;
            const equip = equipamentoId === undefined && m.equipamentoId ? nomeEquipamento?.(m.equipamentoId) : null;
            return (
              <li key={m.clientId}>
                <button type="button" disabled={!pode} onClick={() => setAberto(m)} data-material={m.clientId} data-pendente={m.pendente || undefined}
                  className="w-full text-left px-3 py-3 flex items-center gap-3 disabled:cursor-default active:bg-surface-alt touch-target">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink truncate">{m.descricao}</span>
                    <span className="block text-xs text-ink-muted truncate">{[equip, !m.meu && m.criadoPor, m.pendente && "no aparelho"].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="text-base font-bold text-ink tabular-nums shrink-0" data-qtd>{textoQuantidade(m.quantidade, m.unidade)}</span>
                  {pode && <ChevronRight className="w-5 h-5 text-ink-subtle shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!so && (
        <button type="button" onClick={() => setAberto("novo")} data-novo-material
          className="w-full rounded-card border-2 border-dashed border-primary-300 bg-white text-primary-700 py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target">
          <Plus className="w-5 h-5" /> Adicionar material
        </button>
      )}
      {aberto && <ModalMaterial x={x} registrar={registrar} linha={aberto === "novo" ? null : aberto} equipamentoId={equipamentoId} onFechar={() => setAberto(null)} />}
    </section>
  );
}

const rotuloEquip = (e: ExecucaoTela["equipamentos"][number]["equipamento"]) => [e.titulo, e.tag && `TAG ${e.tag}`, e.local].filter(Boolean).join(" — ");

/** Escolher no catálogo (ou descrever) → quantidade → equipamento. Grava no aparelho. */
function ModalMaterial({ x, registrar, linha, equipamentoId, onFechar }: {
  x: ExecucaoTela; registrar: Registrar; linha: MaterialTela | null; equipamentoId?: string; onFechar: () => void;
}) {
  const atividadeId = x.atividade.id;
  const catalogo = useCatalogo(!linha);
  const [busca, setBusca] = useState("");
  const [produto, setProduto] = useState<ProdutoCatalogo | null>(null);
  const [avulso, setAvulso] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [unidade, setUnidade] = useState("un");
  const [qtd, setQtd] = useState(linha ? String(linha.quantidade).replace(".", ",") : "1");
  const [equip, setEquip] = useState<string>(linha ? (linha.equipamentoId ?? "") : (equipamentoId ?? ""));
  const [gravando, setGravando] = useState(false);
  const achados = useMemo(() => buscarNoCatalogo(catalogo ?? [], busca), [catalogo, busca]);
  const escolhido = !!linha || !!produto || (avulso && descricao.trim().length >= 2);
  const n = lerNumero(qtd);
  const qtdOk = n !== null && Number.isFinite(n) && n > 0 && n <= QTD_MAX;
  const passo = (d: number) => setQtd(String(arred(Math.max(0, (Number.isFinite(n ?? NaN) ? n ?? 0 : 0) + d))).replace(".", ","));

  async function salvar() {
    if (!escolhido || !qtdOk) return;
    setGravando(true);
    try {
      await registrar([{
        tipo: "material", atividadeId,
        dados: {
          clientId: linha?.clientId ?? novoClientId(), quantidade: arred(n!), equipamentoId: equip || null,
          ...(linha ? {} : produto
            // O nome e a unidade vão junto para o aparelho mostrar já (o servidor usa os do cadastro)
            ? { produtoId: produto.id, descricao: produto.nome.slice(0, 160), unidade: produto.unidade.slice(0, 12) }
            : { produtoId: null, descricao: descricao.trim(), unidade: unidade.trim() || "un" }),
        },
      }]);
      toast(linha ? "Quantidade corrigida." : "Material lançado.");
      onFechar();
    } finally { setGravando(false); }
  }
  async function remover() {
    if (!linha) return;
    const okExcluir = await confirmar({ titulo: "Excluir material?", mensagem: `${linha.descricao} · ${textoQuantidade(linha.quantidade, linha.unidade)}`, perigo: true, confirmarTexto: "Excluir" });
    if (!okExcluir) return;
    await registrar([{ tipo: "materialRemover", atividadeId, dados: linha.id && !linha.pendente ? { id: linha.id } : { clientId: linha.clientId } }]);
    toast("Material excluído.");
    onFechar();
  }

  return (
    <Modal aberto titulo={linha ? "Material usado" : "Adicionar material"} onFechar={onFechar}>
      <div className="space-y-4" data-modal-material>
        {!escolhido && !avulso && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus placeholder="Nome ou código" aria-label="Pesquisar no catálogo" data-busca-material
                className="w-full rounded-card border border-surface-border pl-10 pr-3 py-3.5 text-base" />
            </div>
            {catalogo === null && <p className="text-sm text-ink-muted">Carregando o catálogo…</p>}
            {catalogo !== null && !catalogo.length && <p className="text-sm text-ink-muted" data-catalogo-vazio>Catálogo indisponível no aparelho. Abra com sinal uma vez ou descreva o material.</p>}
            {busca.trim() && catalogo !== null && !achados.length && <p className="text-sm text-ink-muted">Nada encontrado.</p>}
            <ul className="divide-y divide-surface-border max-h-[45vh] overflow-y-auto" data-resultados-material>
              {achados.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setProduto(p)} data-produto={p.id} className="w-full text-left py-3 flex items-center gap-3 active:bg-surface-alt touch-target">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink">{p.nome}</span>
                      <span className="block text-xs text-ink-muted">{[p.codigo != null && `Cód. ${p.codigo}`, p.unidade].filter(Boolean).join(" · ")}</span>
                    </span>
                    <ChevronRight className="w-5 h-5 text-ink-subtle shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => { setAvulso(true); setDescricao(busca.trim()); }} data-material-avulso className="w-full py-3 text-sm font-semibold text-primary-700 touch-target">
              Não está no catálogo
            </button>
          </div>
        )}
        {avulso && !produto && !linha && (
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <label className="block space-y-1">
              <span className="text-sm font-semibold text-ink">Material</span>
              <input value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={160} aria-label="Descrição do material" data-descricao-material
                className="w-full rounded-card border border-surface-border px-3 py-3 text-base" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-semibold text-ink">Unidade</span>
              <input value={unidade} onChange={(e) => setUnidade(e.target.value)} maxLength={12} aria-label="Unidade" className="w-full rounded-card border border-surface-border px-3 py-3 text-base" />
            </label>
          </div>
        )}
        {escolhido && (
          <>
            <div className="rounded-card bg-surface-alt border border-surface-border px-3 py-2.5 flex items-center justify-between gap-2" data-material-escolhido>
              <span className="font-semibold text-ink">{linha?.descricao ?? produto?.nome ?? descricao}</span>
              {!linha && <button type="button" onClick={() => { setProduto(null); setAvulso(false); }} className="text-sm font-semibold text-primary-700 px-2 touch-target">Trocar</button>}
            </div>
            <div className="space-y-1">
              <span className="text-sm font-semibold text-ink">Quantidade ({linha?.unidade ?? produto?.unidade ?? (unidade || "un")})</span>
              <div className="flex items-stretch gap-2">
                <button type="button" onClick={() => passo(-1)} aria-label="Menos 1" className="w-16 rounded-card border border-surface-border bg-white inline-flex items-center justify-center touch-target"><Minus className="w-6 h-6" /></button>
                <input value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="decimal" aria-label="Quantidade" data-qtd-material
                  className={cn("flex-1 min-w-0 rounded-card border px-3 py-3 text-center text-2xl font-bold tabular-nums", qtdOk ? "border-surface-border" : "border-atrasado")} />
                <button type="button" onClick={() => passo(1)} aria-label="Mais 1" className="w-16 rounded-card border border-surface-border bg-white inline-flex items-center justify-center touch-target"><Plus className="w-6 h-6" /></button>
              </div>
              {!qtdOk && <p className="text-xs text-atrasado-texto" data-qtd-invalida>Informe uma quantidade maior que zero.</p>}
            </div>
            {x.equipamentos.length > 0 && (
              <label className="block space-y-1">
                <span className="text-sm font-semibold text-ink">Equipamento</span>
                <select value={equip} onChange={(e) => setEquip(e.target.value)} aria-label="Equipamento do material" data-equipamento-material
                  className="w-full rounded-card border border-surface-border bg-white px-3 py-3 text-base">
                  <option value="">Geral da atividade</option>
                  {x.equipamentos.map((e) => <option key={e.equipamento.id} value={e.equipamento.id}>{rotuloEquip(e.equipamento)}</option>)}
                </select>
              </label>
            )}
            <button type="button" disabled={!qtdOk || gravando} onClick={salvar} data-salvar-material
              className="w-full rounded-card bg-primary-600 text-white py-4 text-base font-bold disabled:opacity-40 touch-target">{linha ? "Salvar" : "Lançar"}</button>
            {linha && (
              <button type="button" onClick={remover} data-remover-material className="w-full inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-atrasado py-2 touch-target">
                <Trash2 className="w-4 h-4" /> Excluir
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
