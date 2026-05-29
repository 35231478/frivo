import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gerarNumeroMedicao } from "@/lib/utils";
import { calcularVencimento } from "@/lib/medicao-helpers";

/**
 * Gera as medições mensais de todos os clientes com contrato ativo.
 * Body opcional: { mes, ano }. Default: mês/ano corrente.
 *
 * - Clientes perfil "Fatura única": agrupa todos os contratos + orçamentos
 *   aprovados do mês ainda não faturados em uma única medição (FATURA_UNICA).
 * - Demais clientes: uma medição MENSAL_FIXO por cliente com os contratos ativos.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const body = await req.json().catch(() => ({}));
  const agora = new Date();
  const mes = Number(body?.mes) || agora.getMonth() + 1;
  const ano = Number(body?.ano) || agora.getFullYear();

  const contratos = await prisma.contrato.findMany({
    where: { empresaId, status: "ATIVO" },
    include: { cliente: true },
  });

  // Agrupa contratos por cliente
  const porCliente = new Map<string, typeof contratos>();
  for (const c of contratos) {
    const arr = porCliente.get(c.clienteId) ?? [];
    arr.push(c);
    porCliente.set(c.clienteId, arr);
  }

  let sequencial = await prisma.medicao.count({ where: { empresaId } });
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
        ordem: ordem++,
      });
    }

    // Fatura única: agrega orçamentos aprovados do cliente ainda não faturados
    if (faturaUnica && cliente.agrupaAdicionais) {
      const orcamentos = await prisma.orcamento.findMany({
        where: {
          empresaId,
          clienteId,
          status: "APROVADO",
          medicaoItens: { none: {} },
        },
      });
      for (const o of orcamentos) {
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

    await prisma.medicao.create({
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
            ordem: it.ordem,
          })),
        },
      },
    });

    criadas++;
    resultado.push({ cliente: cliente.nomeFantasia ?? cliente.nome, numero, status: "criada" });
  }

  return NextResponse.json({ ok: true, mes, ano, criadas, ignoradas, resultado });
}
