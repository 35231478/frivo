"use client";

import { useRouter } from "next/navigation";
import { EditarNoContexto, type EdicaoDoSelecionado } from "@/components/ui/select-cadastro-rapido";
import { motivoDaLinhaDoOrcamento, numeroDoCampo, numeroParaCampo } from "@/lib/edicao-contexto";

export interface LinhaParaEditar {
  id: string; descricao: string; quantidade: number;
  /** O preço que se edita: o unitário — ou o unitário BASE, no serviço com materiais */
  valorUnitario: number;
  observacao: string | null; materialId: string | null; comMateriais: boolean; valorManual: boolean;
}

/**
 * A linha do orçamento como USO, no detalhe do orçamento: o lápis abre "Editando este item do orçamento"
 * (descrição, quantidade, preço aplicado NESTE orçamento e observação — o catálogo nunca muda). Orçamento
 * aprovado, faturado ou com nota é registro fechado: cadeado com o motivo no ⓘ; enviado, reprovado e
 * cancelado seguem a regra de sempre (só o rascunho se edita). O servidor confere de novo.
 */
export function EditarLinhaOrcamento({ orcamentoId, status, faturado, linha }: { orcamentoId: string; status: string; faturado: boolean; linha: LinhaParaEditar }) {
  const router = useRouter();
  const semPreco = linha.valorManual && linha.comMateriais;
  const edicao: EdicaoDoSelecionado = {
    escopo: "uso", alvo: "este item do orçamento", travado: motivoDaLinhaDoOrcamento(linha, { status, faturado }),
    permissao: { modulo: "orcamentos", acao: "editar" }, mensagemSucesso: "Item do orçamento atualizado.",
    campos: [
      { nome: "descricao", label: "Descrição", obrigatorio: true, tipo: "textarea" },
      { nome: "quantidade", label: "Quantidade", obrigatorio: true, colunas: 3, inputMode: "decimal" },
      // Total digitado à mão no serviço com materiais: o preço é esse total (muda no formulário do orçamento)
      ...(semPreco ? [] : [{ nome: "valorUnitario", label: linha.comMateriais ? "Unit. base (R$)" : "Valor unitário (R$)", obrigatorio: true, colunas: 3 as const, inputMode: "decimal" as const }]),
      { nome: "observacao", label: "Observação", tipo: "textarea", placeholder: "Aparece abaixo do item no documento" },
    ],
    valores: () => ({
      descricao: linha.descricao, quantidade: numeroParaCampo(linha.quantidade), valorUnitario: numeroParaCampo(linha.valorUnitario, 2), observacao: linha.observacao ?? "",
    }),
    // Formulário completo (materiais, desconto, condições): o editar de sempre
    linkCadastroCompleto: undefined,
    acaoSecundaria: () => ({ rotulo: "Abrir o formulário do orçamento", onClick: () => router.push(`/orcamentos/${orcamentoId}/editar`) }),
    async salvar(id, valores, alterados) {
      const corpo: Record<string, unknown> = {};
      for (const k of alterados) corpo[k] = k === "descricao" ? valores[k] : k === "observacao" ? valores[k] || null : numeroDoCampo(valores[k]);
      if ("quantidade" in corpo && !(Number(corpo.quantidade) > 0)) throw new Error("Quantidade deve ser maior que zero.");
      if ("valorUnitario" in corpo && corpo.valorUnitario === null) throw new Error("Valor unitário inválido.");
      const res = await fetch(`/api/orcamentos/${orcamentoId}/linhas/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.linha) throw new Error(d?.erro ?? "Não foi possível salvar o item.");
      // O documento e os totais vêm do servidor: a tela lê de novo
      router.refresh();
    },
  };
  return <EditarNoContexto id={linha.id} rotulo={`Editar ${linha.descricao}`} edicao={edicao} />;
}
