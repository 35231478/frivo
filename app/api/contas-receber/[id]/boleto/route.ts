import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { emitirBoletoInter, cancelarBoletoInter, carregarConfigInter } from "@/lib/inter-api";
import { enviarBoleto } from "@/lib/email";
import { chaveDiaCivil, chaveHojeBR } from "@/lib/fuso";
import { formatarData } from "@/lib/utils";
import { registrarEventoCR } from "@/lib/financeiro/conta-receber-server";
import { saldoDaConta } from "@/lib/financeiro/parcelas";

type Params = { params: Promise<{ id: string }> };

const emitirSchema = z.object({
  vencimento: z.string().optional(),
  mensagem: z.string().optional(),
  descontoValor: z.number().optional(),
  multaPercentual: z.number().optional(),
  jurosPercentualMes: z.number().optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "contasReceber");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user.empresaId;

  const { ativo } = await carregarConfigInter(empresaId);
  if (!ativo) return NextResponse.json({ erro: "Integração com o Banco Inter não está configurada/ativa." }, { status: 400 });

  const conta = await prisma.contaReceber.findFirst({
    where: { id, empresaId, excluidaEm: null },
    include: { cliente: true },
  });
  if (!conta) return NextResponse.json({ erro: "Conta não encontrada" }, { status: 404 });
  // F5: previsão não é cobrança — boleto só depois que a medição for aprovada e a conta
  // estiver liberada (A_RECEBER/ATRASADO). Emitir sobre a PREVISTO cobrava o cliente 2×.
  if (conta.status === "PREVISTO") {
    return NextResponse.json({ erro: "Esta conta ainda é uma PREVISÃO do contrato. Gere e aprove a medição do mês (a previsão vira a cobrança) antes de emitir o boleto." }, { status: 400 });
  }
  if (conta.status === "RECEBIDO" || conta.status === "CANCELADO") {
    return NextResponse.json({ erro: "Conta recebida/cancelada não emite boleto." }, { status: 400 });
  }
  if (conta.status === "PARCELADO") {
    return NextResponse.json({ erro: "Conta parcelada: emita o boleto em cada parcela." }, { status: 400 });
  }
  if (conta.boletoId && conta.boletoStatus === "EMITIDO") {
    return NextResponse.json({ erro: "Já existe um boleto emitido para esta conta." }, { status: 400 });
  }

  const parsed = emitirSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const d = parsed.data;

  const cli = conta.cliente;
  const vencimento = (d.vencimento || (conta.dataVencimento ? chaveDiaCivil(conta.dataVencimento) : "")) || chaveHojeBR(7);

  try {
    const emitido = await emitirBoletoInter(empresaId, {
      seuNumero: conta.numero.replace(/\D/g, "").slice(-15) || conta.id.slice(-15),
      // O que falta receber (baixa parcial já descontada); parcela = o valor dela
      valorNominal: saldoDaConta(conta),
      dataVencimento: vencimento,
      mensagem: d.mensagem,
      descontoValor: d.descontoValor,
      multaPercentual: d.multaPercentual ?? 2,
      jurosPercentualMes: d.jurosPercentualMes ?? 1,
      pagador: {
        nome: cli.nomeFantasia ?? cli.nome,
        cpfCnpj: conta.clienteCnpj ?? cli.cpfCnpj,
        tipoPessoa: cli.tipoPessoa === "FISICA" ? "FISICA" : "JURIDICA",
        cep: cli.cep ?? undefined,
        endereco: cli.endereco ?? undefined,
        numero: cli.numero ?? undefined,
        bairro: cli.bairro ?? undefined,
        cidade: cli.cidade ?? undefined,
        uf: cli.estado ?? undefined,
      },
    });

    const atualizada = await prisma.contaReceber.update({
      where: { id },
      data: {
        boletoId: emitido.codigoSolicitacao,
        boletoNossoNumero: emitido.nossoNumero,
        boletoCodigoBarras: emitido.codigoBarras,
        boletoLinhaDigitavel: emitido.linhaDigitavel,
        boletoStatus: "EMITIDO",
        boletoEmitidoEm: new Date(),
        boletoVencimento: new Date(vencimento),
      },
      select: { id: true, boletoId: true, boletoNossoNumero: true, boletoCodigoBarras: true, boletoLinhaDigitavel: true, boletoEmitidoEm: true, boletoVencimento: true },
    });
    await registrarEventoCR({ empresaId, contaReceberId: id, tipo: "BOLETO_EMITIDO", detalhe: `Banco Inter · vence ${formatarData(vencimento)}`, usuarioId: guard.session.user.id });
    // Envia o boleto por e-mail, se configurado (a função verifica toggle + preferência do cliente)
    await enviarBoleto(id).catch(() => {});
    return NextResponse.json(atualizada, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ erro: e?.message ?? "Erro ao emitir boleto." }, { status: 502 });
  }
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "contasReceber");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user.empresaId;

  const conta = await prisma.contaReceber.findFirst({ where: { id, empresaId, excluidaEm: null } });
  if (!conta?.boletoId) return NextResponse.json({ erro: "Nenhum boleto para cancelar." }, { status: 400 });
  if (conta.boletoStatus === "PAGO") return NextResponse.json({ erro: "Boleto já pago não pode ser cancelado." }, { status: 400 });

  try {
    await cancelarBoletoInter(empresaId, conta.boletoId);
    await prisma.contaReceber.update({ where: { id }, data: { boletoStatus: "CANCELADO" } });
    await registrarEventoCR({ empresaId, contaReceberId: id, tipo: "BOLETO_CANCELADO", detalhe: "Banco Inter", usuarioId: guard.session.user.id });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ erro: e?.message ?? "Erro ao cancelar boleto." }, { status: 502 });
  }
}
