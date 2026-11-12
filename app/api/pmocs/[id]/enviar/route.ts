import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { dataBR } from "@/lib/pmoc";
import { ACAO_ENVIO, bloqueioEnvio, caminhoPublicoDocumento, envioSchema, mensagemEnvio } from "@/lib/pmoc-avisos";
import { destinoDoCliente, registrarHistorico, tokenDoPlano } from "@/lib/pmoc-documento-server";
import { emailConfigAtiva, enviarEmail } from "@/lib/email";
import { whatsappLink } from "@/lib/utils";

/**
 * Envia o documento do plano ao cliente e registra no histórico do plano. O que vai é o LINK público
 * do documento (não há API de WhatsApp: o padrão do sistema é o link wa.me, que abre a conversa com
 * a mensagem pronta):
 *  - WHATSAPP: link wa.me para o WhatsApp do contato principal do cliente (ou o celular do cadastro);
 *  - EMAIL: pelo e-mail da empresa (Resend) ao contato principal; sem o Resend configurado, devolve o
 *    mailto para o programa de e-mail de quem está enviando;
 *  - LINK: só o link, para copiar.
 * Exige "PMOC › Visualizar" (quem vê o plano pode entregá-lo ao cliente) e o plano publicado e ativo.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("pmoc", "visualizar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;
  const corpo = envioSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return NextResponse.json({ erro: "Canal de envio inválido." }, { status: 400 });
  const { canal } = corpo.data;

  const p = await prisma.pmoc.findFirst({
    where: { id, empresaId },
    select: {
      id: true, nome: true, status: true, ativo: true, dataInicio: true, dataExpiracao: true, clienteId: true,
      cliente: { select: { nome: true, nomeFantasia: true } },
    },
  });
  if (!p) return NextResponse.json({ erro: "PMOC não encontrado" }, { status: 404 });
  const bloqueio = bloqueioEnvio(p);
  if (bloqueio) return NextResponse.json({ erro: bloqueio }, { status: 409 });

  const destino = await destinoDoCliente(p.clienteId, empresaId);
  const telefone = destino.whatsapp ?? "", email = destino.email ?? "";
  const empresaNome = session.user!.empresaNome;
  const vigencia = `${dataBR(p.dataInicio)} a ${dataBR(p.dataExpiracao)}`;

  const publicUrl = `${new URL(req.url).origin}${caminhoPublicoDocumento(await tokenDoPlano(id))}`;
  const mensagem = mensagemEnvio({ contato: destino.contato, nomePmoc: p.nome, empresa: empresaNome, url: publicUrl, vigencia });
  const whatsappUrl = telefone ? whatsappLink(telefone, mensagem) : `https://wa.me/?text=${encodeURIComponent(mensagem)}`;
  const assunto = `${/pmoc/i.test(p.nome) ? p.nome : `PMOC ${p.nome}`} — ${empresaNome}`;
  const mailtoUrl = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(mensagem)}`;
  const historico = (detalhes: string | null) => registrarHistorico(prisma, { pmocId: id, usuarioId: session.user!.id, acao: ACAO_ENVIO[canal], detalhes });

  let emailEnviado = false, erroEmail: string | null = null;
  if (canal === "WHATSAPP") {
    await historico(telefone ? [destino.contato, telefone].filter(Boolean).join(" · ") : "Sem WhatsApp no cadastro do cliente: o contato é escolhido na conversa.");
  } else if (canal === "LINK") {
    await historico(null);
  } else if (await emailConfigAtiva(empresaId)) {
    if (!email) return NextResponse.json({ erro: "O cliente não tem e-mail no cadastro. Cadastre o e-mail do contato principal ou envie por WhatsApp." }, { status: 422 });
    const r = await enviarEmail(empresaId, {
      tipo: "PMOC_DOCUMENTO", para: email, referenciaId: id, referenciaTipo: "Pmoc",
      variaveis: { cliente_nome: p.cliente.nomeFantasia ?? p.cliente.nome, pmoc_nome: p.nome, vigencia, link_documento: publicUrl },
    }).catch(() => ({ ok: false, erro: "Erro no envio." }));
    emailEnviado = r.ok;
    if (r.ok) await historico(email);
    else erroEmail = r.erro ?? "Não foi possível enviar o e-mail.";
  } else {
    // Sem o e-mail da empresa configurado: abre o programa de e-mail de quem envia, com tudo preenchido
    await historico(email ? `pelo e-mail do usuário, para ${email}` : "pelo e-mail do usuário");
  }

  return NextResponse.json({ canal, publicUrl, whatsappUrl, mailtoUrl, emailEnviado, erroEmail, para: canal === "EMAIL" ? email || null : canal === "WHATSAPP" ? telefone || null : null });
}
