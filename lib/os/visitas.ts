/**
 * OS EM CAMPANHA / MÚLTIPLAS VISITAS — regras puras (tela e servidor; sem banco).
 *
 * Uma manutenção grande (ex.: limpeza química de 300 aparelhos) não cabe num dia. A OS continua
 * sendo UMA só; o plano divide os equipamentos em VISITAS diárias. Cada visita é uma ATIVIDADE da
 * OS com o seu lote de equipamentos — por isso já aparece no calendário e no app do técnico.
 *
 * O que o planejamento pode mexer: só a visita PENDENTE — agendada e sem nenhum registro de execução.
 * A que já começou, foi concluída ou cancelada nunca é tocada: replanejar não apaga o que foi feito.
 *
 * Toda operação (planejar, incluir dia, tirar dia, mover equipamento) devolve a MESMA coisa: como
 * ficam as visitas pendentes (dia e lote de cada uma) e quais deixam de existir. Aplicar duas vezes o
 * mesmo resultado não muda nada, e nenhum equipamento fica em duas visitas pendentes.
 */
import { z } from "zod";
import { chaveDiaBR, instanteBR } from "@/lib/fuso";
import { ajustarFimDeSemana } from "@/lib/recorrencia-helpers";

export const POR_DIA_MAX = 500;
export const VISITAS_MAX = 400;
/** Quantidade por dia proposta no primeiro planejamento (o usuário muda no diálogo) */
export const POR_DIA_SUGERIDO = 25;

/* ───────── dias ("AAAA-MM-DD", dia civil de Brasília) ───────── */

const partes = (dia: string) => dia.split("-").map(Number) as [number, number, number];
const meioDia = (dia: string) => { const [a, m, d] = partes(dia); return instanteBR(a, m - 1, d, 12, 0); };
export const diaValido = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && chaveDiaBR(meioDia(v)) === v;

export function somarDias(dia: string, n: number): string {
  const [a, m, d] = partes(dia);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
/** 0 = domingo … 6 = sábado */
export const diaDaSemana = (dia: string) => { const [a, m, d] = partes(dia); return new Date(Date.UTC(a, m - 1, d)).getUTCDay(); };
export const fimDeSemana = (dia: string) => diaDaSemana(dia) === 0 || diaDaSemana(dia) === 6;

/** O próprio dia, ou a segunda-feira seguinte quando ele cai em sábado/domingo (a regra de dia útil dos contratos e do PMOC) */
export function diaUtil(dia: string, pularFimSemana: boolean): string {
  return pularFimSemana ? chaveDiaBR(ajustarFimDeSemana(meioDia(dia), "POSTERGAR")) : dia;
}
/** `n` dias de trabalho em sequência a partir de `inicio` (pulando sábado e domingo, se pedido) */
export function sequenciaDeDias(inicio: string, n: number, pularFimSemana: boolean): string[] {
  const dias: string[] = [];
  let dia = diaUtil(inicio, pularFimSemana);
  for (let i = 0; i < n; i++) { dias.push(dia); dia = diaUtil(somarDias(dia, 1), pularFimSemana); }
  return dias;
}

/* ───────── o que existe ───────── */

export interface EquipamentoDaVisita {
  id: string; feito: boolean;
  /** Chave de ordenação por local (setor, ambiente, TAG): equipamentos vizinhos caem no mesmo dia */
  ordem: string;
}
export interface VisitaAtual {
  id: string; status: string;
  /** Dia da visita em Brasília; null = sem data */
  dia: string | null;
  /** Tem registro de execução (checklist, formulário, foto, relatório, aviso ao cliente, observação)? */
  executada: boolean;
  equipamentos: EquipamentoDaVisita[];
}

/** A visita que o planejamento ainda pode mexer: agendada, sem nada feito e sem registro de execução */
export const visitaPendente = (v: VisitaAtual) => v.status === "AGENDADA" && !v.executada && !v.equipamentos.some((e) => e.feito);

const colacao = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
const porOrdem = (a: EquipamentoDaVisita, b: EquipamentoDaVisita) => colacao.compare(a.ordem, b.ordem) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const porDia = (a: VisitaAtual, b: VisitaAtual) => (a.dia ?? "9999").localeCompare(b.dia ?? "9999") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const pendentesEmOrdem = (visitas: VisitaAtual[]) => visitas.filter(visitaPendente).sort(porDia);

/** Equipamentos já atendidos em alguma visita não cancelada */
function atendidos(visitas: VisitaAtual[]): Set<string> {
  const s = new Set<string>();
  for (const v of visitas) if (v.status !== "CANCELADA") for (const e of v.equipamentos) if (e.feito) s.add(e.id);
  return s;
}

/**
 * A FILA a distribuir: os equipamentos das visitas pendentes, na sequência atual (visita por visita,
 * por local dentro de cada uma), sem repetir e sem o que já foi atendido em outra visita.
 */
export function filaDePendentes(visitas: VisitaAtual[]): string[] {
  const feitos = atendidos(visitas);
  const fila: string[] = [], vistos = new Set<string>();
  for (const v of pendentesEmOrdem(visitas)) for (const e of [...v.equipamentos].sort(porOrdem)) {
    if (vistos.has(e.id) || feitos.has(e.id)) continue;
    vistos.add(e.id); fila.push(e.id);
  }
  return fila;
}

/**
 * SOBRAS: equipamentos que ficaram sem atendimento em visitas já CONCLUÍDAS e que não estão em
 * nenhuma visita pendente nem em andamento. Podem voltar para a fila ao replanejar (a visita
 * concluída não é mexida: o equipamento continua lá, como não atendido).
 */
export function sobras(visitas: VisitaAtual[]): string[] {
  const feitos = atendidos(visitas);
  const emAberto = new Set<string>();
  for (const v of visitas) if (v.status !== "CANCELADA" && v.status !== "CONCLUIDA") for (const e of v.equipamentos) emAberto.add(e.id);
  const out = new Map<string, EquipamentoDaVisita>();
  for (const v of visitas) if (v.status === "CONCLUIDA") for (const e of v.equipamentos) {
    if (!e.feito && !feitos.has(e.id) && !emAberto.has(e.id)) out.set(e.id, e);
  }
  return [...out.values()].sort(porOrdem).map((e) => e.id);
}

/* ───────── o resultado de uma operação ───────── */

export interface VisitaPlanejada {
  /** A visita pendente reaproveitada (null = visita nova) */
  id: string | null;
  dia: string;
  equipamentoIds: string[];
}
export interface PlanoDeVisitas {
  /** Como ficam TODAS as visitas pendentes, em ordem de dia */
  visitas: VisitaPlanejada[];
  /** Visitas pendentes que deixam de existir */
  remover: string[];
}
export type Resultado = { plano: PlanoDeVisitas; erro?: undefined } | { erro: string; plano?: undefined };
const falha = (erro: string): Resultado => ({ erro });

/** Lotes cheios de `porDiaN` e o resto no último: 60 em 25 → 25, 25, 10 */
export function tamanhosPorDia(total: number, porDiaN: number): number[] {
  const n = Math.ceil(total / porDiaN);
  return Array.from({ length: n }, (_, i) => (i < n - 1 ? porDiaN : total - porDiaN * (n - 1)));
}
/** Lotes do mesmo tamanho, com a sobra nos primeiros: 60 em 4 dias → 15, 15, 15, 15; 62 → 16, 16, 15, 15 */
export function tamanhosEquilibrados(total: number, n: number): number[] {
  const base = Math.floor(total / n), resto = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < resto ? 1 : 0));
}
function fatiar(fila: string[], tamanhos: number[]): string[][] {
  let i = 0;
  return tamanhos.map((t) => fila.slice(i, (i += t)));
}

export interface ParametrosDoPlano {
  /** Dia da primeira visita */
  inicio: string;
  porDia: number;
  pularFimSemana: boolean;
  /** Trazer de volta para a fila o que ficou sem atendimento em visitas concluídas */
  incluirSobras?: boolean;
}

/**
 * PLANEJAR (e replanejar): distribui a fila em lotes de `porDia`, um por dia de trabalho, a partir de
 * `inicio`. As visitas pendentes que já existem são reaproveitadas na ordem (mesma atividade, dia e
 * lote novos); as que sobram deixam de existir. Com os mesmos parâmetros o resultado é o mesmo.
 */
export function planejarVisitas(visitas: VisitaAtual[], p: ParametrosDoPlano, hoje: string): Resultado {
  if (!diaValido(p.inicio)) return falha("Informe a data de início.");
  if (p.inicio < hoje) return falha("A data de início já passou.");
  if (!Number.isInteger(p.porDia) || p.porDia < 1) return falha("Informe quantos equipamentos por dia.");
  if (p.porDia > POR_DIA_MAX) return falha(`São no máximo ${POR_DIA_MAX} equipamentos por dia.`);
  const pendentes = pendentesEmOrdem(visitas);
  const fila = [...filaDePendentes(visitas), ...(p.incluirSobras ? sobras(visitas) : [])];
  if (!fila.length) return falha("Não há equipamento a planejar: as visitas já começaram ou foram concluídas.");
  const tamanhos = tamanhosPorDia(fila.length, p.porDia);
  if (tamanhos.length > VISITAS_MAX) return falha(`Seriam ${tamanhos.length} visitas. Aumente a quantidade por dia.`);
  const dias = sequenciaDeDias(p.inicio, tamanhos.length, p.pularFimSemana);
  const lotes = fatiar(fila, tamanhos);
  return {
    plano: {
      visitas: lotes.map((equipamentoIds, i) => ({ id: pendentes[i]?.id ?? null, dia: dias[i], equipamentoIds })),
      remover: pendentes.slice(lotes.length).map((v) => v.id),
    },
  };
}

/** Cada visita pendente no SEU dia, e a fila repartida por igual entre elas */
function equilibrar(visitas: VisitaAtual[], vagas: { id: string | null; dia: string }[], remover: string[]): Resultado {
  const fila = filaDePendentes(visitas);
  if (fila.length < vagas.length) return falha("Não há equipamentos para mais um dia: cada visita ficaria sem equipamento.");
  const emOrdem = [...vagas].sort((a, b) => a.dia.localeCompare(b.dia) || (a.id ?? "~").localeCompare(b.id ?? "~"));
  const lotes = fatiar(fila, tamanhosEquilibrados(fila.length, emOrdem.length));
  return { plano: { visitas: emOrdem.map((v, i) => ({ ...v, equipamentoIds: lotes[i] })), remover } };
}

/** INCLUIR UM DIA: mais uma visita, no dia escolhido; os equipamentos pendentes são repartidos por igual */
export function incluirDia(visitas: VisitaAtual[], dia: string, hoje: string): Resultado {
  if (!diaValido(dia)) return falha("Informe o dia da nova visita.");
  if (dia < hoje) return falha("Esse dia já passou.");
  const pendentes = pendentesEmOrdem(visitas);
  if (!pendentes.length) return falha("Não há visita pendente para repartir os equipamentos.");
  if (pendentes.some((v) => v.dia === dia)) return falha("Já existe uma visita pendente nesse dia.");
  return equilibrar(visitas, [...pendentes.map((v) => ({ id: v.id, dia: v.dia ?? dia })), { id: null, dia }], []);
}

/** TIRAR UM DIA: a visita deixa de existir e os equipamentos dela vão para as outras visitas pendentes */
export function tirarDia(visitas: VisitaAtual[], visitaId: string): Resultado {
  const pendentes = pendentesEmOrdem(visitas);
  const alvo = pendentes.find((v) => v.id === visitaId);
  if (!alvo) return falha(MSG_NAO_PENDENTE);
  const outras = pendentes.filter((v) => v.id !== visitaId);
  if (!outras.length) return falha("É a única visita pendente. Para mudar o dia, mova a visita.");
  if (outras.some((v) => !v.dia)) return falha("Há visita pendente sem data. Informe a data dela antes.");
  return equilibrar(visitas, outras.map((v) => ({ id: v.id, dia: v.dia! })), [visitaId]);
}

export const MSG_NAO_PENDENTE = "Esta visita já começou, foi concluída ou cancelada: o planejamento não mexe nela.";

/** MOVER UMA VISITA de dia: só ela muda; as outras ficam como estão */
export function moverVisita(visitas: VisitaAtual[], visitaId: string, dia: string, hoje: string): Resultado {
  if (!diaValido(dia)) return falha("Informe o novo dia da visita.");
  if (dia < hoje) return falha("Esse dia já passou.");
  const pendentes = pendentesEmOrdem(visitas);
  if (!pendentes.some((v) => v.id === visitaId)) return falha(MSG_NAO_PENDENTE);
  return {
    plano: {
      visitas: pendentes.map((v) => ({ id: v.id, dia: v.id === visitaId ? dia : v.dia ?? dia, equipamentoIds: v.equipamentos.map((e) => e.id) }))
        .sort((a, b) => a.dia.localeCompare(b.dia) || a.id.localeCompare(b.id)),
      remover: [],
    },
  };
}

/**
 * AJUSTE MANUAL: mover equipamentos de uma visita pendente para outra. Só entre pendentes e só o
 * que ainda não foi atendido. A visita que fica sem equipamento deixa de existir.
 */
export function moverEquipamentos(visitas: VisitaAtual[], equipamentoIds: string[], paraVisitaId: string): Resultado {
  const pendentes = pendentesEmOrdem(visitas);
  const destino = pendentes.find((v) => v.id === paraVisitaId);
  if (!destino) return falha(MSG_NAO_PENDENTE);
  const mover = new Set(equipamentoIds);
  if (!mover.size) return falha("Escolha os equipamentos a mover.");
  const nasPendentes = new Set(pendentes.flatMap((v) => v.equipamentos.map((e) => e.id)));
  if ([...mover].some((id) => !nasPendentes.has(id))) return falha("Só dá para mover equipamento de uma visita pendente.");
  const remover: string[] = [];
  const novas: VisitaPlanejada[] = [];
  for (const v of pendentes) {
    const ficam = v.equipamentos.filter((e) => !mover.has(e.id)).map((e) => e.id);
    const lote = v.id === paraVisitaId ? [...ficam, ...[...mover].filter((id) => !ficam.includes(id))] : ficam;
    if (!lote.length) { remover.push(v.id); continue; }
    if (!v.dia) return falha("Há visita pendente sem data. Informe a data dela antes.");
    novas.push({ id: v.id, dia: v.dia, equipamentoIds: lote });
  }
  return { plano: { visitas: novas, remover } };
}

/* ───────── o que a tela mostra ───────── */

export interface ResumoDoPlano { visitas: number; equipamentos: number; de: string | null; ate: string | null; maiorLote: number; menorLote: number }
/** A prévia antes de confirmar: quantas visitas, de que dia a que dia */
export function resumoDoPlano(p: PlanoDeVisitas): ResumoDoPlano {
  const dias = p.visitas.map((v) => v.dia).sort(), lotes = p.visitas.map((v) => v.equipamentoIds.length);
  return {
    visitas: p.visitas.length, equipamentos: lotes.reduce((s, n) => s + n, 0), de: dias[0] ?? null, ate: dias.at(-1) ?? null,
    maiorLote: lotes.length ? Math.max(...lotes) : 0, menorLote: lotes.length ? Math.min(...lotes) : 0,
  };
}

export interface Progresso {
  /** Equipamentos DISTINTOS já atendidos */
  feitos: number;
  /** Equipamentos DISTINTOS nas visitas (as canceladas não contam) */
  total: number;
  visitas: number; concluidas: number;
}
/**
 * O progresso SOMADO da OS em visitas: equipamento distinto atendido sobre equipamento distinto nas
 * visitas. O equipamento que voltou numa segunda visita conta uma vez só.
 */
export function progressoDasVisitas(visitas: Pick<VisitaAtual, "status" | "equipamentos">[]): Progresso {
  const todos = new Set<string>(), feitos = new Set<string>();
  const ativas = visitas.filter((v) => v.status !== "CANCELADA");
  for (const v of ativas) for (const e of v.equipamentos) { todos.add(e.id); if (e.feito) feitos.add(e.id); }
  return { feitos: feitos.size, total: todos.size, visitas: ativas.length, concluidas: ativas.filter((v) => v.status === "CONCLUIDA").length };
}

/** "Visita 3 de 12": a posição de cada visita não cancelada, por data */
export function numerarVisitas(visitas: { id: string; status: string; dataAgendada: Date | string | null }[]): Map<string, { numero: number; total: number }> {
  const quando = (d: Date | string | null) => (d ? new Date(d).getTime() : Number.MAX_SAFE_INTEGER);
  const ativas = visitas.filter((v) => v.status !== "CANCELADA").sort((a, b) => quando(a.dataAgendada) - quando(b.dataAgendada) || (a.id < b.id ? -1 : 1));
  return new Map(ativas.map((v, i) => [v.id, { numero: i + 1, total: ativas.length }]));
}

/** A chave de ordenação por local de um equipamento */
export function ordemDoEquipamento(e: { setor?: string | null; localizacao?: string | null; patrimonio?: string | null; nome?: string | null }): string {
  return [e.setor, e.localizacao, e.patrimonio, e.nome].map((x) => (x ?? "").trim() || "￿").join("\u0001");
}

/* ───────── pedidos ───────── */

const dia = (msg: string) => z.string({ required_error: msg, invalid_type_error: msg }).refine(diaValido, msg);
const executorSchema = z.object({
  tecnicoIds: z.array(z.string()).max(30).default([]),
  responsavelId: z.string().nullable().optional(),
  equipeId: z.string().nullable().optional(),
  /** undefined = puxa o da equipe/colaborador; null = sem veículo */
  veiculoId: z.string().nullable().optional(),
});
export type ExecutorDoPlano = z.infer<typeof executorSchema>;

export const pedidoVisitasSchema = z.discriminatedUnion("acao", [
  z.object({
    acao: z.literal("PLANEJAR"),
    /** A atividade a dividir (só no primeiro planejamento; vazio = a pendente com mais equipamentos) */
    atividadeId: z.string().optional(),
    inicio: dia("Informe a data de início."),
    porDia: z.number({ required_error: "Informe quantos equipamentos por dia.", invalid_type_error: "Informe quantos equipamentos por dia." })
      .int("Informe um número inteiro de equipamentos por dia.").min(1, "Informe quantos equipamentos por dia.").max(POR_DIA_MAX, `São no máximo ${POR_DIA_MAX} equipamentos por dia.`),
    pularFimSemana: z.boolean().default(true),
    incluirSobras: z.boolean().optional(),
    /** Quem executa as visitas pendentes. Ausente = cada visita fica com quem já tem (a nova copia do modelo) */
    executor: executorSchema.optional(),
  }),
  z.object({ acao: z.literal("MOVER_VISITA"), visitaId: z.string().min(1), dia: dia("Informe o novo dia da visita.") }),
  z.object({ acao: z.literal("INCLUIR_DIA"), dia: dia("Informe o dia da nova visita.") }),
  z.object({ acao: z.literal("TIRAR_DIA"), visitaId: z.string().min(1) }),
  z.object({ acao: z.literal("MOVER_EQUIPAMENTOS"), equipamentoIds: z.array(z.string().min(1)).min(1, "Escolha os equipamentos a mover.").max(2000), paraVisitaId: z.string().min(1) }),
]);
export type PedidoVisitas = z.infer<typeof pedidoVisitasSchema>;

/** O que a tela recebe do servidor */
export interface VisitaTela {
  id: string; titulo: string; status: string;
  /** Instante agendado (ISO) e o dia em Brasília */
  dataAgendada: string | null; dia: string | null;
  numero: number | null;
  pendente: boolean;
  /** "Equipe Alfa: João (responsável), Maria" · null = sem quem execute */
  executor: string | null;
  equipamentos: { id: string; rotulo: string; local: string | null; feito: boolean; ordem: string }[];
}
export interface EstadoVisitasTela {
  plano: { porDia: number; pularFimSemana: boolean } | null;
  /** Só as visitas do plano (vazio antes do primeiro planejamento) */
  visitas: VisitaTela[];
  progresso: Progresso;
  /** Equipamentos sem atendimento em visitas concluídas, fora de qualquer visita pendente */
  sobras: number;
  /** A atividade que o primeiro planejamento divide (null = nenhuma serve) */
  origem: { id: string; titulo: string; equipamentos: VisitaTela["equipamentos"]; dataAgendada: string | null; dia: string | null } | null;
  /** O serviço das visitas (para a tela oferecer só quem tem competência nele) */
  tipoOsId: string | null;
  /** Quem executa hoje: o da atividade a dividir ou, com o plano feito, o da primeira visita pendente */
  executorModelo: ExecutorDoPlano | null;
  /** Por que não dá para planejar agora (null = dá) */
  bloqueio: string | null;
  proposta: { inicio: string; porDia: number; pularFimSemana: boolean };
  hoje: string;
}

/** A partir de quantos equipamentos numa atividade a tela oferece "Planejar visitas" */
export const MINIMO_PARA_PLANEJAR = 2;
