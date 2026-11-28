"use client";

import { useState } from "react";
import { Check, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmar } from "@/components/ui/avisos";
import { Dica } from "@/components/ui/dica";
import { CampoNumero } from "@/components/orcamento/itens-tabela";
import { formatarMoeda } from "@/lib/utils";
import { DICA_A_CONFERIR, lerConferencia, ROTULO_A_CONFERIR } from "@/lib/os/material-campo-cobranca";

export interface ItemCampoConferir { id: string; descricao: string; quantidade: unknown; valorUnitario: unknown }

const num = (v: unknown) => Number(v ?? 0) || 0;

/**
 * Leva I.2 — "Material de campo a conferir" (Comercial › Itens da OS): o que o técnico lançou no app e virou item
 * cobrado ("Cobrado à parte"). Confirmar (com o preço e a quantidade ajustáveis) ou Excluir da cobrança. Sem a
 * permissão de editar a OS (ou já faturada), só a lista.
 */
export function MaterialCampoConferir({ osId, itens, podeConferir, onConferido }: {
  osId: string; itens: ItemCampoConferir[]; podeConferir: boolean;
  /** item conferido (o item atualizado) ou removido (null) */
  onConferido: (itemId: string, item: Record<string, unknown> | null) => void;
}) {
  if (!itens.length) return null;
  return (
    <section className="border border-atencao/30 bg-atencao-claro/40 rounded-lg overflow-hidden" data-material-campo-conferir>
      <h4 className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-ink border-b border-atencao/20">
        <Truck className="w-4 h-4 text-atencao-texto" aria-hidden /> {ROTULO_A_CONFERIR} <span className="text-ink-muted font-normal">({itens.length})</span>
        <Dica texto={DICA_A_CONFERIR} rotulo={ROTULO_A_CONFERIR} />
      </h4>
      <ul className="divide-y divide-atencao/20">
        {itens.map((i) => <Linha key={i.id} osId={osId} item={i} podeConferir={podeConferir} onConferido={onConferido} />)}
      </ul>
    </section>
  );
}

function Linha({ osId, item, podeConferir, onConferido }: { osId: string; item: ItemCampoConferir; podeConferir: boolean; onConferido: (id: string, item: Record<string, unknown> | null) => void }) {
  const [quantidade, setQuantidade] = useState(num(item.quantidade));
  const [valorUnitario, setValorUnitario] = useState(num(item.valorUnitario));
  const [enviando, setEnviando] = useState<"confirmar" | "remover" | null>(null);
  const [erro, setErro] = useState("");
  // O preço fora da tabela do cliente: o servidor pede o motivo (a mesma trava dos itens da OS)
  const [pedeMotivo, setPedeMotivo] = useState(false);
  const [motivo, setMotivo] = useState("");

  async function conferir(acao: "confirmar" | "remover") {
    setErro("");
    if (acao === "confirmar") {
      const v = lerConferencia({ quantidade: num(item.quantidade), valorUnitario: num(item.valorUnitario) }, { quantidade, valorUnitario });
      if (!v.ok) { setErro(v.erro); return; }
    }
    if (acao === "remover" && !(await confirmar({
      titulo: "Excluir da cobrança?", mensagem: `${item.descricao} sai da cobrança desta OS. O uso em campo e o estoque ficam como estão.`, perigo: true, confirmarTexto: "Excluir",
    }))) return;
    setEnviando(acao);
    const res = await fetch(`/api/ordens/${osId}/orcamento/${item.id}/conferir-campo`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(acao === "confirmar" ? { acao, quantidade, valorUnitario, ...(motivo.trim() ? { motivoPrecoTabela: motivo.trim() } : {}) } : { acao }),
    }).catch(() => null);
    const d = await res?.json().catch(() => null);
    setEnviando(null);
    if (!res?.ok) {
      if (d?.precoTabela && res?.status === 400) setPedeMotivo(true);
      setErro(d?.erro ?? "Não foi possível concluir a conferência.");
      return;
    }
    onConferido(item.id, acao === "confirmar" ? d?.item ?? null : null);
  }

  return (
    <li className="px-3 py-2.5 text-sm space-y-2" data-campo-conferir={item.id}>
      <div className="flex flex-wrap items-end gap-3">
        <p className="min-w-0 flex-1 text-ink font-medium">{item.descricao}</p>
        {podeConferir ? (
          <>
            <label className="text-xs text-ink-muted">Qtd
              <CampoNumero valor={quantidade} onValor={setQuantidade} className="input-base mt-0.5 w-20 !py-1.5" aria-label={`Quantidade de ${item.descricao}`} data-campo-qtd />
            </label>
            <label className="text-xs text-ink-muted">Unit. (R$)
              <CampoNumero valor={valorUnitario} casas={2} onValor={setValorUnitario} className="input-base mt-0.5 w-28 !py-1.5" aria-label={`Preço de venda de ${item.descricao}`} data-campo-preco />
            </label>
          </>
        ) : (
          <span className="text-ink-muted tabular-nums">{num(item.quantidade)} × {formatarMoeda(num(item.valorUnitario))}</span>
        )}
        <span className="font-medium text-ink tabular-nums" data-campo-total>{formatarMoeda(Math.round(quantidade * valorUnitario * 100) / 100)}</span>
      </div>
      {!(num(item.valorUnitario) > 0) && <p className="text-xs text-atencao-texto" data-campo-sem-preco>Sem preço de venda no catálogo: informe o preço.</p>}
      {podeConferir && pedeMotivo && (
        <label className="block text-xs text-ink-muted">Motivo da alteração do preço de tabela (fica no histórico da OS)
          <Input value={motivo} onChange={(ev) => setMotivo(ev.target.value)} maxLength={300} placeholder="Ex.: desconto negociado com o cliente" className="mt-0.5" data-campo-motivo-preco />
        </label>
      )}
      {erro && <p role="alert" className="text-xs text-atrasado-texto" data-erro-campo>{erro}</p>}
      {podeConferir && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => conferir("remover")} loading={enviando === "remover"} disabled={!!enviando} data-campo-remover>
            <Trash2 className="w-3.5 h-3.5" aria-hidden /> Excluir da cobrança
          </Button>
          <Button type="button" size="sm" onClick={() => conferir("confirmar")} loading={enviando === "confirmar"} disabled={!!enviando} data-campo-confirmar>
            <Check className="w-3.5 h-3.5" aria-hidden /> Confirmar
          </Button>
        </div>
      )}
    </li>
  );
}
