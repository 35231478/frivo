import type { FormaPagamento } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatarData, formatarMoeda } from "@/lib/utils";
import { diaCivilDeChave } from "@/lib/fuso";
import { recalcularContaPagar } from "@/lib/financeiro-server";
import { ehRenegociacao } from "@/lib/financeiro/renegociacao-server";
import { ErroConta, registrarRecebimento, travarConta } from "@/lib/financeiro/parcelas-server";
import { registrarEventoCR } from "@/lib/financeiro/conta-receber-server";
import { saldoDaConta } from "@/lib/financeiro/parcelas";
import {
  chaveDoVencimento, motivoLotePagar, motivoLoteReceber, novoVencimento, resumoLote, type AcaoLote, type ItemLote, type ParamsVencimento,
} from "@/lib/financeiro/acoes-lote";

/**
 * Ações em lote nas contas — o servidor. Um pedido = UMA transação: as elegíveis são feitas todas
 * juntas; as outras entram em `ignoradas` com o motivo (não é erro). Se algo inesperado falhar no
 * meio, a transação volta inteira e nada fica feito pela metade (a rota avisa). As regras por conta
 * são as da ação individual (lib/financeiro/acoes-lote → conta-receber-gestao), reavaliadas aqui com
 * a conta trancada, por cima do que a tela já mostrou.
 */

export interface PedidoLote {
  empresaId: string;
  usuarioId: string;
  acao: AcaoLote;
  ids: string[];
  /** "baixar": data (dia civil), forma, conta bancária (receber) / banco em texto (pagar) */
  data?: string | null;
  formaPagamento?: FormaPagamento | null;
  contaBancariaId?: string | null;
  banco?: string | null;
  /** "vencimento" */
  vencimento?: ParamsVencimento | null;
  /** "cancelar" (vai para o histórico) */
  motivo?: string | null;
}

export interface ItemFeito { id: string; numero: string; detalhe: string }
export interface ResultadoLote {
  feitas: ItemFeito[];
  ignoradas: { id: string; numero: string; motivo: string }[];
  /** "baixar": o que foi baixado (soma dos saldos) */
  total: number;
  /** Contas quitadas na baixa (para a confirmação por e-mail, depois do commit) */
  quitadas: string[];
}

const SUFIXO = " (ação em lote)";
const NAO_ENCONTRADA = "Não encontrada (ou de outra empresa).";
const PRAZO_TX_MS = 55_000;

/** Devolve as linhas pedidas na ordem dos ids, com "não encontrada" para o que não é da empresa */
function naOrdem<T extends { id: string }>(ids: string[], linhas: T[]) {
  const mapa = new Map(linhas.map((l) => [l.id, l]));
  return ids.map((id) => ({ id, linha: mapa.get(id) ?? null }));
}

/* ───────── Contas a Receber ───────── */
export async function executarLoteReceber(p: PedidoLote): Promise<ResultadoLote> {
  const ids = [...new Set(p.ids)];
  return prisma.$transaction(async (tx) => {
    // Tranca as contas do lote (na ordem dos ids: dois lotes com as mesmas contas não se cruzam)
    for (const id of ids) await travarConta(tx, id);
    const linhas = await tx.contaReceber.findMany({
      where: { id: { in: ids }, empresaId: p.empresaId, excluidaEm: null },
      include: { notasFiscais: { select: { status: true } } },
    });
    const itens: ItemLote[] = [];
    const contas = new Map<string, (typeof linhas)[number] & { notas: { status: string }[]; renegociacao: boolean }>();
    for (const { id, linha } of naOrdem(ids, linhas)) {
      if (!linha) { itens.push({ id, numero: id, motivo: NAO_ENCONTRADA, saldo: 0 }); continue; }
      const regra = { ...linha, notas: linha.notasFiscais, renegociacao: await ehRenegociacao(tx, linha) };
      contas.set(id, regra);
      itens.push({ id, numero: linha.numero, motivo: motivoLoteReceber(p.acao, regra, p.vencimento ?? undefined), saldo: saldoDaConta(linha) });
    }
    const resumo = resumoLote(itens);
    const feitas: ItemFeito[] = [];
    const quitadas: string[] = [];
    let total = 0;

    for (const item of resumo.elegiveis) {
      const c = contas.get(item.id)!;
      if (p.acao === "baixar") {
        try {
          const r = await registrarRecebimento(tx, {
            empresaId: p.empresaId, contaId: c.id, data: diaCivilDeChave(p.data!)!, formaPagamento: p.formaPagamento ?? null,
            contaBancariaId: p.contaBancariaId ?? null, origem: "MANUAL", observacao: `Baixa em lote`, usuarioId: p.usuarioId,
          });
          if (r.quitou) quitadas.push(c.id);
          total = Math.round((total + r.valor) * 100) / 100;
          feitas.push({ id: c.id, numero: c.numero, detalhe: `${formatarMoeda(r.valor)} em ${formatarData(diaCivilDeChave(p.data!)!)}` });
        } catch (e) {
          // A regra já foi conferida acima; se mesmo assim a baixa recusou, a conta sai como ignorada (sem derrubar o lote)
          if (e instanceof ErroConta) { resumo.ignoradas.push({ ...item, motivo: e.message }); continue; }
          throw e;
        }
      } else if (p.acao === "vencimento") {
        const antes = chaveDoVencimento(c.dataVencimento);
        const depois = novoVencimento(c.dataVencimento, p.vencimento!)!;
        await tx.contaReceber.update({ where: { id: c.id }, data: { dataVencimento: diaCivilDeChave(depois)! } });
        const texto = `Vencimento: ${antes ? formatarData(diaCivilDeChave(antes)!) : "—"} → ${formatarData(diaCivilDeChave(depois)!)}`;
        await registrarEventoCR({ empresaId: p.empresaId, contaReceberId: c.id, tipo: "EDITADA", detalhe: texto + SUFIXO, usuarioId: p.usuarioId }, tx);
        feitas.push({ id: c.id, numero: c.numero, detalhe: texto });
      } else {
        // Mesmo guarda da rota individual: só UM pedido cancela (status aberto e nada recebido)
        const virou = await tx.contaReceber.updateMany({
          where: { id: c.id, empresaId: p.empresaId, excluidaEm: null, status: { notIn: ["RECEBIDO", "CANCELADO", "PARCELADO", "PERDA", "RENEGOCIADO"] }, valorRecebido: 0 },
          data: { status: "CANCELADO", canceladaEm: new Date(), motivoCancelamento: p.motivo!.trim() },
        });
        if (!virou.count) { resumo.ignoradas.push({ ...item, motivo: "Esta conta já está cancelada (ou mudou)." }); continue; }
        await registrarEventoCR({ empresaId: p.empresaId, contaReceberId: c.id, tipo: "CANCELADA", detalhe: p.motivo!.trim() + SUFIXO, usuarioId: p.usuarioId }, tx);
        feitas.push({ id: c.id, numero: c.numero, detalhe: "Cancelada" });
      }
    }
    return { feitas, quitadas, total, ignoradas: resumo.ignoradas.map((i) => ({ id: i.id, numero: i.numero, motivo: i.motivo! })) };
  }, { timeout: PRAZO_TX_MS });
}

/* ───────── Contas a Pagar ───────── */
export async function executarLotePagar(p: PedidoLote): Promise<ResultadoLote> {
  const ids = [...new Set(p.ids)];
  return prisma.$transaction(async (tx) => {
    for (const id of ids) await tx.$queryRaw`SELECT id FROM contas_pagar WHERE id = ${id} FOR UPDATE`;
    const linhas = await tx.contaPagar.findMany({ where: { id: { in: ids }, empresaId: p.empresaId } });
    const itens: ItemLote[] = [];
    const contas = new Map(linhas.map((l) => [l.id, l]));
    for (const { id, linha } of naOrdem(ids, linhas)) {
      if (!linha) { itens.push({ id, numero: id, motivo: NAO_ENCONTRADA, saldo: 0 }); continue; }
      itens.push({ id, numero: linha.numero, motivo: motivoLotePagar(p.acao, linha, p.vencimento ?? undefined), saldo: Number(linha.saldoRestante) });
    }
    const resumo = resumoLote(itens);
    const feitas: ItemFeito[] = [];

    for (const item of resumo.elegiveis) {
      const c = contas.get(item.id)!;
      if (p.acao === "baixar") {
        const data = diaCivilDeChave(p.data!)!;
        await tx.pagamentoContaPagar.create({
          data: { contaPagarId: c.id, valor: item.saldo, dataPagamento: data, formaPagamento: p.formaPagamento ?? null, banco: p.banco?.trim() || null, observacao: "Baixa em lote" },
        });
        await recalcularContaPagar(c.id, tx);
        feitas.push({ id: c.id, numero: c.numero, detalhe: `${formatarMoeda(item.saldo)} em ${formatarData(data)}` });
      } else if (p.acao === "vencimento") {
        const antes = chaveDoVencimento(c.dataVencimento);
        const depois = novoVencimento(c.dataVencimento, p.vencimento!)!;
        await tx.contaPagar.update({ where: { id: c.id }, data: { dataVencimento: diaCivilDeChave(depois)! } });
        await recalcularContaPagar(c.id, tx); // VENCIDO ↔ PENDENTE acompanha a data nova
        feitas.push({ id: c.id, numero: c.numero, detalhe: `Vencimento: ${antes ? formatarData(diaCivilDeChave(antes)!) : "—"} → ${formatarData(diaCivilDeChave(depois)!)}` });
      } else {
        await tx.contaPagar.update({ where: { id: c.id }, data: { status: "CANCELADO" } });
        feitas.push({ id: c.id, numero: c.numero, detalhe: "Cancelada" });
      }
    }
    return {
      feitas, quitadas: [],
      ignoradas: resumo.ignoradas.map((i) => ({ id: i.id, numero: i.numero, motivo: i.motivo! })),
      total: p.acao === "baixar" ? resumo.total : 0,
    };
  }, { timeout: PRAZO_TX_MS });
}
