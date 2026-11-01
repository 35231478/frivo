import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { anoBR, mesBR } from "@/lib/fuso";
import { contratoCobraNaCompetencia, passoCobranca } from "@/lib/financeiro/contrato-previsao";
import { cobrancaDoContrato, gerarMedicaoDeContratos } from "@/lib/faturamento/medicao-contrato-server";

/**
 * Gera as medições mensais de todos os clientes com contrato ativo.
 * Body opcional: { mes, ano }. Default: mês/ano corrente.
 *
 * - Clientes perfil "Fatura única": agrupa todos os contratos + orçamentos
 *   aprovados do mês ainda não faturados em uma única medição (FATURA_UNICA).
 * - Demais clientes: uma medição MENSAL_FIXO por cliente com os contratos ativos.
 * - CO4: só entra o contrato cuja VIGÊNCIA cobre a competência (regra do aniversário) — o que
 *   começa depois ou já terminou não gera mensalidade, mesmo com status ATIVO.
 * - D1 (PR3-A): o contrato que cobra a cada N meses só entra no 1º mês de cada período.
 * - PR3-A: contrato com faturamento automático é da rotina diária (uma medição por contrato), não daqui.
 * - O contrato já cobrado nesta competência (por aqui ou pela rotina) não entra de novo.
 * A montagem e a gravação são o núcleo único `gerarMedicaoDeContratos` (o mesmo da rotina).
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
  const naVigencia = ativos.filter((c) => contratoCobraNaCompetencia(c.dataInicio, c.dataFim, ano, mes));
  const foraDaVigencia = ativos.filter((c) => !naVigencia.includes(c)).map((c) => c.numero);
  const noPeriodo = naVigencia.filter((c) => contratoCobraNaCompetencia(c.dataInicio, c.dataFim, ano, mes, passoCobranca(c.periodicidade)));
  const semCobrancaNoMes = naVigencia.filter((c) => !noPeriodo.includes(c)).map((c) => c.numero);
  const peloAutomatico = noPeriodo.filter((c) => c.faturamentoAutomatico).map((c) => c.numero);
  const contratos = noPeriodo.filter((c) => !c.faturamentoAutomatico);

  // Agrupa contratos por cliente
  const porCliente = new Map<string, typeof contratos>();
  for (const c of contratos) {
    const arr = porCliente.get(c.clienteId) ?? [];
    arr.push(c);
    porCliente.set(c.clienteId, arr);
  }

  let criadas = 0;
  let ignoradas = 0;
  const resultado: { cliente: string; numero?: string; status: string }[] = [];

  for (const [clienteId, contratosDoCliente] of porCliente) {
    const cliente = contratosDoCliente[0].cliente;
    const nome = cliente.nomeFantasia ?? cliente.nome;

    // Evita duplicar: a medição do CLIENTE no período (consolidada, sem contrato único) segura todos;
    // a de um contrato só segura aquele contrato
    const doCliente = await prisma.medicao.findFirst({
      where: { empresaId, clienteId, mes, ano, contratoId: null, tipo: { in: ["MENSAL_FIXO", "FATURA_UNICA"] }, status: { not: "CANCELADA" } },
      select: { id: true },
    });
    const pendentes: typeof contratosDoCliente = [];
    if (!doCliente) {
      for (const ct of contratosDoCliente) if (!(await cobrancaDoContrato(prisma, ct.id, ano, mes))) pendentes.push(ct);
    }
    if (!pendentes.length) {
      ignoradas++;
      resultado.push({ cliente: nome, status: "já existe" });
      continue;
    }

    const r = await gerarMedicaoDeContratos({ empresaId, cliente, contratos: pendentes, ano, mes });
    if (r.status === "criada") {
      criadas++;
      resultado.push({ cliente: nome, numero: r.medicao.numero, status: "criada" });
    } else {
      ignoradas++;
      resultado.push({
        cliente: nome,
        status: r.status === "sem-itens" ? "sem valor de contrato" : r.status === "ja-cobrado" ? "já existe" : "item já faturado em outra medição — gere de novo",
      });
    }
  }

  return NextResponse.json({ ok: true, mes, ano, criadas, ignoradas, foraDaVigencia, semCobrancaNoMes, peloAutomatico, resultado });
}
