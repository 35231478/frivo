import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { categoriaParaGravar, centroCustoParaGravar, contaBancariaParaGravar, respostaRefEmpresa } from "@/lib/ref-empresa";
import { contaReceberUpdateSchema } from "@/lib/validations";
import { chaveDiaCivil } from "@/lib/fuso";
import { formatarMoeda, LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import {
  descreverAlteracoes, motivoNaoCancelar, motivoNaoExcluir, motivoNaoReceber, motivoNaoTrocarCliente, travasDaConta,
} from "@/lib/financeiro/conta-receber-gestao";
import { detalhesDaConta, registrarEventoCR } from "@/lib/financeiro/conta-receber-server";
import { ErroConta, registrarRecebimento } from "@/lib/financeiro/parcelas-server";

type Params = { params: Promise<{ id: string }> };

/** Detalhes para a gaveta (origem, itens, boleto, notas, histórico). */
export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "contasReceber");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const d = await detalhesDaConta(guard.session.user!.empresaId, id);
  if (!d) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(d);
}

/**
 * Edição completa, baixa TOTAL (status RECEBIDO — pelo mesmo caminho único da baixa parcial:
 * registrarRecebimento) e cancelamento (status CANCELADO, com motivo). As regras (o que pode e o que
 * fica travado) são as mesmas da tela: lib/financeiro/conta-receber-gestao.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "contasReceber");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;
  const usuarioId = session.user!.id;

  const existente = await prisma.contaReceber.findFirst({
    where: { id, empresaId, excluidaEm: null },
    include: {
      notasFiscais: { select: { status: true } }, cliente: { select: { nome: true, nomeFantasia: true } },
      categoriaFinanceira: { select: { nome: true } }, centroCusto: { select: { nome: true } }, contaBancaria: { select: { nome: true } },
    },
  });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  // O lançamento parcelado não se edita: o dinheiro (e as ações) estão nas parcelas
  if (existente.status === "PARCELADO") return NextResponse.json({ erro: "Conta parcelada: edite as parcelas." }, { status: 409 });

  const parsed = contaReceberUpdateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const regra = { ...existente, notas: existente.notasFiscais };
  const mudaStatus = d.status !== undefined && d.status !== existente.status;

  // Baixa e cancelamento repetidos (duplo clique, outra aba) são recusados com o motivo
  if (d.status === "RECEBIDO") {
    const m = motivoNaoReceber(regra);
    if (m) return NextResponse.json({ erro: m }, { status: 409 });
  }
  if (d.status === "CANCELADO") {
    const m = motivoNaoCancelar(regra);
    if (m) return NextResponse.json({ erro: m }, { status: 409 });
    if (!d.motivoCancelamento || d.motivoCancelamento.length < 3) return NextResponse.json({ erro: "Informe o motivo do cancelamento." }, { status: 400 });
  }
  // Valor e vencimento travados (recebida/cancelada, boleto emitido, nota fiscal emitida)
  const travas = travasDaConta(regra);
  if (d.valor !== undefined && Number(d.valor) !== Number(existente.valor) && travas.valor) return NextResponse.json({ erro: travas.valor }, { status: 409 });
  if (d.dataVencimento && travas.vencimento && (!existente.dataVencimento || chaveDiaCivil(existente.dataVencimento) !== d.dataVencimento.slice(0, 10)))
    return NextResponse.json({ erro: travas.vencimento }, { status: 409 });

  // Cliente: só na conta manual sem boleto/nota; precisa ser da empresa
  let novoCliente: { id: string; cpfCnpj: string } | null = null;
  if (d.clienteId && d.clienteId !== existente.clienteId) {
    const m = motivoNaoTrocarCliente(regra);
    if (m) return NextResponse.json({ erro: m }, { status: 409 });
    novoCliente = await prisma.cliente.findFirst({ where: { id: d.clienteId, empresaId }, select: { id: true, cpfCnpj: true } });
    if (!novoCliente) return NextResponse.json({ erro: "Cliente inválido(a)." }, { status: 400 });
  }

  // Vínculos por ID, da empresa; escolha NOVA precisa estar ativa (manter a atual é aceito)
  let categoria: Awaited<ReturnType<typeof categoriaParaGravar>>;
  let centro: Awaited<ReturnType<typeof centroCustoParaGravar>>;
  let contaBancaria: Awaited<ReturnType<typeof contaBancariaParaGravar>>;
  try {
    categoria = await categoriaParaGravar(d.categoriaId, empresaId, existente.categoriaId);
    centro = await centroCustoParaGravar(d.centroCustoId, empresaId, existente.centroCustoId);
    contaBancaria = await contaBancariaParaGravar(d.contaBancariaId, empresaId, existente.contaBancariaId);
  } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }

  const dataRecebimento =
    d.status === "RECEBIDO"
      ? (d.dataRecebimento ? new Date(d.dataRecebimento) : new Date())
      : d.dataRecebimento === null
        ? null
        : undefined;
  // Conta bancária escolhida → o nome dela vai para `banco` (texto, histórico e filtro da lista)
  const banco = contaBancaria.contaBancariaId !== undefined
    ? (contaBancaria.contaBancariaId ? contaBancaria.banco : d.banco === undefined ? null : d.banco || null)
    : d.banco === undefined ? undefined : d.banco || null;

  // Baixa total: o saldo que falta, com a conta trancada (dois cliques não recebem 2×); grava o
  // recebimento, o evento e quita a medição de origem
  const recebendo = mudaStatus && d.status === "RECEBIDO";
  if (recebendo) {
    try {
      await prisma.$transaction((tx) => registrarRecebimento(tx, {
        empresaId, contaId: id, data: dataRecebimento!, formaPagamento: d.formaPagamento ?? null,
        contaBancariaId: contaBancaria.contaBancariaId !== undefined ? contaBancaria.contaBancariaId : existente.contaBancariaId,
        origem: "MANUAL", observacao: d.comentario || null, usuarioId,
      }), { timeout: 20_000 });
    } catch (e) {
      if (e instanceof ErroConta) return NextResponse.json({ erro: e.message }, { status: e.status });
      throw e;
    }
  }
  // Corrida (dois cliques ao mesmo tempo): só UM pedido cancela
  if (mudaStatus && d.status === "CANCELADO") {
    const virou = await prisma.contaReceber.updateMany({
      where: { id, empresaId, excluidaEm: null, status: { notIn: ["RECEBIDO", "CANCELADO", "PARCELADO"] }, valorRecebido: 0 },
      data: { status: d.status },
    });
    if (!virou.count) return NextResponse.json({ erro: "Esta conta já está cancelada (ou mudou). Atualize a tela." }, { status: 409 });
  }

  const atualizada = await prisma.contaReceber.update({
    where: { id },
    data: {
      // A baixa já gravou status/data (registrarRecebimento)
      status: recebendo ? undefined : d.status,
      descricao: d.descricao ?? undefined,
      // Sem categoriaId no corpo, nada muda (inclusive o texto antigo de contas ainda sem categoria ligada)
      categoriaId: categoria.categoriaId,
      categoria: categoria.categoriaId === undefined ? undefined : categoria.nome,
      centroCustoId: centro.centroCustoId,
      contaBancariaId: contaBancaria.contaBancariaId,
      valor: d.valor ?? undefined,
      formaPagamento: d.formaPagamento === undefined ? undefined : d.formaPagamento,
      banco,
      observacao: d.observacao === undefined ? undefined : d.observacao || null,
      dataVencimento: d.dataVencimento ? new Date(d.dataVencimento) : d.dataVencimento === null && !travas.vencimento ? null : undefined,
      dataRecebimento: recebendo ? undefined : dataRecebimento,
      ...(novoCliente && { clienteId: novoCliente.id, clienteCnpj: novoCliente.cpfCnpj }),
      ...(mudaStatus && d.status === "CANCELADO" && { canceladaEm: new Date(), motivoCancelamento: d.motivoCancelamento }),
    },
    include: {
      cliente: { select: { nome: true, nomeFantasia: true } },
      categoriaFinanceira: { select: { nome: true } }, centroCusto: { select: { nome: true } }, contaBancaria: { select: { nome: true } },
    },
  });

  // Linha do tempo: cancelamento e o que mudou na edição (a baixa grava o dela)
  const evento = (tipo: string, detalhe: string | null) => registrarEventoCR({ empresaId, contaReceberId: id, tipo, detalhe, usuarioId });
  if (mudaStatus && d.status === "CANCELADO") {
    await evento("CANCELADA", d.motivoCancelamento!);
  }
  const resumo = (c: typeof existente | typeof atualizada) => ({
    cliente: c.cliente ? c.cliente.nomeFantasia ?? c.cliente.nome : null, descricao: c.descricao, valor: Number(c.valor), dataVencimento: c.dataVencimento ? chaveDiaCivil(c.dataVencimento) : null,
    formaPagamento: c.formaPagamento ? LABELS_FORMA_PAGAMENTO[c.formaPagamento] : null,
    categoria: c.categoriaFinanceira?.nome ?? c.categoria ?? null, centroCusto: c.centroCusto?.nome ?? null,
    contaBancaria: c.contaBancaria?.nome ?? c.banco ?? null, observacao: c.observacao ?? null,
  });
  if (!mudaStatus || (d.status !== "RECEBIDO" && d.status !== "CANCELADO")) {
    const mudancas = descreverAlteracoes(resumo(existente), resumo(atualizada));
    if (mudancas) await evento("EDITADA", mudancas);
  }

  // Confirmação de pagamento por e-mail (a função verifica toggle + preferência do cliente)
  if (recebendo) {
    const { enviarConfirmacaoPagamento } = await import("@/lib/email");
    await enviarConfirmacaoPagamento(id).catch(() => {});
  }

  const { categoriaFinanceira: _c, centroCusto: _cc, contaBancaria: _cb, cliente: _cl, ...corpo } = atualizada;
  return NextResponse.json(corpo);
}

/**
 * Excluir = exclusão LÓGICA, só para conta MANUAL sem nota fiscal (conta de medição, orçamento ou
 * contrato, ou com nota emitida, se cancela). A conta sai das listas e dos totais (fica CANCELADA com
 * `excluidaEm`); o registro e o histórico permanecem.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "contasReceber");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user!.empresaId;

  const conta = await prisma.contaReceber.findFirst({ where: { id, empresaId }, include: { notasFiscais: { select: { status: true } } } });
  if (!conta) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  const motivo = motivoNaoExcluir({ ...conta, notas: conta.notasFiscais });
  if (motivo) return NextResponse.json({ erro: motivo }, { status: 409 });
  const corpo = await req.json().catch(() => ({}));
  const justificativa = typeof corpo?.motivo === "string" ? corpo.motivo.trim().slice(0, 500) : "";

  // Só exclui se ainda não foi excluída (dois cliques: o segundo não grava outro evento)
  const r = await prisma.contaReceber.updateMany({
    where: { id, empresaId, excluidaEm: null },
    data: { excluidaEm: new Date(), status: "CANCELADO", canceladaEm: conta.canceladaEm ?? new Date(), motivoCancelamento: conta.motivoCancelamento ?? "Excluída" },
  });
  if (r.count) {
    await registrarEventoCR({
      empresaId, contaReceberId: id, tipo: "EXCLUIDA", usuarioId: guard.session.user!.id,
      detalhe: [`${conta.numero} — ${formatarMoeda(Number(conta.valor))} (status anterior: ${conta.status})`, justificativa].filter(Boolean).join(" · "),
    });
  }
  return NextResponse.json({ ok: true });
}
