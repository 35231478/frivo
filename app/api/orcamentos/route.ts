import { NextRequest, NextResponse } from "next/server";
import { registrarEvento } from "@/lib/orcamentos/ciclo-server";
import { itensDoOrcamentoParaTrava, verificarPrecoDeTabela } from "@/lib/precos/trava-tabela-server";
import { textoDaTrilha } from "@/lib/precos/trava-tabela";
import { prisma } from "@/lib/prisma";
import { respostaRefEmpresa, validarRefEmpresa, validarRefsEmpresa } from "@/lib/ref-empresa";
import { exigirPermissao } from "@/lib/permissoes-server";
import { orcamentoSchema } from "@/lib/validations";
import { camposCondicoes, montarValoresOrcamento, montarCamposProposta } from "@/lib/orcamento-helpers";
import { nomeDoOrcamento } from "@/lib/orcamentos/nome-server";
import { destinatarioSugerido, padroesOrcamento, validadeDoPadrao, validarDestinatario } from "@/lib/orcamentos/padroes-server";
import { periodoInstanteBR } from "@/lib/fuso";
import { comNumero } from "@/lib/numeracao-server";
import { gravarItensOrcamento, validarMateriaisDoOrcamento } from "@/lib/orcamentos/materiais-server";
import { fixarCustosDosMateriais } from "@/lib/orcamentos/estoque-margem-server";

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
      { cliente: { nomeFantasia: { contains: busca, mode: "insensitive" } } },
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
      validarDestinatario(empresaId, data.clienteId, data.unidadeId, data.contatoClienteId),
      // E3.3: materiais das linhas de serviço (regra pura + produtos da empresa)
      validarMateriaisDoOrcamento(empresaId, data.servicos),
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
  // Campo que não veio = padrão de Configurações (validade, garantias, não incluso, normas, RT padrão)
  const padroes = await padroesOrcamento(empresaId);
  // "Orçamento E2": a regra de cobrança dos materiais é a da EMPRESA hoje, congelada no orçamento (o navegador não escolhe)
  const valores = montarValoresOrcamento(data, Number(cfg?.issAliquota ?? 0), padroes.cobrancaMateriais);
  // O custo dos materiais é decidido aqui (último custo de compra), nunca o que veio do navegador
  await fixarCustosDosMateriais(empresaId, null, valores.servicos);
  // Preço que veio da tabela do cliente: travado (só com a permissão e o motivo — lib/precos/trava-tabela)
  const trava = await verificarPrecoDeTabela({ user: session.user!, empresaId, clienteId: data.clienteId, itens: itensDoOrcamentoParaTrava(valores), motivo: data.motivoPrecoTabela });
  if (!trava.veredito.ok) return NextResponse.json({ erro: trava.veredito.erro, precoTabela: true }, { status: trava.veredito.status });
  const proposta = montarCamposProposta(
    data.responsavelTecnicoId === undefined ? { ...data, responsavelTecnicoId: padroes.responsavelTecnicoId } : data,
  );
  const sugerido = data.unidadeId === undefined || data.contatoClienteId === undefined
    ? await destinatarioSugerido(empresaId, data.clienteId, data.ordensServicoIds)
    : null;
  // Nome em branco = automático (tipo da OS, equipamento, cliente/unidade ou itens)
  const nome = await nomeDoOrcamento(empresaId, data);

  // Número pelo contador da empresa, sob trava, na mesma transação do INSERT (nunca duplica)
  const orcamento = await comNumero(empresaId, "orcamento", async (codigo, tx) => {
      const criado = await tx.orcamento.create({
        data: {
          empresaId,
          codigo,
          nome,
          ...camposCondicoes(data, padroes),
          // Leva D: as opções do documento do cliente nascem com o padrão da empresa
          mostrarMateriais: padroes.mostrarMateriais,
          // "Orçamento E2": a regra com que o orçamento nasce (mudar a configuração depois não o altera)
          cobrancaMateriais: padroes.cobrancaMateriais,
          clienteId: data.clienteId,
          unidadeId: data.unidadeId === undefined ? sugerido!.unidadeId : data.unidadeId || null,
          contatoClienteId: data.contatoClienteId === undefined ? sugerido!.contatoClienteId : data.contatoClienteId || null,
          criadoPorId: usuarioId,
          // COM-1: o vendedor nasce = quem criou (travado; só "Trocar vendedor" muda, com motivo na trilha)
          vendedorId: usuarioId,
          descricao: data.descricao ?? null,
          observacao: data.observacao ?? null,
          validadeEm: data.validadeEm === undefined ? validadeDoPadrao(padroes.validadeDias) : data.validadeEm ? new Date(data.validadeEm) : null,
          ...valores.campos,
          tokenPublico,
          ...proposta,
          ordensServico: {
            create: data.ordensServicoIds.map((osId) => ({ ordemServicoId: osId })),
          },
        },
      });
      // Linhas em ordem: serviço → materiais (snapshot) → produtos → peças derivadas
      await gravarItensOrcamento(tx, criado.id, valores);
      if (trava.alteracoes.length && trava.veredito.ok && trava.veredito.motivo) {
        await registrarEvento({ empresaId, orcamentoId: criado.id, tipo: "PRECO_TABELA", usuarioId, detalhe: textoDaTrilha(trava.alteracoes, trava.veredito.motivo) }, tx);
      }
      return criado;
  });

  return NextResponse.json(orcamento, { status: 201 });
}
