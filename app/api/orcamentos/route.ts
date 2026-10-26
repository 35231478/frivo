import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { respostaRefEmpresa, validarRefEmpresa, validarRefsEmpresa } from "@/lib/ref-empresa";
import { exigirPermissao } from "@/lib/permissoes-server";
import { orcamentoSchema } from "@/lib/validations";
import { gerarCodigoOrcamento } from "@/lib/utils";
import { camposCondicoes, montarValoresOrcamento, montarCamposProposta } from "@/lib/orcamento-helpers";
import { nomeDoOrcamento } from "@/lib/orcamentos/nome-server";
import { anoBR, periodoInstanteBR } from "@/lib/fuso";

export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("orcamentos", "visualizar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const tipo = searchParams.get("tipo");
  const clienteId = searchParams.get("clienteId");
  const dataInicio = searchParams.get("dataInicio");
  const dataFim = searchParams.get("dataFim");
  const busca = searchParams.get("busca") ?? "";

  const where: any = { empresaId };
  if (status) where.status = status;
  if (tipo) where.tipo = tipo;
  if (clienteId) where.clienteId = clienteId;
  if (dataInicio || dataFim) {
    where.criadoEm = periodoInstanteBR(dataInicio, dataFim) ?? {}; // dias de Brasília
  }
  if (busca) {
    where.OR = [
      { codigo: { contains: busca, mode: "insensitive" } },
      { nome: { contains: busca, mode: "insensitive" } },
      { cliente: { nome: { contains: busca, mode: "insensitive" } } },
    ];
  }

  const orcamentos = await prisma.orcamento.findMany({
    where,
    include: {
      cliente: { select: { id: true, nome: true, nomeFantasia: true } },
      _count: { select: { ordensServico: true } },
    },
    orderBy: { criadoEm: "desc" },
    take: 100,
  });

  return NextResponse.json(orcamentos);
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("orcamentos", "criar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const usuarioId = session.user!.id;

  const body = await req.json();
  const parsed = orcamentoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { erro: "Dados inválidos", detalhes: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // Cliente, responsável técnico e itens do catálogo precisam ser da mesma empresa
  try {
    await Promise.all([
      validarRefEmpresa("cliente", data.clienteId, empresaId, "Cliente"),
      validarRefEmpresa("tecnico", data.responsavelTecnicoId, empresaId, "Responsável técnico"),
      validarRefsEmpresa("servico", data.servicos.map((s) => s.catalogoId), empresaId, "Serviço do catálogo"),
      validarRefsEmpresa("produto", data.produtos.map((p) => p.catalogoId), empresaId, "Produto do catálogo"),
    ]);
  } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }

  // Valida que as OS vinculadas pertencem ao mesmo tenant e cliente (evita vínculo cross-tenant)
  if (data.ordensServicoIds.length) {
    const validas = await prisma.ordemServico.count({
      where: { id: { in: data.ordensServicoIds }, empresaId, clienteId: data.clienteId },
    });
    if (validas !== data.ordensServicoIds.length) {
      return NextResponse.json(
        { erro: "Uma ou mais ordens de serviço são inválidas ou não pertencem a este cliente" },
        { status: 400 }
      );
    }
  }

  const tokenPublico = crypto.randomUUID();
  // ISS: a alíquota da empresa HOJE fica congelada no orçamento
  const cfg = await prisma.configuracao.findUnique({ where: { empresaId }, select: { issAliquota: true } });
  const valores = montarValoresOrcamento(data, Number(cfg?.issAliquota ?? 0));
  const proposta = montarCamposProposta(data);
  // Nome em branco = automático (tipo da OS, equipamento, cliente/unidade ou itens)
  const nome = await nomeDoOrcamento(empresaId, data);

  // Numeração derivada do maior código existente do ano (evita reuso após exclusão); retry em colisão
  const ano = anoBR();
  let orcamento;
  for (let tentativa = 0; ; tentativa++) {
    const ultimo = await prisma.orcamento.findFirst({
      where: { empresaId, codigo: { startsWith: `ORC-${ano}-` } },
      orderBy: { codigo: "desc" },
      select: { codigo: true },
    });
    const seq = ultimo ? Number(ultimo.codigo.split("-")[2]) + 1 : 1;
    const codigo = gerarCodigoOrcamento(seq);

    try {
      orcamento = await prisma.orcamento.create({
        data: {
          empresaId,
          codigo,
          nome,
          ...camposCondicoes(data),
          clienteId: data.clienteId,
          criadoPorId: usuarioId,
          descricao: data.descricao ?? null,
          observacao: data.observacao ?? null,
          validadeEm: data.validadeEm ? new Date(data.validadeEm) : null,
          ...valores.campos,
          tokenPublico,
          ...proposta,
          servicos: { create: valores.servicos },
          produtos: { create: valores.produtos },
          ordensServico: {
            create: data.ordensServicoIds.map((osId) => ({ ordemServicoId: osId })),
          },
        },
      });
      break;
    } catch (e: any) {
      // P2002 = violação de unique (codigo, empresaId) por concorrência → tenta o próximo número
      if (e?.code === "P2002" && tentativa < 5) continue;
      throw e;
    }
  }

  return NextResponse.json(orcamento, { status: 201 });
}
