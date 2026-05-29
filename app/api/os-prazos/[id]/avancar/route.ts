import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aplicarVariaveis, whatsappLink } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;
  const usuarioNome = session.user!.name ?? "Sistema";

  const prazo = await prisma.osPrazo.findFirst({
    where: { id, ordemServico: { empresaId } },
    include: {
      etapas: { orderBy: { ordem: "asc" } },
      ordemServico: {
        select: {
          id: true, numero: true,
          cliente: { select: { nome: true, nomeFantasia: true, celular: true } },
          responsavel: { select: { nome: true, telefone: true } },
        },
      },
    },
  });
  if (!prazo) return NextResponse.json({ erro: "Prazo não encontrado" }, { status: 404 });
  if (prazo.status !== "ATIVO" && prazo.status !== "ATRASADO") {
    return NextResponse.json({ erro: "Prazo não está ativo" }, { status: 400 });
  }

  const atual = prazo.etapas.find((e) => e.ordem === prazo.etapaAtual);
  if (!atual) return NextResponse.json({ erro: "Etapa atual não encontrada" }, { status: 400 });

  // Conclui a etapa atual
  await prisma.osPrazoEtapa.update({
    where: { id: atual.id },
    data: { status: "CONCLUIDA", concluidaEm: new Date(), concluidaPor: usuarioNome },
  });

  const proxima = prazo.etapas.find((e) => e.ordem === prazo.etapaAtual + 1);

  let whatsappUrl: string | null = null;

  if (proxima) {
    await prisma.osPrazoEtapa.update({ where: { id: proxima.id }, data: { status: "EM_ANDAMENTO" } });
    await prisma.osPrazo.update({ where: { id }, data: { etapaAtual: prazo.etapaAtual + 1, status: "ATIVO" } });

    // Notifica responsável da próxima etapa
    if (proxima.canal === "WHATSAPP") {
      const origin = req.nextUrl.origin;
      const cliente = prazo.ordemServico.cliente;
      const vars: Record<string, string> = {
        os_numero: prazo.ordemServico.numero,
        cliente_nome: cliente.nomeFantasia ?? cliente.nome,
        produto_nome: "",
        prazo_etapa: proxima.nome,
        link: `${origin}/ordens/${prazo.ordemServico.id}`,
      };
      const texto = proxima.mensagem
        ? aplicarVariaveis(proxima.mensagem, vars)
        : `⏰ Nova etapa "${proxima.nome}" iniciada na OS ${prazo.ordemServico.numero}. ${vars.link}`;

      const telefone =
        proxima.responsavel === "CLIENTE" ? cliente.celular :
        proxima.responsavel === "TECNICO" ? prazo.ordemServico.responsavel?.telefone ?? null :
        (await prisma.usuario.findFirst({
          where: { empresaId, ativo: true, role: { in: ["GERENTE", "ADMIN"] }, telefone: { not: null } },
          select: { telefone: true },
        }))?.telefone ?? null;

      if (telefone) whatsappUrl = whatsappLink(telefone, texto);
      await prisma.osPrazoEtapa.update({ where: { id: proxima.id }, data: { notificacaoEnviada: true } });
    }
  } else {
    // Era a última etapa → conclui o prazo
    await prisma.osPrazo.update({ where: { id }, data: { status: "CONCLUIDO" } });
  }

  return NextResponse.json({ ok: true, concluido: !proxima, whatsappUrl });
}
