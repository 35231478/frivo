/**
 * "Faturar" (faturamento avulso) — servidor. A empresa vem sempre de quem chama (sessão).
 * Reusa a engine da medição: cria a Medicao ADICIONAL marcada `avulsa`, já LIBERADA para a nota
 * (sem a aprovação do cliente, D3), com os itens ligados à origem, e gera a conta a receber pelo
 * líquido (gerarContaReceberDaMedicao — a previsão do orçamento vira a cobrança, sem duplicar).
 * Travas C6/C7: origem trancada na transação (travarParaFaturar); já faturado → devolve a existente.
 * Retenções: herdadas do cadastro dos serviços da nota (ajustáveis depois no "Editar").
 */

import { prisma } from "@/lib/prisma";
import { gerarContaReceberDaMedicao } from "@/lib/financeiro-server";
import { itensFaturaveisDaOs, orcamentoJaFaturado, osJaFaturada, travarParaFaturar } from "@/lib/faturamento-os";
import { registrarEvento } from "@/lib/orcamentos/ciclo-server";
import { partesBR } from "@/lib/fuso";
import { gerarNumeroMedicao } from "@/lib/utils";
import { baseRetencoes, calcularRetencoes, camposDaMedicao, motivoRetencaoInvalida, retencoesDosServicos, SELECT_RETENCOES_SERVICO } from "@/lib/financeiro/retencoes";
import {
  faturaDaOs, faturaDoOrcamento, motivoNaoFaturarOrcamento, motivoNaoFaturarOs, numeroFatura, vencimentoAvulso, type Fatura,
} from "@/lib/faturamento/fatura";

export interface FaturaResumo { id: string; numero: string }
export type ResultadoFaturar =
  | { tipo: "nao-encontrado" }
  | { tipo: "bloqueado"; erro: string }
  | { tipo: "vazio"; erro: string }
  | { tipo: "existente"; fatura: FaturaResumo }
  | { tipo: "criada"; fatura: FaturaResumo };

interface Origem {
  empresaId: string;
  usuarioId: string;
  clienteId: string;
  diaFaturamento: number | null;
  descricao: string;
  fatura: Fatura;
  trava: { osIds?: string[]; orcamentoIds?: string[] };
  /** Registro na origem (histórico da OS / linha do tempo do orçamento), dentro da transação */
  registrar: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], numero: string) => Promise<unknown>;
}

/** Retenções que a fatura herda dos serviços da nota (cadastro: "ISS retido" / "Reter …" + alíquota) */
async function retencoesHerdadas(empresaId: string, fatura: Fatura) {
  const ids = [...new Set(fatura.linhas.map((l) => l.servicoId).filter((x): x is string => !!x))];
  const [servicos, config] = await Promise.all([
    ids.length ? prisma.servico.findMany({ where: { id: { in: ids }, empresaId }, select: SELECT_RETENCOES_SERVICO }) : [],
    prisma.configuracao.findUnique({ where: { empresaId }, select: { issAliquota: true } }),
  ]);
  const porId = new Map(servicos.map((s) => [s.id, s]));
  const { retencoes } = retencoesDosServicos(
    fatura.linhas.map((l) => ({ tipo: l.tipo, valorTotal: l.valorTotal, servico: l.servicoId ? porId.get(l.servicoId) ?? null : null })),
    config?.issAliquota != null ? Number(config.issAliquota) : null,
  );
  // Base = o valor da nota (só os serviços). Retenção que passaria dele não entra (ajuste no "Editar")
  const base = baseRetencoes({ valorTotal: fatura.valorTotal, valorLiquido: fatura.valorLiquido, itens: fatura.linhas });
  if (motivoRetencaoInvalida(base, retencoes)) return { campos: camposDaMedicao({}), total: 0 };
  return { campos: camposDaMedicao(retencoes), total: calcularRetencoes(base, retencoes).total };
}

async function criarFatura(o: Origem): Promise<ResultadoFaturar> {
  const agora = partesBR();
  const ret = await retencoesHerdadas(o.empresaId, o.fatura);
  const r = await prisma.$transaction(async (tx) => {
    const travadas = await travarParaFaturar(tx, o.trava);
    const ja = [...travadas.os, ...travadas.orcamentos][0];
    if (ja) return { tipo: "existente" as const, fatura: { id: ja.medicao.id, numero: ja.medicao.numero } };

    const ultima = await tx.medicao.findFirst({
      where: { empresaId: o.empresaId, numero: { startsWith: `MED-${agora.ano}-` } },
      orderBy: { numero: "desc" }, select: { numero: true },
    });
    const numero = gerarNumeroMedicao((ultima ? Number(ultima.numero.split("-")[2]) : 0) + 1, agora.ano);
    const criada = await tx.medicao.create({
      data: {
        empresaId: o.empresaId, clienteId: o.clienteId, numero, tipo: "ADICIONAL", avulsa: true,
        mes: agora.mes + 1, ano: agora.ano, descricao: o.descricao,
        // D3: o avulso vai direto para a nota (a aprovação do cliente é só da medição de contrato)
        status: "PC_RECEBIDO", dataAprovacao: new Date(),
        dataVencimento: vencimentoAvulso(o.diaFaturamento, { ano: agora.ano, mes0: agora.mes, dia: agora.dia }),
        valorTotal: o.fatura.valorTotal, descontoValor: o.fatura.descontoValor, valorLiquido: o.fatura.valorLiquido,
        // Retenções herdadas dos serviços: a conta a receber/boleto sai pelo líquido
        ...ret.campos, valorRetencoes: ret.total,
        tokenPublico: crypto.randomUUID(),
        itens: {
          create: o.fatura.linhas.map((l, ordem) => ({
            tipo: l.tipo, descricao: l.descricao, quantidade: l.quantidade, valorUnitario: l.valorUnitario, valorTotal: l.valorTotal,
            servicoId: l.servicoId ?? null, produtoId: l.produtoId ?? null, orcamentoId: l.orcamentoId ?? null,
            ordemServicoId: l.ordemServicoId ?? null, ordem,
          })),
        },
      },
      select: { id: true, numero: true },
    });
    await o.registrar(tx, criada.numero);
    return { tipo: "criada" as const, fatura: criada };
  }, { timeout: 20_000 });

  // A cobrança: conta a receber pelo líquido (a previsão do orçamento, se houver, vira esta conta)
  if (r.tipo === "criada") await gerarContaReceberDaMedicao(r.fatura.id);
  return r;
}

/** Faturar o orçamento aprovado (com ou sem OS): os itens como o cliente aprovou */
export async function faturarOrcamento(p: { empresaId: string; usuarioId: string; orcamentoId: string }): Promise<ResultadoFaturar> {
  const orc = await prisma.orcamento.findFirst({
    where: { id: p.orcamentoId, empresaId: p.empresaId },
    select: {
      id: true, codigo: true, nome: true, status: true, tipo: true, clienteId: true,
      descontoServicos: true, tipoDescontoServicos: true, descontoProdutos: true, tipoDescontoProdutos: true, issAliquota: true,
      cliente: { select: { diaFaturamento: true } },
      servicos: { select: { descricao: true, quantidade: true, valorUnitario: true, valorTotal: true, ordem: true, servicoId: true } },
      produtos: { select: { descricao: true, quantidade: true, valorUnitario: true, valorTotal: true, ordem: true, produtoId: true } },
    },
  });
  if (!orc) return { tipo: "nao-encontrado" };
  // Já faturado (direto ou pela OS gerada dele): leva à fatura, antes de qualquer outra regra
  const ja = await orcamentoJaFaturado(orc.id);
  if (ja) return { tipo: "existente", fatura: { id: ja.id, numero: ja.numero } };
  const motivo = motivoNaoFaturarOrcamento(orc);
  if (motivo) return { tipo: "bloqueado", erro: motivo };
  const fatura = faturaDoOrcamento(orc);
  if (!fatura.linhas.length || fatura.valorLiquido <= 0) return { tipo: "vazio", erro: "Nada a faturar: o orçamento não tem itens com valor." };
  return criarFatura({
    empresaId: p.empresaId, usuarioId: p.usuarioId, clienteId: orc.clienteId, diaFaturamento: orc.cliente.diaFaturamento,
    descricao: `Orçamento ${orc.codigo} — ${orc.nome}`.slice(0, 300), fatura, trava: { orcamentoIds: [orc.id] },
    registrar: (tx, numero) => registrarEvento({ empresaId: p.empresaId, orcamentoId: orc.id, tipo: "FATURADO", detalhe: `Fatura ${numeroFatura(numero)}`, usuarioId: p.usuarioId }, tx),
  });
}

/** Faturar a OS concluída (sem contrato): itens executados + adicionais "Cobrar" com preço */
export async function faturarOs(p: { empresaId: string; usuarioId: string; osId: string }): Promise<ResultadoFaturar> {
  const os = await prisma.ordemServico.findFirst({
    where: { id: p.osId, empresaId: p.empresaId },
    select: { id: true, numero: true, status: true, contratoId: true, clienteId: true, descricao: true, cliente: { select: { diaFaturamento: true } } },
  });
  if (!os) return { tipo: "nao-encontrado" };
  // Já faturada (a OS passa a "Faturada" depois): leva à fatura, antes de qualquer outra regra
  const ja = await osJaFaturada(os.id);
  if (ja) return { tipo: "existente", fatura: { id: ja.id, numero: ja.numero } };
  const motivo = motivoNaoFaturarOs(os);
  if (motivo) return { tipo: "bloqueado", erro: motivo };
  const { itens, adicionais } = await itensFaturaveisDaOs(os.id);
  const fatura = faturaDaOs(os.id, itens.map((i) => ({ ...i, servicoId: i.orcamentoServico?.servicoId ?? null })), adicionais.map((a) => ({ descricao: a.descricao, valor: a.valor })));
  if (!fatura.linhas.length || fatura.valorLiquido <= 0) {
    return { tipo: "vazio", erro: "Nada a faturar: marque os itens executados (ou os adicionais \"Cobrar\" com preço)." };
  }
  const titulo = (os.descricao ?? "").split("\n")[0].trim();
  return criarFatura({
    empresaId: p.empresaId, usuarioId: p.usuarioId, clienteId: os.clienteId, diaFaturamento: os.cliente.diaFaturamento,
    descricao: `OS ${os.numero}${titulo ? ` — ${titulo}` : ""}`.slice(0, 300), fatura, trava: { osIds: [os.id] },
    registrar: (tx, numero) => tx.osHistorico.create({
      data: { ordemServicoId: os.id, usuarioId: p.usuarioId, acao: "OS faturada", detalhes: `Fatura ${numeroFatura(numero)}` },
    }),
  });
}
