import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { proximoNumeroOs } from "@/lib/os-server";
import { mesclarQrConfig } from "@/lib/qr-config";
import { getPortalSession } from "@/lib/auth-portal";
import { conferirBloqueio, ipDaRequisicao, registrarTentativa } from "@/lib/acesso/limite";
import { validarDataUrl, type ArquivoValidado } from "@/lib/anexos-server";
import { TIPOS_IMAGEM, MAX_FOTOS_CHAMADO } from "@/lib/anexos";
import { z } from "zod";

type Params = { params: Promise<{ token: string }> };

const chamadoSchema = z.object({
  tipo: z.enum(["CHAMADO", "ORCAMENTO"]).default("CHAMADO"),
  nome: z.string().min(2, "Informe seu nome").max(120),
  email: z.string().email("E-mail inválido").max(160).optional().or(z.literal("")),
  telefone: z.string().max(20).optional().or(z.literal("")),
  descricao: z.string().min(5, "Descreva o problema (mín. 5 caracteres)").max(2000),
  // Fotos no mesmo formato do chamado do portal (C2): data URL já reduzida no navegador
  fotos: z.array(z.object({
    nome: z.string(),
    tipo: z.string(),
    tamanho: z.number(),
    conteudo: z.string(),
  })).max(MAX_FOTOS_CHAMADO, `Envie no máximo ${MAX_FOTOS_CHAMADO} fotos`).default([]),
});

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;

  // Rota pública: limite por IP para não encherem a fila de OS
  const alvos = { ip: ipDaRequisicao(req.headers) };
  const bloqueio = await conferirBloqueio("CHAMADO_PUBLICO", alvos);
  if (bloqueio.bloqueado) {
    return NextResponse.json({ erro: `Muitas solicitações. Tente de novo em ${bloqueio.minutos} min.` }, { status: 429 });
  }
  await registrarTentativa("CHAMADO_PUBLICO", alvos);

  const qrcode = await prisma.qrcode.findUnique({
    where: { tokenPublico: token },
    include: { equipamento: { select: { id: true, empresaId: true, unidadeId: true, unidade: { select: { clienteId: true } } } } },
  });
  if (!qrcode || !qrcode.equipamento || !qrcode.ativo) {
    return NextResponse.json({ erro: "QR Code inválido ou não vinculado a um equipamento." }, { status: 404 });
  }
  const equip = qrcode.equipamento;
  const empresaId = equip.empresaId;

  // Respeita as configurações de acesso público
  const cfg = mesclarQrConfig(
    (await prisma.configuracao.findUnique({ where: { empresaId }, select: { qrConfig: true } }))?.qrConfig,
  );
  if (!cfg.paginaPublicaAtiva) return NextResponse.json({ erro: "Página pública desativada." }, { status: 403 });

  const parsed = chamadoSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // "Somente logado": vale o contato do portal DA MESMA EMPRESA e DO MESMO CLIENTE do equipamento
  const sessao = await getPortalSession();
  const logado = !!sessao?.user
    && sessao.user.empresaId === empresaId
    && sessao.user.clienteId === equip.unidade!.clienteId;
  let contatoId = logado ? sessao!.user.id : null;
  // Y17: anônimo que informa o e-mail de um contato DO MESMO CLIENTE fica identificado para a
  // triagem (só origem/registro — não dá acesso a nada; quem decide o atendimento é a equipe).
  if (!contatoId && d.email) {
    const conhecido = await prisma.contatoCliente.findFirst({
      where: { empresaId, clienteId: equip.unidade!.clienteId!, ativo: true, email: { equals: d.email, mode: "insensitive" } },
      select: { id: true },
    });
    contatoId = conhecido?.id ?? null;
  }

  // Gating por tipo, conforme configurações
  if (d.tipo === "ORCAMENTO") {
    if (!cfg.botaoOrcamento || (cfg.orcamentoSomenteLogado && !logado)) {
      return NextResponse.json({ erro: "Solicitação de orçamento pública não está disponível." }, { status: 403 });
    }
  } else if (!cfg.botaoChamado || (cfg.chamadoSomenteLogado && !logado)) {
    return NextResponse.json({ erro: "Abertura de chamado pública não está disponível." }, { status: 403 });
  }

  // Fotos (C2): só imagens, conferidas pelo CONTEÚDO — igual ao chamado do portal logado
  const fotos: ArquivoValidado[] = [];
  for (const f of d.fotos) {
    const v = validarDataUrl(f.conteudo, f.nome, {
      tipos: TIPOS_IMAGEM,
      mensagemTipo: "Envie apenas fotos (JPG, PNG ou WEBP).",
    });
    if (!v.ok) return NextResponse.json({ erro: `Foto "${f.nome}": ${v.erro}` }, { status: 400 });
    fotos.push(v.arquivo);
  }

  const gestor =
    (await prisma.usuario.findFirst({ where: { empresaId, ativo: true, role: { in: ["ADMIN", "GERENTE"] } }, select: { id: true }, orderBy: { criadoEm: "asc" } })) ??
    (await prisma.usuario.findFirst({ where: { empresaId, ativo: true }, select: { id: true } }));
  if (!gestor) return NextResponse.json({ erro: "Empresa sem usuário responsável." }, { status: 400 });

  const ano = new Date().getFullYear();
  const numero = await proximoNumeroOs(empresaId, ano);
  const totalChamados = await prisma.ordemServico.count({ where: { empresaId, origem: "PORTAL_CLIENTE" } });
  const chamadoNumero = `CHM-${ano}-${String(totalChamados + 1).padStart(4, "0")}`;

  const contato = [`Solicitante: ${d.nome}`, d.email ? `E-mail: ${d.email}` : null, d.telefone ? `Telefone: ${d.telefone}` : null]
    .filter(Boolean)
    .join(" · ");
  const marcador = d.tipo === "ORCAMENTO" ? "[Orçamento via QR Code]" : "[Chamado via QR Code]";
  const descricao = `${d.tipo === "ORCAMENTO" ? "Solicitação de orçamento. " : ""}${d.descricao}\n\n${marcador} ${contato}`;

  const os = await prisma.ordemServico.create({
    data: {
      empresaId,
      numero,
      chamadoNumero,
      clienteId: equip.unidade!.clienteId,
      unidadeId: equip.unidadeId,
      equipamentoId: equip.id,
      contatoOrigemId: contatoId,
      criadoPorId: gestor.id,
      status: "AGUARDANDO_ATENDIMENTO",
      origem: "PORTAL_CLIENTE",
      prioridade: "NORMAL",
      descricao,
      anexos: fotos.length > 0 ? { create: fotos } : undefined,
    },
  });

  await prisma.osHistorico.create({
    data: { ordemServicoId: os.id, usuarioId: gestor.id, acao: d.tipo === "ORCAMENTO" ? "Orçamento solicitado via QR Code" : "Chamado aberto via QR Code", detalhes: `${chamadoNumero} — ${d.nome}` },
  });

  return NextResponse.json({ chamadoNumero }, { status: 201 });
}
