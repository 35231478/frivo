import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { medicaoSchema } from "@/lib/validations";
import { gerarNumeroMedicao } from "@/lib/utils";
import { calcularTotaisMedicao } from "@/lib/medicao-helpers";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const clienteId = searchParams.get("clienteId");
  const tipo = searchParams.get("tipo");
  const dataInicio = searchParams.get("dataInicio");
  const dataFim = searchParams.get("dataFim");
  const busca = searchParams.get("busca") ?? "";

  const where: any = { empresaId };
  if (status) where.status = status;
  if (clienteId) where.clienteId = clienteId;
  if (tipo) where.tipo = tipo;
  if (dataInicio || dataFim) {
    where.criadoEm = {};
    if (dataInicio) where.criadoEm.gte = new Date(dataInicio);
    if (dataFim) {
      const fim = new Date(dataFim);
      fim.setHours(23, 59, 59, 999);
      where.criadoEm.lte = fim;
    }
  }
  if (busca) {
    where.OR = [
      { numero: { contains: busca, mode: "insensitive" } },
      { descricao: { contains: busca, mode: "insensitive" } },
      { cliente: { nome: { contains: busca, mode: "insensitive" } } },
    ];
  }

  const medicoes = await prisma.medicao.findMany({
    where,
    include: {
      cliente: { select: { id: true, nome: true, nomeFantasia: true } },
      _count: { select: { itens: true } },
    },
    orderBy: { criadoEm: "desc" },
    take: 200,
  });

  return NextResponse.json(medicoes);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const body = await req.json();
  const parsed = medicaoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { erro: "Dados inválidos", detalhes: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // Garante que o cliente pertence ao tenant
  const cliente = await prisma.cliente.findFirst({ where: { id: data.clienteId, empresaId } });
  if (!cliente) return NextResponse.json({ erro: "Cliente inválido" }, { status: 400 });

  const ano = data.ano ?? new Date().getFullYear();
  const ultimaMed = await prisma.medicao.findFirst({
    where: { empresaId, numero: { startsWith: `MED-${ano}-` } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  const seq = (ultimaMed ? Number(ultimaMed.numero.split("-")[2]) : 0) + 1;
  const numero = gerarNumeroMedicao(seq, ano);
  const tokenPublico = crypto.randomUUID();

  const totais = calcularTotaisMedicao(data.itens, data.descontoValor, data.descontoPercent);

  // Enriquece itens com dados fiscais do serviço de catálogo, quando vinculado
  const servicoIds = data.itens.map((i) => i.servicoId).filter((x): x is string => !!x);
  const servicosFiscais = servicoIds.length
    ? await prisma.servico.findMany({
        where: { id: { in: servicoIds }, empresaId },
        select: {
          id: true, codigoMunicipal: true,
          aliquotaISS: true, aliquotaPIS: true, aliquotaCOFINS: true, aliquotaCSLL: true, aliquotaIR: true,
        },
      })
    : [];
  const fiscalPorServico = new Map(servicosFiscais.map((s) => [s.id, s]));

  const medicao = await prisma.medicao.create({
    data: {
      empresaId,
      clienteId: data.clienteId,
      contratoId: data.contratoId || null,
      numero,
      tipo: data.tipo,
      mes: data.mes ?? null,
      ano: data.ano ?? null,
      descricao: data.descricao ?? null,
      observacao: data.observacao ?? null,
      status: "RASCUNHO",
      valorTotal: totais.valorTotal,
      descontoValor: data.descontoValor,
      descontoPercent: data.descontoPercent,
      valorLiquido: totais.valorLiquido,
      tokenPublico,
      itens: {
        create: data.itens.map((it, idx) => {
          const f = it.servicoId ? fiscalPorServico.get(it.servicoId) : undefined;
          return {
            tipo: it.tipo,
            servicoId: it.servicoId || null,
            produtoId: it.produtoId || null,
            ordemServicoId: it.ordemServicoId || null,
            orcamentoId: it.orcamentoId || null,
            descricao: it.descricao,
            quantidade: it.quantidade,
            valorUnitario: it.valorUnitario,
            valorTotal: it.quantidade * it.valorUnitario,
            codigoMunicipal: it.codigoMunicipal ?? f?.codigoMunicipal ?? null,
            aliquotaISS: it.aliquotaISS ?? f?.aliquotaISS ?? null,
            aliquotaPIS: it.aliquotaPIS ?? f?.aliquotaPIS ?? null,
            aliquotaCOFINS: it.aliquotaCOFINS ?? f?.aliquotaCOFINS ?? null,
            aliquotaCSLL: it.aliquotaCSLL ?? f?.aliquotaCSLL ?? null,
            aliquotaIR: it.aliquotaIR ?? f?.aliquotaIR ?? null,
            observacao: it.observacao ?? null,
            ordem: idx,
          };
        }),
      },
    },
  });

  return NextResponse.json(medicao, { status: 201 });
}
