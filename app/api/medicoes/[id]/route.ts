import { NextRequest, NextResponse } from "next/server";
import { travarParaFaturar } from "@/lib/faturamento-os";
import { calcularRetencoes, retencoesDaMedicao } from "@/lib/financeiro/retencoes";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { respostaRefEmpresa, validarRefsEmpresa } from "@/lib/ref-empresa";
import { medicaoSchema } from "@/lib/validations";
import { calcularTotaisMedicao } from "@/lib/medicao-helpers";
import { motivoNaoExcluirMedicao } from "@/lib/cadastros/regras-arquivar";
import { precosAnterioresDaMedicao, registrarPrecoDeTabelaNaFatura, verificarPrecoDeTabela } from "@/lib/precos/trava-tabela-server";
import { itensDaMedicaoParaTrava } from "@/lib/precos/trava-tabela";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "medicoes");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const medicao = await prisma.medicao.findFirst({
    where: { id, empresaId },
    include: {
      cliente: true,
      contrato: { select: { id: true, numero: true } },
      itens: { orderBy: { ordem: "asc" } },
      nfs: { orderBy: { emitidaEm: "desc" } },
      contasReceber: true,
    },
  });
  if (!medicao) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(medicao);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "medicoes");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.medicao.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  if (existente.status !== "RASCUNHO") {
    return NextResponse.json({ erro: "Só é possível editar medições em rascunho" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = medicaoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  // Serviços/produtos do catálogo precisam ser da mesma empresa
  try {
    await Promise.all([
      validarRefsEmpresa("servico", data.itens.map((i) => i.servicoId), empresaId, "Serviço"),
      validarRefsEmpresa("produto", data.itens.map((i) => i.produtoId), empresaId, "Produto"),
      validarRefsEmpresa("ordemServico", data.itens.map((i) => i.ordemServicoId), empresaId, "OS"),
      validarRefsEmpresa("orcamento", data.itens.map((i) => i.orcamentoId), empresaId, "Orçamento"),
    ]);
  } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }
  // Preço de tabela travado (a mesma regra do orçamento e da OS): o preço já gravado na medição não pede de novo
  const trava = await verificarPrecoDeTabela({
    user: session.user!, empresaId, clienteId: data.clienteId, itens: itensDaMedicaoParaTrava(data.itens),
    anteriores: await precosAnterioresDaMedicao(id), motivo: data.motivoPrecoTabela,
  });
  if (!trava.veredito.ok) return NextResponse.json({ erro: trava.veredito.erro, precoTabela: true }, { status: trava.veredito.status });
  const motivoPrecoTabela = trava.veredito.motivo;
  const totais = calcularTotaisMedicao(data.itens, data.descontoValor, data.descontoPercent);
  // Retenções marcadas continuam as mesmas; o valor delas acompanha o novo valor da nota
  const retencoes = calcularRetencoes(totais.valorLiquido, retencoesDaMedicao(existente));
  if (retencoes.liquido < 0) return NextResponse.json({ erro: "As retenções passam do novo valor. Ajuste as retenções antes." }, { status: 400 });

  // Trava (a/c): a edição não pode trazer OS/orçamento já faturado em OUTRA medição viva
  const r = await prisma.$transaction(async (tx) => {
    const travadas = await travarParaFaturar(tx, {
      osIds: data.itens.map((i) => i.ordemServicoId), orcamentoIds: data.itens.map((i) => i.orcamentoId), ignorarMedicaoId: id,
    });
    const ja = [...travadas.os, ...travadas.orcamentos][0];
    if (ja) return { conflito: `Um item já está faturado na medição ${ja.medicao.numero}. Cancele-a antes de faturar de novo.` };
    if (motivoPrecoTabela) {
      await registrarPrecoDeTabelaNaFatura(tx, { empresaId, usuarioId: session.user!.id, numero: existente.numero, avulsa: existente.avulsa, alteracoes: trava.alteracoes, motivo: motivoPrecoTabela });
    }
    return { atualizada: await tx.medicao.update({
    where: { id },
    data: {
      clienteId: data.clienteId,
      contratoId: data.contratoId || null,
      tipo: data.tipo,
      mes: data.mes ?? null,
      ano: data.ano ?? null,
      descricao: data.descricao ?? null,
      observacao: data.observacao ?? null,
      valorTotal: totais.valorTotal,
      descontoValor: data.descontoValor,
      descontoPercent: data.descontoPercent,
      valorLiquido: totais.valorLiquido,
      valorRetencoes: retencoes.total,
      itens: {
        deleteMany: {},
        create: data.itens.map((it, idx) => ({
          tipo: it.tipo,
          servicoId: it.servicoId || null,
          produtoId: it.produtoId || null,
          ordemServicoId: it.ordemServicoId || null,
          orcamentoId: it.orcamentoId || null,
          descricao: it.descricao,
          quantidade: it.quantidade,
          valorUnitario: it.valorUnitario,
          valorTotal: it.quantidade * it.valorUnitario,
          codigoMunicipal: it.codigoMunicipal || null,
          aliquotaISS: it.aliquotaISS ?? null,
          aliquotaPIS: it.aliquotaPIS ?? null,
          aliquotaCOFINS: it.aliquotaCOFINS ?? null,
          aliquotaCSLL: it.aliquotaCSLL ?? null,
          aliquotaIR: it.aliquotaIR ?? null,
          observacao: it.observacao ?? null,
          ordem: idx,
        })),
      },
    },
    }) };
  }, { timeout: 20_000 });
  if ("conflito" in r) return NextResponse.json({ erro: r.conflito }, { status: 409 });
  return NextResponse.json(r.atualizada);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "medicoes");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.medicao.findFirst({
    where: { id, empresaId },
    select: { status: true, nfNumero: true, _count: { select: { contasReceber: true, notasFiscais: true } } },
  });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  // Excluir de verdade só o rascunho que não gerou conta nem nota; o resto é documento e se cancela
  const motivo = motivoNaoExcluirMedicao({ status: existente.status, nfNumero: existente.nfNumero, ...existente._count });
  if (motivo) return NextResponse.json({ erro: motivo }, { status: 409 });

  await prisma.medicao.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
