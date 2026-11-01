/**
 * Medição do CONTRATO — o núcleo único que monta e grava a cobrança de uma competência. Usado pelo
 * "Gerar medições do mês" (uma medição por cliente, com os contratos dele) e pela rotina automática
 * (D3: uma medição por contrato). Mesmas travas nos dois caminhos:
 * - contratos TRANCADOS (FOR UPDATE, por id) e a cobrança da competência conferida de novo lá dentro:
 *   o botão e a rotina ao mesmo tempo não cobram o mesmo contrato duas vezes;
 * - OS e orçamentos consolidados trancados (`travarParaFaturar`);
 * - número da medição sob trava por empresa+ano (sem colisão entre os dois caminhos).
 */
import { Prisma, type Cliente, type Contrato } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { gerarNumeroMedicao } from "@/lib/utils";
import { calcularVencimento } from "@/lib/medicao-helpers";
import { itensFaturaveisDaOs, orcamentoJaFaturado, osJaFaturada, travarParaFaturar } from "@/lib/faturamento-os";
import { descricaoDaCobranca, descricaoItemContrato, passoCobranca, rotuloReferencia, valorMensalDe, vencimentoDaCompetencia } from "@/lib/financeiro/contrato-previsao";
import { retencoesHerdadas } from "@/lib/financeiro/retencoes-server";

type Db = Prisma.TransactionClient | typeof prisma;
export type ContratoComCliente = Contrato & { cliente: Cliente };

/** Medição viva (não cancelada) que já cobra o contrato nesta competência — direta ou pela previsão ligada */
export async function cobrancaDoContrato(db: Db, contratoId: string, ano: number, mes: number) {
  const direta = await db.medicao.findFirst({
    where: { contratoId, mes, ano, tipo: { in: ["MENSAL_FIXO", "FATURA_UNICA"] }, status: { not: "CANCELADA" } },
    select: { id: true, numero: true, status: true, contratoId: true },
    orderBy: { criadoEm: "asc" },
  });
  if (direta) return direta;
  const previsao = await db.contaReceber.findFirst({
    where: { contratoId, refAno: ano, refMes: mes, medicaoId: { not: null }, medicao: { status: { not: "CANCELADA" } } },
    select: { medicao: { select: { id: true, numero: true, status: true, contratoId: true } } },
  });
  return previsao?.medicao ?? null;
}

/**
 * D2: vencimento da medição. Ligada a UM contrato: a regra do contrato (dia de faturamento do
 * contrato; sem ele, o do cliente — a mesma da previsão). Sem contrato (ou várias): o dia do cliente.
 */
export async function vencimentoDaMedicao(db: Db, m: { contratoId: string | null; mes: number | null; ano: number | null; cliente: { diaFaturamento: number } }) {
  if (m.contratoId && m.mes && m.ano) {
    const c = await db.contrato.findUnique({ where: { id: m.contratoId } });
    if (c) return vencimentoDaCompetencia(c, m.ano, m.mes, m.cliente.diaFaturamento);
  }
  return calcularVencimento(m.cliente.diaFaturamento, m.mes, m.ano);
}

/** Próximo número MED-AAAA-NNNN, sob trava por empresa+ano (até o fim da transação) */
async function proximoNumeroMedicao(tx: Prisma.TransactionClient, empresaId: string, ano: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`numero-medicao:${empresaId}:${ano}`}))`;
  const ultima = await tx.medicao.findFirst({
    where: { empresaId, numero: { startsWith: `MED-${ano}-` } }, orderBy: { numero: "desc" }, select: { numero: true },
  });
  return gerarNumeroMedicao((ultima ? Number(ultima.numero.split("-")[2]) : 0) + 1, ano);
}

type Item = {
  tipo: "SERVICO" | "PRODUTO"; descricao: string; quantidade: number; valorUnitario: number; valorTotal: number;
  orcamentoId?: string; ordemServicoId?: string; servicoId?: string | null; ordem: number;
};

export type ResultadoMedicaoContrato =
  | { status: "criada"; medicao: { id: string; numero: string } }
  | { status: "sem-itens" }
  | { status: "ja-cobrado"; medicao: { id: string; numero: string; status: string; contratoId: string | null } }
  | { status: "item-faturado" };

/**
 * Monta e grava a medição da competência para os contratos (todos do MESMO cliente).
 * `porContrato` (rotina, D3): uma medição só deste contrato — sem a fatura única do cliente.
 * Liga a previsão (PREVISTO) de cada contrato à medição (C6); sem previsão, cria uma já ligada.
 */
export async function gerarMedicaoDeContratos(o: {
  empresaId: string; cliente: Cliente; contratos: Contrato[]; ano: number; mes: number; porContrato?: boolean;
}): Promise<ResultadoMedicaoContrato> {
  const { empresaId, cliente, ano, mes } = o;
  const faturaUnica = !o.porContrato && cliente.tipoFaturamento === "FATURA_UNICA";
  const itens: Item[] = [];
  let ordem = 0;

  for (const ct of o.contratos) {
    const valor = valorMensalDe(ct);
    if (valor <= 0) continue;
    itens.push({
      tipo: "SERVICO",
      descricao: descricaoItemContrato(ct, ano, mes),
      quantidade: 1, valorUnitario: valor, valorTotal: valor,
      // PR2: o serviço padrão do contrato vai no item (NFS-e sem pendência; retenções do serviço)
      servicoId: ct.servicoId ?? null,
      ordem: ordem++,
    });
  }

  // D3/D4: contrato CONSOLIDADO traz os serviços avulsos das OS do contrato concluídas no período
  // que ainda não entraram em nenhuma medição viva — a mesma trava única da OS (osJaFaturada).
  const inicioMes = new Date(ano, mes - 1, 1);
  const fimMes = new Date(ano, mes, 0, 23, 59, 59, 999);
  for (const ct of o.contratos) {
    if (ct.faturamentoAdicionais !== "CONSOLIDADO") continue;
    const ossDoMes = await prisma.ordemServico.findMany({
      where: { empresaId, contratoId: ct.id, status: "CONCLUIDA", dataConclusao: { gte: inicioMes, lte: fimMes } },
      select: { id: true, numero: true },
      orderBy: { dataConclusao: "asc" },
    });
    for (const os of ossDoMes) {
      if (await osJaFaturada(os.id)) continue;
      const { itens: execucao, adicionais } = await itensFaturaveisDaOs(os.id);
      for (const it of execucao) {
        itens.push({
          tipo: "SERVICO", descricao: `OS ${os.numero} — ${it.descricao}`, quantidade: Number(it.quantidade),
          valorUnitario: Number(it.valorUnitario), valorTotal: Number(it.valorTotal), ordemServicoId: os.id, ordem: ordem++,
        });
      }
      for (const a of adicionais) {
        itens.push({
          tipo: "SERVICO", descricao: `OS ${os.numero} — Serviço adicional: ${a.descricao}`, quantidade: 1,
          valorUnitario: Number(a.valor), valorTotal: Number(a.valor), ordemServicoId: os.id, ordem: ordem++,
        });
      }
    }
  }

  // Fatura única: agrega orçamentos aprovados do cliente ainda não faturados
  if (faturaUnica && cliente.agrupaAdicionais) {
    const orcamentos = await prisma.orcamento.findMany({
      where: {
        empresaId, clienteId: cliente.id, status: "APROVADO",
        // Medição CANCELADA não prende o orçamento: ele volta ao gerar-mes (F4)
        medicaoItens: { none: { medicao: { status: { not: "CANCELADA" } } } },
      },
    });
    for (const orc of orcamentos) {
      // a OS gerada deste orçamento já foi faturada (itens copiados): não cobra de novo
      if (await orcamentoJaFaturado(orc.id)) continue;
      const valor = Number(orc.totalGeral);
      itens.push({ tipo: "SERVICO", descricao: `Adicional — orçamento ${orc.codigo}`, quantidade: 1, valorUnitario: valor, valorTotal: valor, orcamentoId: orc.id, ordem: ordem++ });
    }
  }

  if (itens.length === 0) return { status: "sem-itens" };

  const valorTotal = itens.reduce((acc, it) => acc + it.valorTotal, 0);
  const unico = !faturaUnica && o.contratos.length === 1 ? o.contratos[0] : null;
  const vencimento = unico ? vencimentoDaCompetencia(unico, ano, mes, cliente.diaFaturamento) : calcularVencimento(cliente.diaFaturamento, mes, ano);
  // Retenções herdadas dos serviços dos itens — a mesma regra do "Faturar" (sem serviço = sem retenção)
  const ret = await retencoesHerdadas(empresaId, { valorTotal, valorLiquido: valorTotal, linhas: itens });
  const passoUnico = unico ? passoCobranca(unico.periodicidade) : 1;
  const descricao = faturaUnica
    ? `Fatura única ${String(mes).padStart(2, "0")}/${ano}`
    : passoUnico > 1 ? `Cobrança ${rotuloReferencia(ano, mes, passoUnico)}` : `Medição mensal ${String(mes).padStart(2, "0")}/${ano}`;

  return prisma.$transaction(async (tx): Promise<ResultadoMedicaoContrato> => {
    // Contratos trancados (ordem fixa) e a competência conferida de novo: quem chegou depois vê a medição do primeiro
    const ids = o.contratos.map((c) => c.id).sort();
    await tx.$queryRaw`SELECT id FROM contratos WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
    for (const ct of o.contratos) {
      const ja = await cobrancaDoContrato(tx, ct.id, ano, mes);
      if (ja) return { status: "ja-cobrado", medicao: ja };
    }
    // Trava (a/c): OS e orçamentos desta fatura TRANCADOS; se outro caminho faturou algum deles
    // enquanto a lista era montada, fica para a próxima rodada (nada sai em dobro)
    const travadas = await travarParaFaturar(tx, { osIds: itens.map((i) => i.ordemServicoId), orcamentoIds: itens.map((i) => i.orcamentoId) });
    if (travadas.os.length || travadas.orcamentos.length) return { status: "item-faturado" };

    const numero = await proximoNumeroMedicao(tx, empresaId, ano);
    const medicao = await tx.medicao.create({
      data: {
        empresaId, clienteId: cliente.id, contratoId: unico?.id ?? null, numero,
        tipo: faturaUnica ? "FATURA_UNICA" : "MENSAL_FIXO", mes, ano, descricao, status: "RASCUNHO",
        valorTotal, valorLiquido: valorTotal, ...ret.campos, valorRetencoes: ret.total, dataVencimento: vencimento,
        tokenPublico: crypto.randomUUID(),
        itens: {
          create: itens.map((it) => ({
            tipo: it.tipo, descricao: it.descricao, quantidade: it.quantidade, valorUnitario: it.valorUnitario, valorTotal: it.valorTotal,
            orcamentoId: it.orcamentoId ?? null, ordemServicoId: it.ordemServicoId ?? null, servicoId: it.servicoId ?? null, ordem: it.ordem,
          })),
        },
      },
      select: { id: true, numero: true },
    });

    // C6/D3: a medição É a cobrança da previsão — liga a conta PREVISTO de cada contrato (sem criar
    // conta nova). Competência sem previsão (contrato antigo): cria uma já ligada. Segue PREVISTO até a aprovação/NF.
    for (const ct of o.contratos) {
      const valorCt = valorMensalDe(ct);
      if (valorCt <= 0) continue;
      const previsao = await tx.contaReceber.findFirst({ where: { contratoId: ct.id, refAno: ano, refMes: mes, status: "PREVISTO", medicaoId: null } });
      if (previsao) {
        await tx.contaReceber.update({ where: { id: previsao.id }, data: { medicaoId: medicao.id } });
      } else if (!(await tx.contaReceber.findFirst({ where: { contratoId: ct.id, refAno: ano, refMes: mes }, select: { id: true } }))) {
        await tx.contaReceber.create({
          data: {
            empresaId, clienteId: cliente.id, contratoId: ct.id, refAno: ano, refMes: mes, medicaoId: medicao.id,
            numero: `${ct.numero}/${ano}${String(mes).padStart(2, "0")}`,
            descricao: descricaoDaCobranca({ ...ct, descricaoNFSe: null }, ano, mes),
            valor: valorCt, status: "PREVISTO", dataVencimento: vencimento, categoria: "Contrato", clienteCnpj: cliente.cpfCnpj ?? null,
          },
        });
      }
    }
    return { status: "criada", medicao };
  }, { timeout: 20_000 });
}
