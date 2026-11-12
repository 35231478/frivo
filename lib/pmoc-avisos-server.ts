/**
 * PMOC — Etapa 3 (servidor): os avisos de vencimento.
 *
 * O aviso é calculado pela data (lib/pmoc-avisos), então o sino e o dashboard estão sempre certos
 * sem rotina agendada. A tabela "pmoc_avisos" guarda o que JÁ foi avisado: uma linha por (plano,
 * tipo, data de expiração). A chave única faz o registro acontecer UMA vez — é ela que impede duas
 * linhas no histórico para o mesmo aviso, mesmo com dois sinos consultando ao mesmo tempo — e
 * `vistoEm` tira o aviso do sino quando alguém dá ciência.
 */
import { prisma } from "@/lib/prisma";
import { dataISO, hojeISO } from "@/lib/pmoc";
import { ACAO_AVISO, avisoDoPlano, detalheAviso, textoAviso, type TipoAviso } from "@/lib/pmoc-avisos";
import { configPmoc, registrarHistorico } from "@/lib/pmoc-documento-server";

export interface AvisoAtivo {
  pmocId: string; nome: string; cliente: string; tipo: TipoAviso; dias: number;
  /** "AAAA-MM-DD" */
  dataExpiracao: string; texto: string;
  /** Já está registrado (no histórico do plano)? */
  registrado: boolean;
}

const paraData = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Planos ativos e publicados que estão vencendo ou expirados, MENOS os que já tiveram ciência */
export async function avisosAtivos(empresaId: string, agora: Date = new Date()): Promise<AvisoAtivo[]> {
  const { diasAviso } = await configPmoc(empresaId);
  const limite = paraData(hojeISO(agora));
  limite.setUTCDate(limite.getUTCDate() + diasAviso);
  const planos = await prisma.pmoc.findMany({
    where: { empresaId, ativo: true, status: "PUBLICADO", dataExpiracao: { lte: limite } },
    orderBy: [{ dataExpiracao: "asc" }, { nome: "asc" }],
    take: 500, // os que expiram antes primeiro; uma empresa não chega perto disso
    select: {
      id: true, nome: true, status: true, ativo: true, dataInicio: true, dataExpiracao: true,
      cliente: { select: { nome: true, nomeFantasia: true } },
      avisos: { select: { tipo: true, dataExpiracao: true, vistoEm: true } },
    },
  });
  const out: AvisoAtivo[] = [];
  for (const p of planos) {
    const a = avisoDoPlano(p, diasAviso, agora);
    if (!a) continue;
    const expira = dataISO(p.dataExpiracao)!;
    const gravado = p.avisos.find((x) => x.tipo === a.tipo && dataISO(x.dataExpiracao) === expira);
    if (gravado?.vistoEm) continue; // alguém já deu ciência deste aviso
    out.push({ pmocId: p.id, nome: p.nome, cliente: p.cliente.nomeFantasia ?? p.cliente.nome, tipo: a.tipo, dias: a.dias, dataExpiracao: expira, texto: textoAviso(a, expira), registrado: !!gravado });
  }
  return out;
}

export async function contarAvisosPmoc(empresaId: string, agora: Date = new Date()): Promise<{ pmocsVencendo: number; pmocsExpirados: number }> {
  const avisos = await avisosAtivos(empresaId, agora);
  return { pmocsVencendo: avisos.filter((a) => a.tipo === "VENCENDO").length, pmocsExpirados: avisos.filter((a) => a.tipo === "EXPIRADO").length };
}

/**
 * Registra, uma vez só, os avisos que ainda não estão no histórico. Devolve quantos registrou.
 * Idempotente: a linha de "pmoc_avisos" e a do histórico entram juntas, e a chave única recusa a
 * segunda tentativa (a chamada concorrente não escreve nada).
 */
export async function registrarAvisosPmoc(empresaId: string, agora: Date = new Date()): Promise<number> {
  let registrados = 0;
  for (const a of (await avisosAtivos(empresaId, agora)).filter((x) => !x.registrado)) {
    registrados += await prisma.$transaction(async (tx) => {
      const r = await tx.pmocAviso.createMany({ data: [{ pmocId: a.pmocId, tipo: a.tipo, dataExpiracao: paraData(a.dataExpiracao) }], skipDuplicates: true });
      if (!r.count) return 0;
      await registrarHistorico(tx, { pmocId: a.pmocId, acao: ACAO_AVISO[a.tipo], detalhes: detalheAviso(a.tipo, a.dataExpiracao, a.dias) });
      return 1;
    });
  }
  return registrados;
}

/**
 * Ciência do aviso de hoje do plano: sai do sino e do dashboard de todos. Vale para este tipo e esta
 * data de expiração — quando o plano que estava "vencendo" expirar, o aviso de expirado aparece.
 * Devolve o tipo marcado, ou null se o plano não tem aviso (ou não é desta empresa).
 */
export async function darCienciaDoAviso(pmocId: string, empresaId: string, usuarioId: string, agora: Date = new Date()): Promise<TipoAviso | null> {
  const p = await prisma.pmoc.findFirst({ where: { id: pmocId, empresaId }, select: { id: true, status: true, ativo: true, dataInicio: true, dataExpiracao: true } });
  if (!p) return null;
  const a = avisoDoPlano(p, (await configPmoc(empresaId)).diasAviso, agora);
  if (!a) return null;
  const chave = { pmocId_tipo_dataExpiracao: { pmocId, tipo: a.tipo, dataExpiracao: p.dataExpiracao } };
  await prisma.$transaction(async (tx) => {
    const existente = await tx.pmocAviso.findUnique({ where: chave, select: { vistoEm: true } });
    if (existente?.vistoEm) return; // já tinha ciência: nada a registrar de novo
    await tx.pmocAviso.upsert({ where: chave, create: { pmocId, tipo: a.tipo, dataExpiracao: p.dataExpiracao, vistoEm: agora, vistoPorId: usuarioId }, update: { vistoEm: agora, vistoPorId: usuarioId } });
    await registrarHistorico(tx, { pmocId, usuarioId, acao: "Ciência do aviso de vencimento", detalhes: textoAviso(a, p.dataExpiracao) });
  });
  return a.tipo;
}
