import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { gerarNumeroMedicao } from "@/lib/utils";
import { calcularVencimento } from "@/lib/medicao-helpers";
import { itensFaturaveisDaOs, orcamentoJaFaturado, osJaFaturada, travarParaFaturar } from "@/lib/faturamento-os";
import { anoBR, mesBR } from "@/lib/fuso";
import { contratoCobraNaCompetencia } from "@/lib/financeiro/contrato-previsao";
import { retencoesHerdadas } from "@/lib/financeiro/retencoes-server";

/**
 * Gera as medições mensais de todos os clientes com contrato ativo.
 * Body opcional: { mes, ano }. Default: mês/ano corrente.
 *
 * - Clientes perfil "Fatura única": agrupa todos os contratos + orçamentos
 *   aprovados do mês ainda não faturados em uma única medição (FATURA_UNICA).
 * - Demais clientes: uma medição MENSAL_FIXO por cliente com os contratos ativos.
 * - CO4: só entra o contrato cuja VIGÊNCIA cobre a competência (regra do aniversário) — o que
 *   começa depois ou já terminou não gera mensalidade, mesmo com status ATIVO.
 */
export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "medicoes");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;

  const body = await req.json().catch(() => ({}));
  const agora = new Date();
  const mes = Number(body?.mes) || mesBR(agora);
  const ano = Number(body?.ano) || anoBR(agora);

  const ativos = await prisma.contrato.findMany({
    where: { empresaId, status: "ATIVO" },
    include: { cliente: true },
  });
  const contratos = ativos.filter((c) => contratoCobraNaCompetencia(c.dataInicio, c.dataFim, ano, mes));
  const foraDaVigencia = ativos.filter((c) => !contratos.includes(c)).map((c) => c.numero);

  // Agrupa contratos por cliente
  const porCliente = new Map<string, typeof contratos>();
  for (const c of contratos) {
    const arr = porCliente.get(c.clienteId) ?? [];
    arr.push(c);
    porCliente.set(c.clienteId, arr);
  }

  // Sequencial derivado do maior número de medição do ano alvo (evita colisão entre anos)
  const ultimaMed = await prisma.medicao.findFirst({
    where: { empresaId, numero: { startsWith: `MED-${ano}-` } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  let sequencial = ultimaMed ? Number(ultimaMed.numero.split("-")[2]) : 0;
  let criadas = 0;
  let ignoradas = 0;
  const resultado: { cliente: string; numero?: string; status: string }[] = [];

  for (const [clienteId, contratosCliente] of porCliente) {
    const cliente = contratosCliente[0].cliente;

    // Evita duplicar: já existe medição mensal/fatura única deste cliente no período?
    const jaExiste = await prisma.medicao.findFirst({
      where: {
        empresaId,
        clienteId,
        mes,
        ano,
        tipo: { in: ["MENSAL_FIXO", "FATURA_UNICA"] },
        status: { not: "CANCELADA" },
      },
    });
    if (jaExiste) {
      ignoradas++;
      resultado.push({ cliente: cliente.nomeFantasia ?? cliente.nome, status: "já existe" });
      continue;
    }

    const faturaUnica = cliente.tipoFaturamento === "FATURA_UNICA";

    const itens: {
      tipo: "SERVICO" | "PRODUTO";
      descricao: string;
      quantidade: number;
      valorUnitario: number;
      valorTotal: number;
      orcamentoId?: string;
      ordemServicoId?: string;
      servicoId?: string | null;
      ordem: number;
    }[] = [];

    let ordem = 0;
    for (const ct of contratosCliente) {
      const valor = ct.valorMensal ? Number(ct.valorMensal) : 0;
      if (valor <= 0) continue;
      itens.push({
        tipo: "SERVICO",
        descricao: `Contrato ${ct.numero} — mensalidade`,
        quantidade: 1,
        valorUnitario: valor,
        valorTotal: valor,
        // PR2: o serviço padrão do contrato vai no item (NFS-e sem pendência; retenções do serviço)
        servicoId: ct.servicoId ?? null,
        ordem: ordem++,
      });
    }

    // D3/D4: contrato CONSOLIDADO traz para a fatura do mês os serviços avulsos das OS do
    // contrato concluídas no período (itens executados + adicionais "Cobrar" com preço) que
    // ainda não entraram em nenhuma medição viva — a mesma trava única da OS (osJaFaturada).
    const inicioMes = new Date(ano, mes - 1, 1);
    const fimMes = new Date(ano, mes, 0, 23, 59, 59, 999);
    for (const ct of contratosCliente) {
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
            tipo: "SERVICO",
            descricao: `OS ${os.numero} — ${it.descricao}`,
            quantidade: Number(it.quantidade),
            valorUnitario: Number(it.valorUnitario),
            valorTotal: Number(it.valorTotal),
            ordemServicoId: os.id,
            ordem: ordem++,
          });
        }
        for (const a of adicionais) {
          itens.push({
            tipo: "SERVICO",
            descricao: `OS ${os.numero} — Serviço adicional: ${a.descricao}`,
            quantidade: 1,
            valorUnitario: Number(a.valor),
            valorTotal: Number(a.valor),
            ordemServicoId: os.id,
            ordem: ordem++,
          });
        }
      }
    }

    // Fatura única: agrega orçamentos aprovados do cliente ainda não faturados
    if (faturaUnica && cliente.agrupaAdicionais) {
      const orcamentos = await prisma.orcamento.findMany({
        where: {
          empresaId,
          clienteId,
          status: "APROVADO",
          // Medição CANCELADA não prende o orçamento: ele volta ao gerar-mes (F4)
          medicaoItens: { none: { medicao: { status: { not: "CANCELADA" } } } },
        },
      });
      for (const o of orcamentos) {
        // (c) a OS gerada deste orçamento já foi faturada (itens copiados): não cobra de novo
        if (await orcamentoJaFaturado(o.id)) continue;
        const valor = Number(o.totalGeral);
        itens.push({
          tipo: "SERVICO",
          descricao: `Adicional — orçamento ${o.codigo}`,
          quantidade: 1,
          valorUnitario: valor,
          valorTotal: valor,
          orcamentoId: o.id,
          ordem: ordem++,
        });
      }
    }

    if (itens.length === 0) {
      ignoradas++;
      resultado.push({ cliente: cliente.nomeFantasia ?? cliente.nome, status: "sem valor de contrato" });
      continue;
    }

    const valorTotal = itens.reduce((acc, it) => acc + it.valorTotal, 0);
    sequencial++;
    const numero = gerarNumeroMedicao(sequencial, ano);
    const vencimento = calcularVencimento(cliente.diaFaturamento, mes, ano);
    // Retenções herdadas dos serviços dos itens — a mesma regra do "Faturar" (sem serviço = sem retenção)
    const ret = await retencoesHerdadas(empresaId, { valorTotal, valorLiquido: valorTotal, linhas: itens });

    // Trava (a/c): OS e orçamentos desta fatura TRANCADOS; se outro caminho faturou algum deles
    // enquanto a lista era montada, este cliente fica para a próxima rodada (nada sai em dobro)
    const medicao = await prisma.$transaction(async (tx) => {
      const travadas = await travarParaFaturar(tx, { osIds: itens.map((i) => i.ordemServicoId), orcamentoIds: itens.map((i) => i.orcamentoId) });
      if (travadas.os.length || travadas.orcamentos.length) return null;
      const criada = await tx.medicao.create({
        data: {
          empresaId,
          clienteId,
          contratoId: !faturaUnica && contratosCliente.length === 1 ? contratosCliente[0].id : null,
          numero,
          tipo: faturaUnica ? "FATURA_UNICA" : "MENSAL_FIXO",
          mes,
          ano,
          descricao: faturaUnica
            ? `Fatura única ${String(mes).padStart(2, "0")}/${ano}`
            : `Medição mensal ${String(mes).padStart(2, "0")}/${ano}`,
          status: "RASCUNHO",
          valorTotal,
          valorLiquido: valorTotal,
          ...ret.campos,
          valorRetencoes: ret.total,
          dataVencimento: vencimento,
          tokenPublico: crypto.randomUUID(),
          itens: {
            create: itens.map((it) => ({
              tipo: it.tipo,
              descricao: it.descricao,
              quantidade: it.quantidade,
              valorUnitario: it.valorUnitario,
              valorTotal: it.valorTotal,
              orcamentoId: it.orcamentoId ?? null,
              ordemServicoId: it.ordemServicoId ?? null,
              servicoId: it.servicoId ?? null,
              ordem: it.ordem,
            })),
          },
        },
      });
      return criada;
    }, { timeout: 20_000 });
    if (!medicao) {
      sequencial--;
      ignoradas++;
      resultado.push({ cliente: cliente.nomeFantasia ?? cliente.nome, status: "item já faturado em outra medição — gere de novo" });
      continue;
    }

    // C6/D3: a medição do mês É a cobrança da previsão — liga a conta PREVISTO de cada
    // contrato à medição (sem criar conta nova). Se a competência ainda não tem previsão
    // (contrato antigo), cria uma já ligada. A conta segue PREVISTO até a aprovação/NF.
    for (const ct of contratosCliente) {
      const valorCt = ct.valorMensal ? Number(ct.valorMensal) : 0;
      if (valorCt <= 0) continue;
      const previsao = await prisma.contaReceber.findFirst({
        where: { contratoId: ct.id, refAno: ano, refMes: mes, status: "PREVISTO", medicaoId: null },
      });
      if (previsao) {
        await prisma.contaReceber.update({ where: { id: previsao.id }, data: { medicaoId: medicao.id } });
      } else {
        const jaLigada = await prisma.contaReceber.findFirst({ where: { contratoId: ct.id, refAno: ano, refMes: mes } });
        if (!jaLigada) {
          await prisma.contaReceber.create({
            data: {
              empresaId,
              clienteId,
              contratoId: ct.id,
              refAno: ano,
              refMes: mes,
              medicaoId: medicao.id,
              numero: `${ct.numero}/${ano}${String(mes).padStart(2, "0")}`,
              descricao: `Contrato ${ct.numero} — Ref. ${String(mes).padStart(2, "0")}/${ano}`,
              valor: valorCt,
              status: "PREVISTO",
              dataVencimento: vencimento,
              categoria: "Contrato",
              clienteCnpj: cliente.cpfCnpj ?? null,
            },
          });
        }
      }
    }

    criadas++;
    resultado.push({ cliente: cliente.nomeFantasia ?? cliente.nome, numero, status: "criada" });
  }

  return NextResponse.json({ ok: true, mes, ano, criadas, ignoradas, foraDaVigencia, resultado });
}
