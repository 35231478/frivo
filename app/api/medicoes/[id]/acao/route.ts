import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { acaoMedicaoSchema } from "@/lib/validations";
import { statusAposAprovacao, calcularVencimento, buildMedicaoPublicUrl } from "@/lib/medicao-helpers";
import { gerarContaReceberDaMedicao } from "@/lib/financeiro-server";
import { whatsappLink } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "medicoes");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const parsed = acaoMedicaoSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const a = parsed.data;

  const medicao = await prisma.medicao.findFirst({
    where: { id, empresaId },
    include: { cliente: true, empresa: true },
  });
  if (!medicao) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const cliente = medicao.cliente;
  const origin = req.nextUrl.origin;

  switch (a.acao) {
    case "ENVIAR": {
      if (medicao.status !== "RASCUNHO" && medicao.status !== "AGUARDANDO_APROVACAO") {
        return NextResponse.json({ erro: "Medição não pode ser enviada neste status" }, { status: 400 });
      }
      await prisma.medicao.update({
        where: { id },
        data: { status: "AGUARDANDO_APROVACAO", dataEnvio: medicao.dataEnvio ?? new Date() },
      });
      const publicUrl = buildMedicaoPublicUrl(medicao.tokenPublico, origin);
      const emailDestino = cliente.emailsFaturamento[0] ?? cliente.email ?? null;
      const whatsappDestino = cliente.whatsappFaturamento ?? cliente.celular ?? null;
      const assunto = `Medição ${medicao.numero} — ${medicao.empresa.nomeFantasia ?? medicao.empresa.nome}`;
      const corpo =
        `Olá,\n\nSegue a medição ${medicao.numero} para sua avaliação e aprovação:\n\n${publicUrl}\n\n` +
        `Atenciosamente,\n${medicao.empresa.nomeFantasia ?? medicao.empresa.nome}`;
      return NextResponse.json({
        ok: true,
        publicUrl,
        mailtoUrl: emailDestino
          ? `mailto:${encodeURIComponent(emailDestino)}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`
          : null,
        whatsappUrl: whatsappDestino ? whatsappLink(whatsappDestino, `${corpo}`) : null,
      });
    }

    case "APROVAR_MANUAL": {
      if (medicao.status !== "AGUARDANDO_APROVACAO") {
        return NextResponse.json({ erro: "Medição não está aguardando aprovação" }, { status: 400 });
      }
      const proximo = statusAposAprovacao(cliente.exigePcAntesNf);
      const vencimento = calcularVencimento(cliente.diaFaturamento, medicao.mes, medicao.ano);
      await prisma.medicao.update({
        where: { id },
        data: { status: proximo, dataAprovacao: new Date(), dataVencimento: vencimento },
      });
      await gerarContaReceberDaMedicao(id);
      return NextResponse.json({ ok: true, status: proximo });
    }

    case "REGISTRAR_PC": {
      if (medicao.status !== "AGUARDANDO_PC") {
        return NextResponse.json({ erro: "Medição não está aguardando PC" }, { status: 400 });
      }
      if (!a.pcNumero) return NextResponse.json({ erro: "Informe o número do PC" }, { status: 400 });
      await prisma.medicao.update({
        where: { id },
        data: {
          status: "PC_RECEBIDO",
          pcNumero: a.pcNumero,
          pcAnexoUrl: a.pcAnexoUrl || null,
          pcRecebidoEm: new Date(),
        },
      });
      return NextResponse.json({ ok: true, status: "PC_RECEBIDO" });
    }

    case "REGISTRAR_NF": {
      if (medicao.status !== "PC_RECEBIDO") {
        return NextResponse.json({ erro: "Medição não está liberada para NF" }, { status: 400 });
      }
      if (!a.nfNumero) return NextResponse.json({ erro: "Informe o número da NF" }, { status: 400 });
      // NFS-e emitida aqui pelo PlugNotas (enviando, processando ou autorizada): registrar outra à mão duplicaria a NF
      const nfse = await prisma.notaFiscal.count({ where: { medicaoId: id, status: { in: ["ENVIANDO", "PROCESSANDO", "CONCLUIDO"] } } });
      if (nfse) {
        return NextResponse.json({ erro: "Esta medição já tem NFS-e emitida pelo sistema (veja “Notas fiscais (NFS-e)”). Não registre outra à mão." }, { status: 409 });
      }
      await prisma.medicao.update({
        where: { id },
        data: {
          status: "NF_EMITIDA",
          nfNumero: a.nfNumero,
          nfUrl: a.nfUrl || null,
          nfs: { create: { numero: a.nfNumero, url: a.nfUrl || null } },
        },
      });
      // Conta a receber passa a "A receber" quando a NF é emitida
      await prisma.contaReceber.updateMany({
        where: { medicaoId: id, status: "PREVISTO" },
        data: { status: "A_RECEBER" },
      });
      return NextResponse.json({ ok: true, status: "NF_EMITIDA" });
    }

    case "REGISTRAR_BOLETO": {
      if (medicao.status !== "NF_EMITIDA") {
        return NextResponse.json({ erro: "Emita a NF antes de gerar o boleto" }, { status: 400 });
      }
      await prisma.medicao.update({
        where: { id },
        data: {
          status: "BOLETO_GERADO",
          boletoUrl: a.boletoUrl || null,
          boletoCodigoBarras: a.boletoCodigoBarras || null,
        },
      });
      return NextResponse.json({ ok: true, status: "BOLETO_GERADO" });
    }

    case "REGISTRAR_PAGAMENTO": {
      if (medicao.status === "CANCELADA") {
        return NextResponse.json({ erro: "Medição cancelada" }, { status: 400 });
      }
      const dataPg = a.dataPagamento ? new Date(a.dataPagamento) : new Date();
      await prisma.medicao.update({
        where: { id },
        data: {
          status: "PAGO",
          dataPagamento: dataPg,
          formaPagamento: a.formaPagamento || null,
        },
      });
      await prisma.contaReceber.updateMany({
        where: { medicaoId: id, status: { not: "CANCELADO" } },
        data: { status: "RECEBIDO", dataRecebimento: dataPg, formaPagamento: a.formaPagamento || null },
      });
      return NextResponse.json({ ok: true, status: "PAGO" });
    }

    case "CANCELAR": {
      await prisma.medicao.update({ where: { id }, data: { status: "CANCELADA" } });
      // C6: a conta PREVISTA do CONTRATO não morre com a medição — ela volta a ser a
      // previsão da competência (desligada e com o valor da mensalidade), para o mês
      // poder ser refaturado (F4). Conta criada só para esta medição é cancelada.
      const vinculadas = await prisma.contaReceber.findMany({
        where: { medicaoId: id, status: { notIn: ["RECEBIDO", "CANCELADO"] } },
        include: { contrato: { select: { valorMensal: true } } },
      });
      for (const c of vinculadas) {
        if (c.contratoId) {
          await prisma.contaReceber.update({
            where: { id: c.id },
            data: { medicaoId: null, status: "PREVISTO", valor: c.contrato?.valorMensal ?? c.valor },
          });
        } else {
          await prisma.contaReceber.update({ where: { id: c.id }, data: { status: "CANCELADO" } });
        }
      }
      return NextResponse.json({ ok: true, status: "CANCELADA" });
    }

    default:
      return NextResponse.json({ erro: "Ação desconhecida" }, { status: 400 });
  }
}
