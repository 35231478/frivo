import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enviarLembreteOrcamento } from "@/lib/email";

/**
 * Processa os lembretes de orçamento (deve ser chamado 1x/dia por um cron).
 * Autoriza por: header Authorization: Bearer <CRON_SECRET>, ?secret=<CRON_SECRET>,
 * ou sessão de admin autenticada.
 */
async function autorizado(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth1 = req.headers.get("authorization");
    if (auth1 === `Bearer ${secret}`) return true;
    if (req.nextUrl.searchParams.get("secret") === secret) return true;
  }
  const session = await auth();
  return !!session && (session.user.role === "ADMIN" || session.user.role === "SUPER_ADMIN" || session.user.role === "GERENTE");
}

async function processar(): Promise<{ enviados: number; detalhes: Record<string, number> }> {
  const agora = new Date();
  const det = { nao_respondido: 0, vencendo: 0, vencido: 0, aprovado_sem_os: 0 };

  const configs = await prisma.emailConfig.findMany({ where: { ativo: true } });

  for (const cfg of configs) {
    const empresaId = cfg.empresaId;
    const limite = cfg.maxLembretesOrcamento;
    const throttleMs = 24 * 60 * 60 * 1000; // no máx. 1 lembrete por dia por orçamento

    const podeEnviar = (o: { totalLembretes: number; lembretesAtivos: boolean; visualizadoEm: Date | null; lembreteEnviadoEm: Date | null }) => {
      if (!o.lembretesAtivos) return false;
      if (o.totalLembretes >= limite) return false;
      if (cfg.pararSeVisualizado && o.visualizadoEm) return false;
      if (o.lembreteEnviadoEm && agora.getTime() - new Date(o.lembreteEnviadoEm).getTime() < throttleMs) return false;
      return true;
    };
    const registrar = (id: string, total: number) =>
      prisma.orcamento.update({ where: { id }, data: { lembreteEnviadoEm: agora, totalLembretes: total + 1 } });

    // Orçamentos ENVIADOS (não respondidos / vencendo / vencido)
    const enviados = await prisma.orcamento.findMany({
      where: { empresaId, status: "ENVIADO" },
      select: { id: true, enviadoEm: true, validadeEm: true, totalLembretes: true, lembretesAtivos: true, visualizadoEm: true, lembreteEnviadoEm: true },
    });
    for (const o of enviados) {
      if (!podeEnviar(o)) continue;
      const diasVal = o.validadeEm ? Math.round((new Date(o.validadeEm).getTime() - agora.getTime()) / 86400000) : null;
      const diasEnvio = o.enviadoEm ? Math.round((agora.getTime() - new Date(o.enviadoEm).getTime()) / 86400000) : 0;

      let tipo: "nao_respondido" | "vencendo" | "vencido" | null = null;
      if (cfg.lembreteOrcVencido && diasVal !== null && diasVal < 0) tipo = "vencido";
      else if (cfg.lembreteOrcVencendo && diasVal !== null && diasVal >= 0 && diasVal <= cfg.diasLembreteOrcamentoVencendo) tipo = "vencendo";
      else if (cfg.lembreteOrcNaoRespondido && diasEnvio >= cfg.diasLembreteOrcamento) tipo = "nao_respondido";
      if (!tipo) continue;

      const r = await enviarLembreteOrcamento(o.id, tipo);
      if (r.ok) { det[tipo]++; await registrar(o.id, o.totalLembretes); }
    }

    // Orçamentos APROVADOS sem OS vinculada
    if (cfg.lembreteOrcAprovadoSemOs) {
      const aprovados = await prisma.orcamento.findMany({
        where: { empresaId, status: "APROVADO" },
        select: { id: true, assinadoEm: true, atualizadoEm: true, totalLembretes: true, lembretesAtivos: true, visualizadoEm: true, lembreteEnviadoEm: true, _count: { select: { ordensServico: true } } },
      });
      for (const o of aprovados) {
        if (o._count.ordensServico > 0) continue;
        if (!podeEnviar(o)) continue;
        const base = o.assinadoEm ?? o.atualizadoEm;
        const dias = Math.round((agora.getTime() - new Date(base).getTime()) / 86400000);
        if (dias < cfg.diasAposAprovacaoSemOs) continue;
        const r = await enviarLembreteOrcamento(o.id, "aprovado_sem_os");
        if (r.ok) { det.aprovado_sem_os++; await registrar(o.id, o.totalLembretes); }
      }
    }
  }

  const enviados = Object.values(det).reduce((a, b) => a + b, 0);
  return { enviados, detalhes: det };
}

export async function GET(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  return NextResponse.json(await processar());
}

export async function POST(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  return NextResponse.json(await processar());
}
