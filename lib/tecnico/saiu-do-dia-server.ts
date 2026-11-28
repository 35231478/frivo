/**
 * App pronto pra janeiro 2 — o lado do banco de dois avisos do Meu dia (regras em lib/tecnico/saiu-do-dia):
 *  - D9 `saidasDoDia`: dos ids que o aparelho tinha hoje, os que saíram do dia e por quê (só da empresa; só o número
 *    da OS e o motivo — nada do cliente). O que o próprio técnico mudou por último não vira aviso;
 *  - D11 `registrarNoticia` / `noticiaDoOutro`: quantas gravações cada aparelho do usuário ainda tem na fila (a última
 *    notícia), guardado nas preferências do usuário (sem tabela nova).
 */
import { prisma } from "@/lib/prisma";
import { chaveDiaBR, inicioHojeBR } from "@/lib/fuso";
import {
  CHAVE_FILA_APARELHOS, comNoticia, motivoDaSaida, pendenciaNoOutro, type FilaPorAparelho, type SaidaDoDia,
} from "@/lib/tecnico/saiu-do-dia";

export async function saidasDoDia(
  p: { empresaId: string; tecnicoId: string; usuarioId: string; ids: string[]; noMeuDia: Set<string>; agora?: Date },
): Promise<SaidaDoDia[]> {
  const fora = p.ids.filter((id) => !p.noMeuDia.has(id));
  if (!fora.length) return [];
  const agora = p.agora ?? new Date();
  const hoje = chaveDiaBR(agora);
  const atividades = await prisma.atividadeOs.findMany({
    where: { id: { in: fora }, empresaId: p.empresaId },
    select: {
      id: true, status: true, tecnicoId: true, dataAgendada: true, ordemServicoId: true,
      tecnicosEquipe: { where: { tecnicoId: p.tecnicoId }, select: { tecnicoId: true } },
      ordemServico: { select: { numero: true, chamadoNumero: true, status: true } },
    },
  });
  if (!atividades.length) return [];
  // A última mudança de hoje em cada OS: se foi do próprio técnico (ex.: "não concluída"), não é aviso do escritório
  const historico = await prisma.osHistorico.findMany({
    where: { ordemServicoId: { in: [...new Set(atividades.map((a) => a.ordemServicoId))] }, criadoEm: { gte: inicioHojeBR(agora) } },
    orderBy: { criadoEm: "desc" }, select: { ordemServicoId: true, usuarioId: true },
  });
  const ultimo = new Map<string, string>();
  for (const h of historico) if (!ultimo.has(h.ordemServicoId)) ultimo.set(h.ordemServicoId, h.usuarioId);
  const saidas: SaidaDoDia[] = [];
  for (const a of atividades) {
    const diaAgendado = a.dataAgendada ? chaveDiaBR(a.dataAgendada) : null;
    const motivo = motivoDaSaida({
      status: a.status, osStatus: a.ordemServico.status, noMeuDia: false, doTecnico: a.tecnicoId === p.tecnicoId || a.tecnicosEquipe.length > 0,
      diaAgendado, hoje, mudouPorMim: ultimo.get(a.ordemServicoId) === p.usuarioId,
    });
    if (motivo) saidas.push({ atividadeId: a.id, osNumero: a.ordemServico.chamadoNumero ?? a.ordemServico.numero, motivo, novaData: motivo === "reagendada" ? diaAgendado : null });
  }
  return saidas;
}

/** D11 — guarda a notícia do aparelho (quantas gravações ainda tem na fila) */
export async function registrarNoticia(usuarioId: string, n: { aparelho: string; pendentes: number }, agora: Date = new Date()): Promise<void> {
  const atual = await prisma.preferenciaUsuario.findUnique({ where: { usuarioId_chave: { usuarioId, chave: CHAVE_FILA_APARELHOS } }, select: { valor: true } });
  const anterior = (atual?.valor ?? null) as FilaPorAparelho | null;
  // Nada mudou e a notícia ainda é fresca (menos de 1 h): não grava de novo a cada Meu dia
  const igual = anterior?.[n.aparelho];
  if (igual && igual.n === n.pendentes && agora.getTime() - Date.parse(igual.em) < 3_600_000) return;
  const valor = comNoticia(anterior, n.aparelho, n.pendentes, agora);
  await prisma.preferenciaUsuario.upsert({
    where: { usuarioId_chave: { usuarioId, chave: CHAVE_FILA_APARELHOS } },
    create: { usuarioId, chave: CHAVE_FILA_APARELHOS, valor }, update: { valor },
  });
}

/** D11 — o outro aparelho deu notícia de gravação sem enviar? (e a empresa usa "um aparelho só") */
export async function noticiaDoOutro(empresaId: string, usuarioId: string, aparelho: string | null, agora: Date = new Date()): Promise<{ pendentes: number; em: string; umAparelho: boolean } | null> {
  if (!aparelho) return null;
  const [pref, cfg] = await Promise.all([
    prisma.preferenciaUsuario.findUnique({ where: { usuarioId_chave: { usuarioId, chave: CHAVE_FILA_APARELHOS } }, select: { valor: true } }),
    prisma.configuracao.findUnique({ where: { empresaId }, select: { appUmDispositivo: true } }),
  ]);
  const o = pendenciaNoOutro((pref?.valor ?? null) as FilaPorAparelho | null, aparelho, agora);
  return o ? { ...o, umAparelho: !!cfg?.appUmDispositivo } : null;
}
