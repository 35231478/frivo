import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { acaoMedicaoSchema } from "@/lib/validations";
import { buildMedicaoPublicUrl } from "@/lib/medicao-helpers";
import { desfazerContasDaMedicao } from "@/lib/financeiro-server";
import { aprovarMedicao, marcarEnviada } from "@/lib/faturamento/aprovar-medicao-server";
import { whatsappLink } from "@/lib/utils";
import { cobrancasDaMedicao, cobrancasQueTravamMedicao, liberarCobrancasDaMedicao, registrarRecebimento } from "@/lib/financeiro/parcelas-server";

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
      if (!(await marcarEnviada(id))) return NextResponse.json({ erro: "Medição não pode ser enviada neste status" }, { status: 409 });
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
      // Atômico (b): o 2º "Aprovar" simultâneo não passa daqui; a conta nasce uma vez só (núcleo único, D2 no vencimento)
      const aprovada = await aprovarMedicao(id);
      if (!aprovada) return NextResponse.json({ erro: "Medição não está aguardando aprovação" }, { status: 409 });
      return NextResponse.json({ ok: true, status: aprovada.status });
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
      // Conta a receber (ou as parcelas dela) passa a "A receber" quando a NF é emitida
      await liberarCobrancasDaMedicao(id);
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
      // Cobrança em perda: o pagamento entra pelo "Reverter perda" (a recuperação), não marcando a fatura paga.
      // Renegociada: o pagamento entra pelas cobranças da renegociação (quitada ela, a fatura fica PAGA)
      const travadas = await prisma.contaReceber.findMany({
        where: { ...cobrancasDaMedicao(id), excluidaEm: null, status: { in: ["PERDA", "RENEGOCIADO"] } },
        select: { numero: true, status: true, renegociadaEm: { select: { numero: true } } }, orderBy: { criadoEm: "asc" },
      });
      const emPerda = travadas.filter((c) => c.status === "PERDA");
      if (emPerda.length) {
        return NextResponse.json({ erro: `${emPerda.map((c) => c.numero).join(", ")} está em perda: registre o que o cliente pagou em “Reverter perda”, no Contas a Receber.` }, { status: 409 });
      }
      if (travadas.length) {
        const r = travadas[0];
        return NextResponse.json({ erro: `${travadas.map((c) => c.numero).join(", ")} foi renegociada: informe o recebimento na renegociação${r.renegociadaEm ? ` (${r.renegociadaEm.numero})` : ""}. Quitada ela, a fatura fica paga.` }, { status: 409 });
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
      // Cada cobrança em aberto (conta ou parcela) recebe o que falta, pelo caminho único da baixa
      const abertas = await prisma.contaReceber.findMany({
        where: { ...cobrancasDaMedicao(id), excluidaEm: null, status: { notIn: ["RECEBIDO", "CANCELADO", "PERDA", "RENEGOCIADO"] } },
        select: { id: true }, orderBy: { criadoEm: "asc" },
      });
      for (const c of abertas) {
        await prisma.$transaction((tx) => registrarRecebimento(tx, {
          empresaId, contaId: c.id, data: dataPg, formaPagamento: a.formaPagamento || null,
          origem: "MEDICAO", usuarioId: session.user!.id,
        }), { timeout: 20_000 });
      }
      return NextResponse.json({ ok: true, status: "PAGO" });
    }

    case "CANCELAR": {
      // O dinheiro já se mexeu numa parcela (ou parte da conta entrou): resolver no Contas a Receber antes
      const travam = await cobrancasQueTravamMedicao(id);
      if (travam.length) {
        return NextResponse.json({ erro: `Há recebimento ou boleto emitido em ${travam.map((t) => t.numero).join(", ")}. Resolva no Contas a Receber antes de cancelar.` }, { status: 409 });
      }
      await prisma.medicao.update({ where: { id }, data: { status: "CANCELADA" } });
      await desfazerContasDaMedicao({ id, numero: medicao.numero, empresaId }, session.user!.id);
      return NextResponse.json({ ok: true, status: "CANCELADA" });
    }

    default:
      return NextResponse.json({ erro: "Ação desconhecida" }, { status: 400 });
  }
}
