/**
 * Emissão do boleto Inter de UMA conta a receber — o núcleo único da rota "Emitir boleto" (Contas a
 * Receber) e da rotina de faturamento dos contratos (PR3-B). A conta fica TRANCADA (FOR UPDATE)
 * enquanto o Inter responde: dois pedidos ao mesmo tempo (clique duplo, a tela e a rotina) não
 * emitem dois boletos — o segundo espera e encontra o boleto do primeiro.
 */
import { prisma } from "@/lib/prisma";
import { emitirBoletoInter, carregarConfigInter } from "@/lib/inter-api";
import { enviarBoleto, type ResultadoEmail } from "@/lib/email";
import { chaveDiaCivil, chaveHojeBR } from "@/lib/fuso";
import { formatarData } from "@/lib/utils";
import { registrarEventoCR } from "@/lib/financeiro/conta-receber-server";
import { saldoDaConta } from "@/lib/financeiro/parcelas";

export class ErroBoleto extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Por que a conta NÃO pode receber boleto (null = pode). Mesmas regras de sempre da rota. */
export function motivoSemBoleto(c: { status: string; boletoId?: string | null; boletoStatus?: string | null }): string | null {
  // F5: previsão não é cobrança — boleto só depois que a medição for aprovada e a conta liberada
  if (c.status === "PREVISTO") return "Esta conta ainda é uma PREVISÃO do contrato. Gere e aprove a medição do mês (a previsão vira a cobrança) antes de emitir o boleto.";
  if (c.status === "RECEBIDO" || c.status === "CANCELADO") return "Conta recebida/cancelada não emite boleto.";
  if (c.status === "PERDA") return "Conta em perda: reverta a perda antes de cobrar.";
  if (c.status === "RENEGOCIADO") return "Conta renegociada: cobre pelas cobranças da renegociação.";
  if (c.status === "PARCELADO") return "Conta parcelada: emita o boleto em cada parcela.";
  if (c.boletoId && (c.boletoStatus === "EMITIDO" || c.boletoStatus === "PAGO")) return "Já existe um boleto emitido para esta conta.";
  return null;
}

export interface OpcoesBoleto {
  /** Quem emitiu (null = a rotina automática) */
  usuarioId: string | null;
  vencimento?: string;
  mensagem?: string;
  descontoValor?: number;
  multaPercentual?: number;
  jurosPercentualMes?: number;
}

/**
 * Emite o boleto da conta (empresa da sessão ou do contrato) e manda o e-mail ao cliente (D6; a
 * função do e-mail confere a chave da empresa e a preferência do cliente). Erros: ErroBoleto.
 */
export async function emitirBoletoDaConta(empresaId: string, contaId: string, o: OpcoesBoleto) {
  const { ativo } = await carregarConfigInter(empresaId);
  if (!ativo) throw new ErroBoleto("Integração com o Banco Inter não está configurada/ativa.");

  const emitida = await prisma.$transaction(async (tx) => {
    const [trava] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM contas_receber WHERE id = ${contaId} AND empresa_id = ${empresaId} FOR UPDATE`;
    if (!trava) throw new ErroBoleto("Conta não encontrada", 404);
    const conta = await tx.contaReceber.findFirst({ where: { id: contaId, empresaId, excluidaEm: null }, include: { cliente: true } });
    if (!conta) throw new ErroBoleto("Conta não encontrada", 404);
    const motivo = motivoSemBoleto(conta);
    if (motivo) throw new ErroBoleto(motivo);

    const cli = conta.cliente;
    const vencimento = (o.vencimento || (conta.dataVencimento ? chaveDiaCivil(conta.dataVencimento) : "")) || chaveHojeBR(7);
    let boleto;
    try {
      boleto = await emitirBoletoInter(empresaId, {
        seuNumero: conta.numero.replace(/\D/g, "").slice(-15) || conta.id.slice(-15),
        // O que falta receber (baixa parcial já descontada); parcela = o valor dela
        valorNominal: saldoDaConta(conta),
        dataVencimento: vencimento,
        mensagem: o.mensagem,
        descontoValor: o.descontoValor,
        multaPercentual: o.multaPercentual ?? 2,
        jurosPercentualMes: o.jurosPercentualMes ?? 1,
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
    } catch (e) {
      throw new ErroBoleto((e as Error)?.message || "Erro ao emitir boleto.", 502);
    }
    const atualizada = await tx.contaReceber.update({
      where: { id: contaId },
      data: {
        boletoId: boleto.codigoSolicitacao,
        boletoNossoNumero: boleto.nossoNumero,
        boletoCodigoBarras: boleto.codigoBarras,
        boletoLinhaDigitavel: boleto.linhaDigitavel,
        boletoStatus: "EMITIDO",
        boletoEmitidoEm: new Date(),
        boletoVencimento: new Date(vencimento),
      },
      select: { id: true, boletoId: true, boletoNossoNumero: true, boletoCodigoBarras: true, boletoLinhaDigitavel: true, boletoEmitidoEm: true, boletoVencimento: true },
    });
    await registrarEventoCR({
      empresaId, contaReceberId: contaId, tipo: "BOLETO_EMITIDO",
      detalhe: `Banco Inter · vence ${formatarData(vencimento)}${o.usuarioId ? "" : " · pela rotina do contrato"}`, usuarioId: o.usuarioId,
    }, tx);
    return atualizada;
  }, { timeout: 45_000, maxWait: 45_000 });

  const email: ResultadoEmail = await enviarBoleto(contaId).catch((e) => ({ ok: false, erro: (e as Error)?.message ?? "Erro no envio." }));
  return { conta: emitida, email };
}
