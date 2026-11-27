import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { temModulo } from "@/lib/modulos/servidor";
import { MSG_MODULO_DESLIGADO } from "@/lib/modulos/catalogo";
import { apresentarEquipamento, SELECT_EQUIP_EXECUCAO } from "@/lib/execucao/dados";
import { carregarHistoricoEquipamento } from "@/lib/equipamento-historico";
import { carregarConfigApp } from "@/lib/tecnico/config-app-server";
import { escopoDaSessao, filtroEscopo } from "@/lib/tecnico/escopo";
import { inicioHojeBR } from "@/lib/fuso";
import { lerValorQr, MSG_QR_NAO_RECONHECIDO, paraFicha, type FichaEquipamento } from "@/lib/tecnico/qr-campo";

/**
 * A FICHA do equipamento pelo QR lido no app (Meu dia), para o equipamento que não está em nenhuma OS do
 * técnico hoje. Só lê: nada é criado. Respeita a permissão (Equipamentos › Visualizar), o módulo QR Codes,
 * a empresa da sessão e "Exibir dados do cliente". Nunca manda valores (ver `paraFicha`).
 * Também diz se o equipamento está numa atividade DELE hoje (ex.: vinculado vindo de outra unidade do
 * cliente, que o aparelho não reconhece sozinho) — aí o app abre a OS em vez da ficha.
 */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("equipamentos", "visualizar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user.empresaId;
  if (!(await temModulo(empresaId, "qrcodes"))) return NextResponse.json({ erro: MSG_MODULO_DESLIGADO("qrcodes") }, { status: 403 });
  const valor = (req.nextUrl.searchParams.get("valor") ?? "").slice(0, 500);
  const { token, codigo } = lerValorQr(valor);
  if (!token) return NextResponse.json({ erro: MSG_QR_NAO_RECONHECIDO }, { status: 400 });
  const qr = await prisma.qrcode.findFirst({ where: { empresaId, ativo: true, OR: [{ tokenPublico: token }, { codigo }] }, select: { equipamentoId: true } });
  if (!qr?.equipamentoId) return NextResponse.json({ erro: MSG_QR_NAO_RECONHECIDO }, { status: 404 });
  const eq = await prisma.equipamento.findFirst({
    where: { id: qr.equipamentoId, empresaId },
    select: { ...SELECT_EQUIP_EXECUCAO, unidade: { select: { nome: true, clienteId: true, cliente: { select: { nome: true, nomeFantasia: true } } } } },
  });
  if (!eq) return NextResponse.json({ erro: MSG_QR_NAO_RECONHECIDO }, { status: 404 });

  // Uma atividade DELE, aberta, de hoje (ou começada antes e não concluída), com este equipamento vinculado
  const inicio = inicioHojeBR();
  const fim = inicioHojeBR(new Date(), 1);
  const hoje = await prisma.atividadeOs.findFirst({
    where: {
      // Escopo e janela de hoje em AND: os dois usam OR (um não pode sobrescrever o outro)
      empresaId, equipamentos: { some: { equipamentoId: eq.id } },
      AND: [
        filtroEscopo(escopoDaSessao(guard.session)),
        { OR: [{ status: { in: ["AGENDADA", "EM_ANDAMENTO"] }, dataAgendada: { gte: inicio, lt: fim } }, { status: "EM_ANDAMENTO", dataAgendada: { lt: inicio } }] },
      ],
    },
    orderBy: [{ status: "asc" }, { dataAgendada: "asc" }],
    select: { id: true },
  });

  const [config, eventos] = await Promise.all([carregarConfigApp(empresaId), carregarHistoricoEquipamento(empresaId, eq.id)]);
  const base = apresentarEquipamento(eq);
  const cli = eq.unidade?.cliente;
  const ficha: FichaEquipamento = {
    equipamento: {
      id: base.id, titulo: base.titulo, fabricante: base.fabricante, tag: base.tag, numeroSerie: base.numeroSerie, local: base.local, ativo: base.ativo,
      tipo: base.tipo?.nome ?? null, garantiaAte: base.garantiaAte,
      // "Exibir dados do cliente" desligado: nem o cliente nem a unidade saem do servidor
      unidade: config.exibirDadosCliente ? base.unidade : null,
      cliente: config.exibirDadosCliente ? ((cli?.nomeFantasia || cli?.nome) ?? null) : null,
    },
    atividadeHoje: hoje ? { atividadeId: hoje.id, vinculado: true } : null,
    historico: paraFicha(eventos),
  };
  return NextResponse.json(ficha, { headers: { "Cache-Control": "private, no-store" } });
}
