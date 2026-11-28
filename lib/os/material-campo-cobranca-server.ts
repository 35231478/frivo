/**
 * Leva I.2 — material de campo no "Cobrado à parte": o banco. A regra pura está em ./material-campo-cobranca.
 *  - `prepararCobrancaCampo` (antes da transação do uso): a regra da OS, a trava e o preço de venda do produto;
 *  - `sincronizarItemCampo` (DENTRO da transação do uso, em lib/execucao/materiais-campo): cria, atualiza ou tira o
 *    item cobrado — o app do técnico não muda nada, quem decide é o servidor dos materiais de campo;
 *  - `conferirItemCampo`: o escritório confirma (ajustando preço/quantidade) ou remove da cobrança;
 *  - `travaFaturarCampoDaOs`: o faturamento da OS espera a conferência.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { precosDeVendaParaCliente } from "@/lib/orcamentos/materiais-server";
import { regraDaOs } from "@/lib/os/materiais-server";
import { situacaoDaOsNoBanco } from "@/lib/os/trava-edicao-server";
import { formatarMoeda } from "@/lib/utils";
import { verificarItemDaOs } from "@/lib/precos/trava-tabela-server";
import { textoDaTrilha } from "@/lib/precos/trava-tabela";

/** Valor no histórico com espaço comum (o Intl usa um que não quebra) */
const brl = (v: number) => formatarMoeda(v).replace(/\s/g, " ");
import {
  deveCobrarUsoCampo, lerConferencia, MSG_JA_CONFERIDO, planoDoItemCampo, quantidadeDoItem, travaDoCampo, travaFaturarCampo,
} from "@/lib/os/material-campo-cobranca";

type Tx = Prisma.TransactionClient;

/** O que a criação do item precisa saber, lido antes da transação do uso. null = não cobra (INCLUSO ou faturada). */
export interface CobrancaCampo { valorUnitario: number }

export async function prepararCobrancaCampo(empresaId: string, osId: string, produtoId: string | null): Promise<CobrancaCampo | null> {
  const regra = await regraDaOs(osId, empresaId, false);
  if (regra !== "A_PARTE") return null;
  const trava = travaDoCampo(await situacaoDaOsNoBanco(osId));
  if (!deveCobrarUsoCampo({ regra, jaCobradoNaOs: false, trava })) return null;
  // A regra passa a ficar gravada na OS (o item com material foi cobrado por ela)
  await regraDaOs(osId, empresaId, true);
  if (!produtoId) return { valorUnitario: 0 };
  const os = await prisma.ordemServico.findFirst({ where: { id: osId, empresaId }, select: { clienteId: true } });
  const precos = await precosDeVendaParaCliente(empresaId, os?.clienteId ?? null, [produtoId]);
  return { valorUnitario: precos.get(produtoId) ?? 0 };
}

interface UsoCampo { id: string; ordemServicoId: string; produtoId: string | null; osMaterialId: string | null; descricao: string; quantidade: number; removido: boolean }

/**
 * Leva o item cobrado ao que o uso vale agora. `cobranca` só na 1ª gravação do uso (é quando o item nasce);
 * corrigir/remover depois só mexe no item que ainda espera a conferência.
 */
export async function sincronizarItemCampo(tx: Tx, uso: UsoCampo, cobranca: CobrancaCampo | null = null) {
  const atual = await tx.osItemOrcamento.findUnique({ where: { materialCampoId: uso.id }, select: { id: true, quantidade: true, valorUnitario: true, conferirCampo: true } });
  if (atual) {
    const plano = planoDoItemCampo({ quantidade: Number(atual.quantidade), valorUnitario: Number(atual.valorUnitario), conferirCampo: atual.conferirCampo }, uso);
    if (plano.acao === "remover") await tx.osItemOrcamento.deleteMany({ where: { id: atual.id, conferirCampo: true } });
    if (plano.acao === "atualizar") await tx.osItemOrcamento.updateMany({ where: { id: atual.id, conferirCampo: true }, data: { quantidade: plano.quantidade, valorTotal: plano.valorTotal } });
    return;
  }
  if (!cobranca || uso.removido || !(uso.quantidade > 0)) return;
  // Consome a separação de um material que já é cobrado na OS (a peça/material derivado do serviço): não cobra 2×
  if (uso.osMaterialId) {
    const m = await tx.osMaterial.findUnique({ where: { id: uso.osMaterialId }, select: { linhaProduto: { select: { id: true } } } });
    if (m?.linhaProduto) return;
  }
  const quantidade = quantidadeDoItem(uso.quantidade);
  const ultimo = await tx.osItemOrcamento.findFirst({ where: { ordemServicoId: uso.ordemServicoId }, orderBy: { ordem: "desc" }, select: { ordem: true } });
  await tx.osItemOrcamento.create({
    data: {
      ordemServicoId: uso.ordemServicoId, tipo: "PRODUTO", produtoId: uso.produtoId, descricao: uso.descricao, quantidade,
      valorUnitario: cobranca.valorUnitario, valorTotal: Math.round(quantidade * cobranca.valorUnitario * 100) / 100,
      // usado em campo = executado (entra no faturamento assim que conferido)
      executado: true, executadoEm: new Date(), ordem: (ultimo?.ordem ?? -1) + 1,
      materialCampoId: uso.id, conferirCampo: true,
    },
  });
}

/** O faturamento da OS: bloqueado enquanto houver material de campo a conferir */
export async function travaFaturarCampoDaOs(osId: string): Promise<string | null> {
  return travaFaturarCampo(await prisma.osItemOrcamento.count({ where: { ordemServicoId: osId, conferirCampo: true } }));
}

type Resultado = { ok: true; item: unknown | null } | { ok: false; status: number; erro: string; precoTabela?: true };

/**
 * O escritório confere o item de campo: `confirmar` (com ajuste opcional) ou `remover` da cobrança.
 * Confirmar com o preço fora da tabela do cliente segue a trava do preço de tabela (a mesma dos itens da OS):
 * sem a permissão, 403; com ela, pede o motivo (400) e deixa a trilha.
 */
export async function conferirItemCampo(
  p: { empresaId: string; osId: string; itemId: string; usuarioId: string; user: { permissoes?: unknown; role?: string } },
  d: { acao?: unknown; quantidade?: unknown; valorUnitario?: unknown; motivoPrecoTabela?: unknown },
): Promise<Resultado> {
  if (d.acao !== "confirmar" && d.acao !== "remover") return { ok: false, status: 400, erro: "Ação inválida." };
  const os = await prisma.ordemServico.findFirst({ where: { id: p.osId, empresaId: p.empresaId }, select: { id: true } });
  if (!os) return { ok: false, status: 404, erro: "OS não encontrada" };
  const item = await prisma.osItemOrcamento.findFirst({ where: { id: p.itemId, ordemServicoId: p.osId, materialCampoId: { not: null } }, select: { id: true, produtoId: true, descricao: true, quantidade: true, valorUnitario: true, conferirCampo: true } });
  if (!item) return { ok: false, status: 404, erro: "Material de campo não encontrado nesta OS." };
  if (!item.conferirCampo) return { ok: false, status: 409, erro: MSG_JA_CONFERIDO };
  const trava = travaDoCampo(await situacaoDaOsNoBanco(p.osId));
  if (trava) return { ok: false, status: 400, erro: trava };

  if (d.acao === "remover") {
    const r = await prisma.$transaction(async (tx) => {
      const x = await tx.osItemOrcamento.deleteMany({ where: { id: item.id, conferirCampo: true } });
      if (!x.count) return false;
      await tx.osHistorico.create({ data: { ordemServicoId: p.osId, usuarioId: p.usuarioId, acao: "Material de campo removido da cobrança", detalhes: `${item.descricao}: ${Number(item.quantidade)}`.slice(0, 1000) } });
      return true;
    });
    return r ? { ok: true, item: null } : { ok: false, status: 409, erro: MSG_JA_CONFERIDO };
  }

  const c = lerConferencia({ quantidade: Number(item.quantidade), valorUnitario: Number(item.valorUnitario) }, d);
  if (!c.ok) return { ok: false, status: 400, erro: c.erro };
  // O preço que o servidor pôs no item (o da tabela, quando há) não pede nada; mudar para fora da tabela, sim
  const precoTabela = await verificarItemDaOs({
    user: p.user, empresaId: p.empresaId, osId: p.osId, anterior: Number(item.valorUnitario),
    motivo: typeof d.motivoPrecoTabela === "string" ? d.motivoPrecoTabela : null,
    item: { tipo: "PRODUTO", produtoId: item.produtoId, descricao: item.descricao, quantidade: c.quantidade, valorUnitario: c.valorUnitario },
  });
  if (!precoTabela.veredito.ok) return { ok: false, status: precoTabela.veredito.status, erro: precoTabela.veredito.erro, precoTabela: true };
  const motivoTabela = precoTabela.alteracoes.length ? precoTabela.veredito.motivo : null;
  const r = await prisma.$transaction(async (tx) => {
    const x = await tx.osItemOrcamento.updateMany({
      where: { id: item.id, conferirCampo: true },
      data: { quantidade: c.quantidade, valorUnitario: c.valorUnitario, valorTotal: c.valorTotal, conferirCampo: false, conferidoCampoEm: new Date(), conferidoCampoPorId: p.usuarioId },
    });
    if (!x.count) return false;
    await tx.osHistorico.create({ data: {
      ordemServicoId: p.osId, usuarioId: p.usuarioId, acao: "Material de campo conferido",
      detalhes: `${item.descricao}: ${c.quantidade} × ${brl(c.valorUnitario)} = ${brl(c.valorTotal)}`.slice(0, 1000),
    } });
    if (motivoTabela) await tx.osHistorico.create({ data: { ordemServicoId: p.osId, usuarioId: p.usuarioId, acao: "Preço de tabela alterado", detalhes: textoDaTrilha(precoTabela.alteracoes, motivoTabela).slice(0, 500) } });
    return true;
  });
  if (!r) return { ok: false, status: 409, erro: MSG_JA_CONFERIDO };
  return { ok: true, item: await prisma.osItemOrcamento.findUnique({ where: { id: item.id } }) };
}
