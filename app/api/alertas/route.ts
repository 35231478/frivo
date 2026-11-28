import { NextResponse, after } from "next/server";
import { auth } from "@/lib/auth";
import { escopoDoSino } from "@/lib/alertas/sino";
import { contarSino } from "@/lib/alertas/sino-server";
import { reconciliarEmpresa } from "@/lib/nfse/webhook-server";
import { registrarAvisosPmoc } from "@/lib/pmoc-avisos-server";
import { escopoDaSessao, filtroEscopo } from "@/lib/tecnico/escopo";
import { conferirEsquecidasPeloSino } from "@/lib/push/eventos";
import { pushLigado } from "@/lib/push/config";
import { prisma } from "@/lib/prisma";
import { CHAVE_SINO_LIDOS, avisosLidos, lerLidos, numeroDoSino, totalDoSino } from "@/lib/alertas/lidos";
import { chaveHojeBR } from "@/lib/fuso";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { permissoes, role } = session.user!;

  // O sino só conta o que o usuário PODE ver (permissão) e o que é DELE (escopo do técnico): a regra pura
  // está em lib/alertas/sino › escopoDoSino. No modo técnico, nada da empresa inteira — só os aceites das OS
  // em que ele tem atividade e a NF dos pedidos que ele fez.
  const escopoTecnico = escopoDaSessao(session);
  const e = escopoDoSino({ permissoes, role, restrito: escopoTecnico.restrito });

  // NFS-e paradas sem aviso do PlugNotas: o sino (2 em 2 min) puxa a reconciliação da empresa
  // DEPOIS de responder (no máximo 1 rodada por minuto por empresa; não atrasa o sino)
  after(() => reconciliarEmpresa(empresaId).catch((erro) => console.error("[nfse] reconciliação", (erro as Error)?.name)));

  // PMOC: o aviso de vencimento é calculado pela data; aqui ele é REGISTRADO no histórico do plano,
  // uma vez por plano e data de expiração (idempotente), depois de responder
  if (e.pmoc) after(() => registrarAvisosPmoc(empresaId).catch((erro) => console.error("[pmoc] avisos", (erro as Error)?.name)));

  // PUSH: atividade esquecida em andamento com o app fechado — o sino (2 em 2 min) puxa a conferência da
  // empresa, no máximo 1 a cada 5 min e só com o push ligado; push_envios não deixa repetir o aviso
  if (pushLigado()) conferirEsquecidasPeloSino(empresaId);

  // A contagem é a mesma do painel de pendências (lib/alertas/sino-server); as contas do dia ficam só no painel
  // O que a pessoa já leu hoje (lib/alertas/lidos) vem junto, em paralelo: o número do sino é só o não lido
  const usuarioId = session.user!.id;
  const [{ foraDoNumero: _soNoPainel, ...sino }, guardado] = await Promise.all([
    contarSino({ empresaId, usuarioId, escopo: e, filtroTecnico: filtroEscopo(escopoTecnico), quem: session.user }),
    prisma.preferenciaUsuario.findUnique({ where: { usuarioId_chave: { usuarioId, chave: CHAVE_SINO_LIDOS } }, select: { valor: true } }),
  ]);
  const hoje = chaveHojeBR();
  const lidos = lerLidos(guardado?.valor, hoje);
  return NextResponse.json({ ...sino, total: numeroDoSino(sino, lidos, hoje), totalGeral: totalDoSino(sino), lidos: avisosLidos(sino, lidos, hoje) });
}
