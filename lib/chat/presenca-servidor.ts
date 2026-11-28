/**
 * CHAT-1.2 — a presença e a situação do técnico, no SERVIDOR.
 *
 * GRAVAR o contato: o app já fala com o servidor o tempo todo (a sincronização, o tempo real do chat a cada poucos
 * segundos, a localização). Cada uma dessas rotas chama `registrarContato`, que grava `usuarios.ultimo_contato_em`
 * NO MÁXIMO 1 VEZ POR MINUTO por usuário:
 *  - na memória do servidor, a última gravação de cada usuário: dentro do minuto, nem pergunta ao banco;
 *  - no banco, o UPDATE só vale se a gravada é mais velha que 1 minuto (outra instância do servidor pode ter gravado):
 *    nunca escreve a cada requisição.
 *
 * LER (só para o escritório com "Conversas"): a situação de todos os técnicos sai de UMA consulta (as atividades em
 * andamento com a pausa aberta e as agendadas com "A caminho" hoje), mais a das OS que quem vê pode abrir quando "Ver
 * só os próprios" vale.
 */
import { prisma } from "@/lib/prisma";
import { chaveDiaBR } from "@/lib/fuso";
import { filtroOrdens } from "@/lib/escopo/proprios";
import { INTERVALO_CONTATO_MS, situacaoDoTecnico, type EntradaSituacao, type EstadoTecnico, type OsSituacao } from "@/lib/chat/presenca";
import type { QuemEscritorio } from "@/lib/chat/servidor";

const gravados = new Map<string, number>();

/** O app deste usuário falou com o servidor agora: grava, no máximo 1 vez por minuto. Nunca lança. */
export async function registrarContato(usuarioId: string | null | undefined, agora: Date = new Date()): Promise<boolean> {
  if (!usuarioId) return false;
  const t = agora.getTime();
  const ultimo = gravados.get(usuarioId);
  if (ultimo !== undefined && t - ultimo < INTERVALO_CONTATO_MS && t >= ultimo) return false;
  gravados.set(usuarioId, t);
  try {
    const r = await prisma.usuario.updateMany({
      where: { id: usuarioId, OR: [{ ultimoContatoEm: null }, { ultimoContatoEm: { lte: new Date(t - INTERVALO_CONTATO_MS) } }] },
      data: { ultimoContatoEm: agora },
    });
    return r.count > 0;
  } catch {
    gravados.delete(usuarioId);
    return false;
  }
}

/** Só para os testes: esquece a memória das gravações (como outra instância do servidor) */
export const esquecerContatos = () => gravados.clear();

/** O técnico com o login dele (o usuário que conversa), o contato do app e a jornada do cadastro */
export interface TecnicoDaConversa {
  usuarioId: string;
  tecnicoId: string;
  contatoEm: Date | null;
  jornada: EntradaSituacao["jornada"];
}

/** Uma linha da leitura: uma atividade (em andamento, ou agendada com "A caminho" hoje) de um dos técnicos */
interface LinhaSituacao {
  tecnicoId: string; status: string; iniciadaEm: Date | null; osId: string; osNumero: string;
  pausaMotivo: string | null; pausaImpedimento: boolean | null; pausaInicio: Date | null;
  caminhoEm: Date | null; chegou: boolean | null;
}

/**
 * A situação e a presença de cada técnico, para esta pessoa do escritório (a OS só com link se ela pode abri-la).
 * UMA consulta para todos os técnicos juntos (a atividade dele como responsável ou na equipe, com a pausa aberta e os
 * avisos de hoje) — o Prisma faria uma por relação —, mais a das OS visíveis quando "Ver só os próprios" vale.
 */
export async function estadosDosTecnicos(u: QuemEscritorio, tecnicos: TecnicoDaConversa[], agora: Date = new Date()): Promise<EstadoTecnico[]> {
  if (!tecnicos.length) return [];
  const ids = tecnicos.map((t) => t.tecnicoId);
  const dia = chaveDiaBR(agora);
  const linhas = await prisma.$queryRaw<LinhaSituacao[]>`
    SELECT t.tecnico_id AS "tecnicoId", a.status::text AS "status", a.iniciada_em AS "iniciadaEm", o.id AS "osId", o.numero AS "osNumero",
           p.motivo AS "pausaMotivo", p.impedimento AS "pausaImpedimento", p.inicio AS "pausaInicio",
           av.caminho AS "caminhoEm", av.chegou AS "chegou"
      FROM atividades_os a
      JOIN ordens_servico o ON o.id = a.ordem_servico_id AND o.status::text <> 'CANCELADA'
      JOIN LATERAL (
        SELECT a.tecnico_id AS tecnico_id WHERE a.tecnico_id IS NOT NULL
        UNION SELECT e.tecnico_id FROM atividade_tecnicos e WHERE e.atividade_id = a.id
      ) t ON t.tecnico_id = ANY(${ids})
      LEFT JOIN LATERAL (
        SELECT x.motivo, x.impedimento, x.inicio FROM atividade_pausas x WHERE x.atividade_id = a.id AND x.fim IS NULL ORDER BY x.inicio DESC LIMIT 1
      ) p ON a.status::text = 'EM_ANDAMENTO'
      LEFT JOIN LATERAL (
        SELECT max(v.registrado_em) FILTER (WHERE v.evento = 'A_CAMINHO') AS caminho, bool_or(v.evento = 'CHEGOU') AS chegou
          FROM atividade_avisos v WHERE v.atividade_id = a.id AND v.dia = ${dia}::date
      ) av ON true
     WHERE a.empresa_id = ${u.empresaId}
       AND (a.status::text = 'EM_ANDAMENTO' OR (a.status::text = 'AGENDADA' AND av.caminho IS NOT NULL))
     LIMIT 1000`;
  // "Ver só os próprios": o link só da OS que quem vê pode abrir (o número sem link não aparece na tela)
  const osIds = [...new Set(linhas.map((l) => l.osId))];
  const filtro = filtroOrdens(u);
  const visiveis = !osIds.length ? new Set<string>() : Object.keys(filtro).length
    ? new Set((await prisma.ordemServico.findMany({ where: { id: { in: osIds }, empresaId: u.empresaId, ...filtro }, select: { id: true } })).map((o) => o.id))
    : new Set(osIds);
  const os = (l: LinhaSituacao): OsSituacao => ({ id: visiveis.has(l.osId) ? l.osId : null, numero: l.osNumero });

  return tecnicos.map((t) => {
    const dele = linhas.filter((l) => l.tecnicoId === t.tecnicoId);
    return {
      usuarioId: t.usuarioId,
      contatoEm: t.contatoEm?.toISOString() ?? null,
      situacao: situacaoDoTecnico({
        emAndamento: dele.filter((l) => l.status === "EM_ANDAMENTO").map((l) => ({
          os: os(l), iniciadaEm: l.iniciadaEm, pausa: l.pausaMotivo != null && l.pausaInicio ? { motivo: l.pausaMotivo, impedimento: !!l.pausaImpedimento, inicio: l.pausaInicio } : null,
        })),
        aCaminho: dele.filter((l) => l.status === "AGENDADA" && l.caminhoEm && !l.chegou).map((l) => ({ os: os(l), em: l.caminhoEm! })),
        jornada: t.jornada,
      }, agora),
    };
  });
}
