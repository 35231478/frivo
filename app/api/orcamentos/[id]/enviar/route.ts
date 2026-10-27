import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { buildPublicUrl, buildMailtoLink } from "@/lib/orcamento-helpers";
import { whatsappLink } from "@/lib/utils";
import { emailConfigAtiva, enviarOrcamento } from "@/lib/email";
import { diaCivilPassou } from "@/lib/fuso";
import { numeroFormalOrcamento } from "@/lib/orcamentos/proposta";
import { registrarEvento } from "@/lib/orcamentos/ciclo-server";

const corpoSchema = z.object({ canal: z.enum(["EMAIL", "WHATSAPP", "LINK"]).optional() }).nullable();

/**
 * Envia a proposta ao cliente e registra na linha do tempo (rastreável):
 *  - EMAIL: pelo e-mail da empresa (Resend) ao contato A/C (e os de comunicação em cópia); sem o
 *    Resend configurado, devolve o mailto para o e-mail do usuário;
 *  - WHATSAPP: link wa.me para o WhatsApp do contato A/C (ou do cliente);
 *  - LINK: só o link (copiar).
 * Marca ENVIADO (a 1ª data de envio fica). "Visualizado" vem quando o cliente abre o link.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("orcamentos", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const empresaNome = session.user!.empresaNome;
  const { id } = await params;
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return NextResponse.json({ erro: "Canal de envio inválido." }, { status: 400 });
  const canal = corpo.data?.canal;

  const orcamento = await prisma.orcamento.findFirst({
    where: { id, empresaId },
    include: {
      cliente: { select: { email: true, celular: true, telefone: true, nome: true } },
      contatoCliente: { select: { nome: true, email: true, whatsapp: true, telefone: true, ativo: true } },
    },
  });
  if (!orcamento) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });
  if (orcamento.status === "APROVADO" || orcamento.status === "CANCELADO" || orcamento.status === "CONVERTIDA") {
    return NextResponse.json(
      { erro: "Orçamento já encerrado, não é possível reenviar" },
      { status: 400 }
    );
  }
  // Mandar um link que o cliente não consegue mais aprovar não serve: ajuste a validade antes
  if (diaCivilPassou(orcamento.validadeEm)) {
    return NextResponse.json({ erro: "A validade deste orçamento já venceu. Volte para rascunho, ajuste a validade e envie de novo." }, { status: 400 });
  }

  const atualizado = await prisma.orcamento.update({
    where: { id },
    data: {
      status: "ENVIADO",
      enviadoEm: orcamento.enviadoEm ?? new Date(),
    },
  });

  const origem = new URL(req.url).origin;
  const publicUrl = buildPublicUrl(orcamento.tokenPublico, origem);
  const numero = numeroFormalOrcamento(orcamento.codigo);
  const contato = orcamento.contatoCliente?.ativo === false ? null : orcamento.contatoCliente;
  const emailDest = contato?.email || orcamento.cliente.email || "";
  const mailtoUrl = emailDest ? buildMailtoLink(emailDest, empresaNome, `Nº ${numero}`, publicUrl) : null;
  const telefone = contato?.whatsapp || contato?.telefone || orcamento.cliente.celular || orcamento.cliente.telefone || "";
  const saudacao = contato?.nome ? `Olá, ${contato.nome.split(" ")[0]}!` : "Olá!";
  const msgWhats =
    `${saudacao} Segue o orçamento Nº ${numero} de ${empresaNome}:\n${publicUrl}\n\n` +
    `Você pode aprová-lo (ou recusar) digitalmente pelo link acima.`;
  const whatsappUrl = telefone ? whatsappLink(telefone, msgWhats) : null;
  const evento = (tipo: string, detalhe: string | null) =>
    registrarEvento({ empresaId, orcamentoId: id, tipo, detalhe, usuarioId: session.user!.id });

  let emailEnviado = false;
  let para: string | null = null;
  let erroEmail: string | null = null;

  if (canal === "EMAIL") {
    if (await emailConfigAtiva(empresaId)) {
      const r = await enviarOrcamento(id).catch(() => ({ ok: false, erro: "Erro no envio." } as { ok: boolean; erro?: string; para?: string; cc?: string[] }));
      emailEnviado = r.ok;
      para = r.para ?? null;
      if (r.ok) await evento("ENVIADO_EMAIL", [r.para, r.cc?.length ? `cópia: ${r.cc.join(", ")}` : null].filter(Boolean).join(" · "));
      else erroEmail = r.erro ?? "Não foi possível enviar o e-mail.";
    } else if (mailtoUrl) {
      await evento("ENVIADO", `pelo e-mail do usuário, para ${emailDest}`);
    }
  } else if (canal === "WHATSAPP") {
    if (whatsappUrl) await evento("ENVIADO_WHATSAPP", contato?.nome ? `${contato.nome} · ${telefone}` : telefone);
  } else if (canal === "LINK") {
    await evento("LINK_COPIADO", null);
  } else {
    // Sem canal (chamadas antigas): envio automático por e-mail, se a empresa ligou essa opção
    const cfgEmail = await prisma.emailConfig.findUnique({ where: { empresaId } });
    if (cfgEmail?.ativo && cfgEmail.notifOrcamentoEnviado) {
      const r = await enviarOrcamento(id).catch(() => ({ ok: false } as { ok: boolean; para?: string }));
      emailEnviado = r.ok;
      if (r.ok) await evento("ENVIADO_EMAIL", r.para ?? null);
    }
  }

  return NextResponse.json({ orcamento: atualizado, publicUrl, mailtoUrl, whatsappUrl, emailEnviado, para, erroEmail });
}
