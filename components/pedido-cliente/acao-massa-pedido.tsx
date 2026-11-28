"use client";

import { useState } from "react";
import { FileSignature } from "lucide-react";
import { useSelecaoMassa } from "@/components/acoes-massa/selecao";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { GavetaPedido } from "@/components/pedido-cliente/gaveta-pedido";

/**
 * "Informar pedido do cliente" na barra de ações em massa das listas de OS e de orçamentos: um pedido para várias
 * OS/orçamentos do MESMO cliente (a gaveta avisa e não deixa salvar se forem de clientes diferentes).
 * Quem informa: para OS, quem edita OS ou lança faturas; para orçamentos, quem edita orçamentos ou lança faturas.
 */
export function AcaoMassaPedido() {
  const sel = useSelecaoMassa();
  const { pode } = usePermissoes();
  const [aberta, setAberta] = useState(false);
  const ehOs = sel.entidade === "ordens";
  const permitido = pode("financeiro", "medicoes") || pode(ehOs ? "ordens" : "orcamentos", "editar");
  if (!permitido || (sel.entidade !== "ordens" && sel.entidade !== "orcamentos")) return null;
  const ids = [...sel.selecionados];
  return (
    <>
      <button type="button" onClick={() => setAberta(true)} data-acao-massa="informar-pedido"
        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-white hover:bg-surface-page px-3 py-1.5 text-sm font-medium whitespace-nowrap">
        <FileSignature className="w-4 h-4" aria-hidden /> Informar pedido do cliente
      </button>
      {aberta && (
        <GavetaPedido aberto onFechar={() => setAberta(false)} alvo={ehOs ? { osIds: ids } : { orcamentoIds: ids }} onConcluido={sel.limpar} />
      )}
    </>
  );
}
