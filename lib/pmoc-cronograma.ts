/**
 * PMOC — Etapa 2: o CRONOGRAMA que gera as OS de manutenção preventiva. Regras PURAS (tela e servidor;
 * sem Node nem Prisma) — o servidor só carrega o estado, pede o PLANO e aplica (lib/pmoc-cronograma-server).
 *
 * Um ITEM do cronograma diz: a quem se aplica (todos os equipamentos do plano, um tipo ou um
 * equipamento), o tipo de OS, a data de início, de quantos em quantos meses e o dia de execução.
 * As datas saem da MESMA recorrência dos contratos (lib/recorrencia-helpers): dia do mês ao meio-dia
 * de Brasília, competência "AAAA-MM".
 *
 * O que vira OS: para cada item e cada competência, UMA OS por local (unidade), com uma atividade que
 * leva todos os equipamentos daquele item naquele local. Cada (item, equipamento, competência) fica
 * registrado como uma EXECUÇÃO ligada à OS — é a chave única que impede duplicar ao reagendar.
 *
 * Quando gera:
 *  - só com o plano ATIVO, PUBLICADO e ainda não expirado (Rascunho não gera; expirado não gera mais);
 *  - só para equipamento ATIVO do plano que caiba no item;
 *  - nunca no passado, nunca depois da data de expiração do plano.
 *
 * SUBSTITUIÇÃO (Etapa 2.1): quando, para o MESMO equipamento na MESMA competência, mais de um item
 * gera execução, vale só o de MAIOR intervalo (o serviço menos frequente, mais profundo: a limpeza
 * química semestral "come" a preventiva mensal daquele mês). Empate de intervalo: o item criado
 * primeiro. É por equipamento — cada um resolve sozinho qual serviço prevalece no mês. Só disputa a
 * execução que EXISTE ou ainda PODE existir (já gerada, ou com data de hoje em diante): uma execução
 * que ficou no passado sem nunca ter sido gerada não tira o lugar de outra.
 *
 * FIM DE SEMANA (Etapa 2.1): por item — manter, adiantar para a sexta ou postergar para a segunda,
 * com a mesma regra da recorrência de OS dos contratos (`ajustarFimDeSemana`).
 *
 * "Reagendar atividades" (o plano completo) também acerta o que já foi gerado e AINDA NÃO COMEÇOU:
 *  - muda a data da OS quando o cronograma mudou — a menos que alguém já tenha mudado a data à mão;
 *  - tira da OS o equipamento que saiu do cronograma (inativado, tirado do plano, item excluído,
 *    competência que deixou de existir, ou substituído por um item de maior intervalo) e cancela a
 *    OS que ficar sem equipamento;
 *  - OS iniciada, concluída, cancelada ou de data passada não é tocada.
 */
import { z } from "zod";
import { proximasOcorrencias } from "@/lib/recorrencia-helpers";
import { chaveDiaBR, diaCivilUTC, instanteBR } from "@/lib/fuso";
import { hojeISO, situacaoPmoc } from "@/lib/pmoc";

/* ───────── o item do cronograma ───────── */

/** Dia de execução vai de 1 a 28 (existe em todo mês), como na recorrência dos contratos */
export const DIA_EXECUCAO_MAX = 28;
export const INTERVALO_MESES_MAX = 60;
/** Teto de segurança de competências por item (20 anos de mensal) */
const LIMITE_OCORRENCIAS = 240;

/** O que fazer quando o dia de execução cai em sábado ou domingo — os mesmos valores dos contratos */
export const FINS_DE_SEMANA = ["MANTER", "ADIANTAR", "POSTERGAR"] as const;
export type FimSemana = (typeof FINS_DE_SEMANA)[number];
/** O que a tela propõe num item NOVO: a visita não se perde nem cai antes da data combinada */
export const FIM_SEMANA_PADRAO: FimSemana = "POSTERGAR";
/** Nome curto para a lista de itens (o nome completo está em LABELS_TRATAMENTO_FIM_SEMANA, o dos contratos) */
export const FIM_SEMANA_CURTO: Record<FimSemana, string> = { MANTER: "", ADIANTAR: "fim de semana: sexta", POSTERGAR: "fim de semana: segunda" };

export const FREQUENCIAS = [
  { meses: 1, rotulo: "Mensal" },
  { meses: 2, rotulo: "Bimestral" },
  { meses: 3, rotulo: "Trimestral" },
  { meses: 6, rotulo: "Semestral" },
  { meses: 12, rotulo: "Anual" },
] as const;

/** "Mensal", "Trimestral"… ou "A cada 4 meses" quando não é uma das frequências de nome próprio */
export function rotuloFrequencia(intervaloMeses: number): string {
  return FREQUENCIAS.find((f) => f.meses === intervaloMeses)?.rotulo ?? `A cada ${intervaloMeses} meses`;
}

const idOpcional = z.string().optional().nullable().transform((v) => v || null);
export const itemCronogramaSchema = z.object({
  tipoEquipamentoId: idOpcional,
  equipamentoId: idOpcional,
  tipoOsId: z.string().min(1, "Selecione o tipo de OS."),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data de início."),
  intervaloMeses: z.number({ invalid_type_error: "Informe de quantos em quantos meses." }).int("Informe um número inteiro de meses.")
    .min(1, "O intervalo é de pelo menos 1 mês.").max(INTERVALO_MESES_MAX, `O intervalo é de no máximo ${INTERVALO_MESES_MAX} meses.`),
  diaExecucao: z.number({ invalid_type_error: "Informe o dia de execução." }).int("Informe um dia inteiro.")
    .min(1, "O dia de execução vai de 1 a 28.").max(DIA_EXECUCAO_MAX, "O dia de execução vai de 1 a 28."),
  /** Ausente = o servidor decide (item novo: o padrão proposto; edição: mantém o que estava) */
  fimSemana: z.enum(FINS_DE_SEMANA, { errorMap: () => ({ message: "Escolha o que fazer no fim de semana." }) }).optional(),
}).refine((d) => !(d.tipoEquipamentoId && d.equipamentoId), { message: "Escolha um tipo de equipamento OU um equipamento, não os dois.", path: ["equipamentoId"] });
export type ItemCronogramaInput = z.infer<typeof itemCronogramaSchema>;

export interface ItemCronograma {
  id: string; ativo: boolean;
  tipoEquipamentoId: string | null; equipamentoId: string | null; tipoOsId: string;
  /** "AAAA-MM-DD" */
  dataInicio: string;
  intervaloMeses: number; diaExecucao: number;
  fimSemana: FimSemana;
  /** Quando o item foi criado (ISO): o desempate da substituição entre itens de mesmo intervalo */
  criadoEm: string;
}
export type EscopoItem = "TODOS" | "TIPO" | "EQUIPAMENTO";
export const escopoDoItem = (i: Pick<ItemCronograma, "tipoEquipamentoId" | "equipamentoId">): EscopoItem =>
  i.equipamentoId ? "EQUIPAMENTO" : i.tipoEquipamentoId ? "TIPO" : "TODOS";

/** Um equipamento coberto pelo plano, com o que o cronograma precisa saber dele */
export interface EquipamentoPlano { id: string; ativo: boolean; unidadeId: string; tipoEquipamentoId: string | null; tipo: string }
/** Tipo de equipamento do cadastro (chaveEnum liga o tipo ao enum antigo dos equipamentos sem tipo novo) */
export interface TipoEquipamentoPlano { id: string; chaveEnum: string | null }

/**
 * O equipamento cabe no item? TODOS: qualquer um do plano. EQUIPAMENTO: só ele. TIPO: o tipo do
 * cadastro — e, para equipamento antigo sem tipo novo, o tipo cuja `chaveEnum` é o enum dele.
 */
export function equipamentoNoItem(item: Pick<ItemCronograma, "tipoEquipamentoId" | "equipamentoId">, e: EquipamentoPlano, tipos: TipoEquipamentoPlano[]): boolean {
  if (item.equipamentoId) return e.id === item.equipamentoId;
  if (!item.tipoEquipamentoId) return true;
  if (e.tipoEquipamentoId) return e.tipoEquipamentoId === item.tipoEquipamentoId;
  return tipos.find((t) => t.id === item.tipoEquipamentoId)?.chaveEnum === e.tipo;
}

/* ───────── as datas ───────── */

export interface Ocorrencia { periodo: string; data: Date }
/** O que define as datas de um item (sem `fimSemana` = manter) */
export type DatasDoItem = Pick<ItemCronograma, "dataInicio" | "intervaloMeses" | "diaExecucao"> & { fimSemana?: FimSemana | null };

/**
 * Todas as execuções de um item, da data de início até a data de expiração do plano (inclusive).
 * A primeira é o primeiro "dia de execução" NA data de início ou depois dela: início em 26/11 com
 * dia 25 começa em 25/12; daí em diante, de N em N meses. O dia que cai em sábado ou domingo segue a
 * opção do item (a competência continua sendo o mês do dia de execução, mesmo que a data ajustada
 * escorregue para o mês vizinho).
 */
export function ocorrenciasDoItem(item: DatasDoItem, dataExpiracao: string): Ocorrencia[] {
  const [a, m, d] = item.dataInicio.split("-").map(Number);
  if (!a || !m || !d || item.dataInicio > dataExpiracao) return [];
  const dia = Math.min(Math.max(Math.floor(item.diaExecucao) || 1, 1), DIA_EXECUCAO_MAX);
  // Âncora: o mês do início, se o dia de execução ainda cabe nele; senão, o mês seguinte
  const ancora = diaCivilUTC(a, m - 1 + (dia < d ? 1 : 0), 1);
  return proximasOcorrencias({
    dataInicio: ancora, dataFim: new Date(`${dataExpiracao}T00:00:00Z`), frequencia: null,
    intervaloMeses: Math.max(1, Math.floor(item.intervaloMeses) || 1), diaRecorrencia: dia, fimSemana: item.fimSemana ?? "MANTER",
    limite: LIMITE_OCORRENCIAS, aPartirDe: instanteBR(a, m - 1, d, 12),
  }).map((o) => ({ periodo: o.periodo, data: o.data }));
}

/** A próxima execução de um item a partir de hoje (null = não há mais nenhuma dentro do plano) */
export function proximaOcorrencia(item: DatasDoItem, dataExpiracao: string, agora: Date = new Date()): Ocorrencia | null {
  const hoje = hojeISO(agora);
  return ocorrenciasDoItem(item, dataExpiracao).find((o) => chaveDiaBR(o.data) >= hoje) ?? null;
}

/* ───────── o plano pode gerar? ───────── */

export type MotivoSemGerar = "INATIVO" | "RASCUNHO" | "EXPIRADO";
export const TEXTO_SEM_GERAR: Record<MotivoSemGerar, string> = {
  INATIVO: "Plano inativo: o cronograma não gera OS.",
  RASCUNHO: "Plano em rascunho: as OS são geradas quando ele for publicado.",
  EXPIRADO: "Plano expirado: o cronograma não gera mais OS.",
};
export interface PmocDoCronograma { status: string; ativo: boolean; dataInicio: string; dataExpiracao: string }

/** Por que este plano não gera OS agora (null = gera) */
export function motivoSemGerar(pmoc: PmocDoCronograma, agora: Date = new Date()): MotivoSemGerar | null {
  if (!pmoc.ativo) return "INATIVO";
  const s = situacaoPmoc(pmoc, agora).status;
  return s === "RASCUNHO" ? "RASCUNHO" : s === "EXPIRADO" ? "EXPIRADO" : null;
}

/* ───────── o plano de reagendamento ───────── */

/** A OS de uma execução já gerada, com o que decide se ela ainda pode ser mexida */
export interface OsDaExecucao {
  id: string; numero: string; status: string;
  atividadeId: string | null; atividadeStatus: string | null;
  /** Instante agendado hoje na atividade (ISO) */
  dataAgendada: string | null;
  /** Todos os equipamentos da atividade (os do cronograma e os que alguém acrescentou à mão) */
  equipamentoIds: string[];
  /** Os que o técnico já marcou como atendidos */
  feitos: string[];
  /** A OS foi dividida em visitas diárias (lib/os/visitas): o reagendamento do cronograma não mexe nela */
  emVisitas?: boolean;
}
export interface ExecucaoExistente {
  id: string; cronogramaId: string; equipamentoId: string; periodo: string;
  /** Instante que o cronograma agendou ao gerar (ISO) */
  dataPrevista: string;
  os: OsDaExecucao | null;
}
export interface EstadoCronograma {
  pmoc: PmocDoCronograma;
  itens: ItemCronograma[];
  equipamentos: EquipamentoPlano[];
  tipos: TipoEquipamentoPlano[];
  execucoes: ExecucaoExistente[];
}

export interface OsACriar { itemId: string; periodo: string; data: Date; unidadeId: string; equipamentoIds: string[] }
export interface EquipamentoAIncluir { osId: string; atividadeId: string; itemId: string; periodo: string; data: Date; equipamentoId: string }
export interface OsAMover { osId: string; atividadeId: string; de: string; para: Date; execucaoIds: string[] }
export interface EquipamentoARetirar {
  execucaoId: string; osId: string; atividadeId: string; equipamentoId: string;
  /** Sai porque, nesta competência, o equipamento é atendido por este item (de maior intervalo) — vai para o histórico da OS */
  substituidoPor?: string;
}
export interface PlanoCronograma {
  /** Por que nada é gerado agora (null = pode gerar) */
  motivo: MotivoSemGerar | null;
  criar: OsACriar[];
  incluir: EquipamentoAIncluir[];
  mover: OsAMover[];
  retirar: EquipamentoARetirar[];
  /** OS que ficam sem equipamento depois de `retirar` */
  cancelar: string[];
  /** OS com data mudada à mão: o reagendamento não mexe */
  mantidas: string[];
}
export const planoVazio = (motivo: MotivoSemGerar | null = null): PlanoCronograma => ({ motivo, criar: [], incluir: [], mover: [], retirar: [], cancelar: [], mantidas: [] });
export const planoTemMudanca = (p: PlanoCronograma) => p.criar.length + p.incluir.length + p.mover.length + p.retirar.length + p.cancelar.length > 0;

const OS_ABERTA = ["ABERTA", "AGUARDANDO_ATENDIMENTO", "AGENDADA"];
/**
 * A execução ainda pode ser mexida pelo reagendamento? Só enquanto NADA aconteceu: OS aberta/agendada,
 * atividade agendada, equipamento não atendido e data de hoje em diante.
 * A OS dividida em visitas diárias fica de fora: o cronograma não muda data nem lote dela.
 */
export function execucaoPendente(x: ExecucaoExistente, hoje: string): boolean {
  const os = x.os;
  if (!os || !os.atividadeId || !os.dataAgendada) return false;
  if (os.emVisitas) return false; // quem manda nas datas e nos lotes é o planejamento de visitas da OS
  if (!OS_ABERTA.includes(os.status) || os.atividadeStatus !== "AGENDADA") return false;
  if (os.feitos.includes(x.equipamentoId)) return false;
  return chaveDiaBR(os.dataAgendada) >= hoje;
}

const chave = (itemId: string, equipamentoId: string, periodo: string) => `${itemId}|${equipamentoId}|${periodo}`;

/** Uma execução que o cronograma pede: este item, neste equipamento, nesta competência, nesta data */
export interface ExecucaoDesejada { item: ItemCronograma; equipamento: EquipamentoPlano; periodo: string; data: Date }
/** Uma execução que deixou de valer porque outro item, de maior intervalo, pegou o equipamento no mês */
export interface ExecucaoSubstituida extends ExecucaoDesejada { porItemId: string }

/**
 * Quem prevalece entre dois itens no mesmo equipamento e na mesma competência: o de MAIOR intervalo;
 * no empate, o item criado primeiro (e, por fim, o id — para ser sempre o mesmo resultado).
 */
export function prevalece(a: ItemCronograma, b: ItemCronograma): boolean {
  if (a.intervaloMeses !== b.intervaloMeses) return a.intervaloMeses > b.intervaloMeses;
  if (a.criadoEm !== b.criadoEm) return a.criadoEm < b.criadoEm;
  return a.id < b.id;
}

/**
 * O que o cronograma PEDE, já com a substituição aplicada: (item, equipamento, competência) → data.
 * `substituidas` são as que perderam o equipamento naquele mês para um item de maior intervalo.
 */
export function execucoesDesejadas(estado: EstadoCronograma, agora: Date = new Date()): { desejado: Map<string, ExecucaoDesejada>; substituidas: ExecucaoSubstituida[] } {
  const hoje = hojeISO(agora);
  const desejado = new Map<string, ExecucaoDesejada>();
  for (const item of estado.itens) {
    if (!item.ativo) continue;
    const equipamentos = estado.equipamentos.filter((e) => e.ativo && equipamentoNoItem(item, e, estado.tipos));
    if (!equipamentos.length) continue;
    for (const oc of ocorrenciasDoItem(item, estado.pmoc.dataExpiracao))
      for (const equipamento of equipamentos) desejado.set(chave(item.id, equipamento.id, oc.periodo), { item, equipamento, periodo: oc.periodo, data: oc.data });
  }

  // Substituição: em cada (equipamento, competência) só disputa a execução que existe ou ainda pode
  // existir — a já gerada, ou a que tem data de hoje em diante. Prevalece uma só.
  const geradas = new Set(estado.execucoes.map((x) => chave(x.cronogramaId, x.equipamentoId, x.periodo)));
  const vencedora = new Map<string, ExecucaoDesejada>();
  const disputam: [string, ExecucaoDesejada][] = [];
  for (const [k, q] of desejado) {
    if (!geradas.has(k) && chaveDiaBR(q.data) < hoje) continue; // passou sem nunca ter sido gerada: não disputa
    disputam.push([k, q]);
    const vaga = `${q.equipamento.id}|${q.periodo}`;
    const atual = vencedora.get(vaga);
    if (!atual || prevalece(q.item, atual.item)) vencedora.set(vaga, q);
  }
  const substituidas: ExecucaoSubstituida[] = [];
  for (const [k, q] of disputam) {
    const ganhou = vencedora.get(`${q.equipamento.id}|${q.periodo}`)!;
    if (ganhou.item.id === q.item.id) continue;
    desejado.delete(k);
    substituidas.push({ ...q, porItemId: ganhou.item.id });
  }
  return { desejado, substituidas };
}

/**
 * O PLANO: o que falta criar e o que precisa ser acertado para a agenda ficar igual ao cronograma.
 * Função pura e determinística — rodar de novo depois de aplicado devolve um plano sem mudança.
 */
export function planejarCronograma(estado: EstadoCronograma, agora: Date = new Date()): PlanoCronograma {
  const motivo = motivoSemGerar(estado.pmoc, agora);
  if (motivo) return planoVazio(motivo); // inativo, rascunho ou expirado: nada é criado nem mexido
  const hoje = hojeISO(agora);
  const plano = planoVazio();
  const equipPorId = new Map(estado.equipamentos.map((e) => [e.id, e]));

  // 1. O que o cronograma pede, já sem o que foi substituído por um item de maior intervalo
  const { desejado, substituidas } = execucoesDesejadas(estado, agora);
  const cedeuPara = new Map(substituidas.map((q) => [chave(q.item.id, q.equipamento.id, q.periodo), q.porItemId]));

  // 2. O que já existe: mantém, muda a data ou retira
  const atendidas = new Set<string>();
  const moverPorOs = new Map<string, OsAMover>();
  const manuais = new Set<string>();
  const retiradosPorOs = new Map<string, Set<string>>();
  /** OS ainda mexível de cada (item, competência, local): onde entra um equipamento que faltou */
  const osAberta = new Map<string, OsDaExecucao>();
  for (const x of estado.execucoes) {
    const k = chave(x.cronogramaId, x.equipamentoId, x.periodo);
    const quer = desejado.get(k);
    const pendente = execucaoPendente(x, hoje);
    if (!quer) {
      // Saiu do cronograma: só mexe no que ainda não começou; o resto fica como histórico
      if (pendente) {
        const substituidoPor = cedeuPara.get(k);
        plano.retirar.push({ execucaoId: x.id, osId: x.os!.id, atividadeId: x.os!.atividadeId!, equipamentoId: x.equipamentoId, ...(substituidoPor ? { substituidoPor } : {}) });
        if (!retiradosPorOs.has(x.os!.id)) retiradosPorOs.set(x.os!.id, new Set());
        retiradosPorOs.get(x.os!.id)!.add(x.equipamentoId);
      }
      continue;
    }
    atendidas.add(k);
    if (!pendente) continue;
    const os = x.os!;
    const unidade = equipPorId.get(x.equipamentoId)?.unidadeId ?? "";
    const diaAtual = chaveDiaBR(os.dataAgendada!);
    const diaNovo = chaveDiaBR(quer.data);
    osAberta.set(`${x.cronogramaId}|${x.periodo}|${unidade}`, os);
    if (diaAtual === diaNovo) continue;
    // A data difere do cronograma. Alguém mexeu à mão (já não é a que o cronograma agendou)? Não mexe.
    if (diaAtual !== chaveDiaBR(x.dataPrevista)) { manuais.add(os.id); continue; }
    // Não dá para reagendar para o passado: fica onde está
    if (diaNovo < hoje) continue;
    const m = moverPorOs.get(os.id) ?? { osId: os.id, atividadeId: os.atividadeId!, de: os.dataAgendada!, para: quer.data, execucaoIds: [] };
    m.execucaoIds.push(x.id);
    moverPorOs.set(os.id, m);
  }
  plano.mover = [...moverPorOs.values()];
  plano.mantidas = [...manuais];

  // 3. OS que ficam sem equipamento nenhum depois das retiradas
  const porOs = new Map<string, OsDaExecucao>();
  for (const x of estado.execucoes) if (x.os) porOs.set(x.os.id, x.os);
  for (const [osId, retirados] of retiradosPorOs) {
    const os = porOs.get(osId)!;
    if (os.equipamentoIds.every((id) => retirados.has(id))) plano.cancelar.push(osId);
  }
  const canceladas = new Set(plano.cancelar);

  // 4. O que falta: entra numa OS aberta do mesmo item/competência/local, ou vira OS nova
  const novas = new Map<string, OsACriar>();
  for (const [k, q] of desejado) {
    if (atendidas.has(k)) continue;
    if (chaveDiaBR(q.data) < hoje) continue; // nunca gera no passado
    const grupo = `${q.item.id}|${q.periodo}|${q.equipamento.unidadeId}`;
    const aberta = osAberta.get(grupo);
    if (aberta && !canceladas.has(aberta.id)) {
      // `data` é a que o CRONOGRAMA pede (vira a "data prevista" da execução): se a OS está noutro dia
      // porque alguém mudou à mão, isso continua aparecendo como ajuste manual nas próximas vezes
      plano.incluir.push({ osId: aberta.id, atividadeId: aberta.atividadeId!, itemId: q.item.id, periodo: q.periodo, data: q.data, equipamentoId: q.equipamento.id });
      continue;
    }
    const nova = novas.get(grupo) ?? { itemId: q.item.id, periodo: q.periodo, data: q.data, unidadeId: q.equipamento.unidadeId, equipamentoIds: [] };
    nova.equipamentoIds.push(q.equipamento.id);
    novas.set(grupo, nova);
  }
  plano.criar = [...novas.values()].sort((a, b) => a.data.getTime() - b.data.getTime() || a.itemId.localeCompare(b.itemId) || a.unidadeId.localeCompare(b.unidadeId));
  return plano;
}

/** Só a parte que CRIA (o que roda sozinho ao publicar e ao salvar o cronograma): nada é movido nem cancelado */
export const soCriar = (p: PlanoCronograma): PlanoCronograma => ({ ...planoVazio(p.motivo), criar: p.criar, incluir: p.incluir });

/** Equipamentos ativos do plano que não entram em nenhum item ativo do cronograma */
export function equipamentosSemCronograma(itens: ItemCronograma[], equipamentos: EquipamentoPlano[], tipos: TipoEquipamentoPlano[]): string[] {
  const ativos = itens.filter((i) => i.ativo);
  return equipamentos.filter((e) => e.ativo && !ativos.some((i) => equipamentoNoItem(i, e, tipos))).map((e) => e.id);
}

/* ───────── o que a tela e as rotas trocam ───────── */

export interface ResumoPlano {
  criar: number; incluir: number; mover: number;
  /** Equipamentos que saem de OS já geradas (todos os motivos) */
  retirar: number;
  cancelar: number; mantidas: number;
  /** Dos retirados, quantos saem porque um item de maior intervalo passou a atendê-los no mês */
  substituidos: number;
}
export const resumirPlano = (p: PlanoCronograma): ResumoPlano => ({
  criar: p.criar.length, incluir: p.incluir.length, mover: p.mover.length, retirar: p.retirar.length, cancelar: p.cancelar.length, mantidas: p.mantidas.length,
  substituidos: p.retirar.filter((r) => r.substituidoPor).length,
});

/** "PMOC <nome>"; o nome que já diz "PMOC" não ganha a palavra de novo */
export const nomeComPmoc = (nomePmoc: string) => (/pmoc/i.test(nomePmoc) ? nomePmoc : `PMOC ${nomePmoc}`);
/** "<tipo de OS> — PMOC <nome> (MM/AAAA)" */
export function descricaoDaOs(tipoOs: string, nomePmoc: string, periodo: string): string {
  const [ano, mes] = periodo.split("-");
  return `${tipoOs} — ${nomeComPmoc(nomePmoc)} (${mes}/${ano})`;
}
/** Marca da OS gerada pelo cronograma no campo de competência da recorrência (como os contratos fazem) */
export const periodoDaOs = (periodo: string) => `PMOC:${periodo}`;

/** O que mudou na agenda, numa frase: "12 OS criadas · 2 OS com data nova". Vazio = nada mudou. */
export function textoResultado(r: { criadas: unknown[] | number; incluidos: number; movidas: number; retirados: number; canceladas: number }): string {
  const criadas = typeof r.criadas === "number" ? r.criadas : r.criadas.length;
  const n = (q: number, um: string, varios: string) => (q === 1 ? `1 ${um}` : `${q} ${varios}`);
  return [
    criadas && n(criadas, "OS criada", "OS criadas"),
    r.incluidos && n(r.incluidos, "equipamento incluído", "equipamentos incluídos"),
    r.movidas && n(r.movidas, "OS com data nova", "OS com data nova"),
    r.retirados && n(r.retirados, "equipamento retirado", "equipamentos retirados"),
    r.canceladas && n(r.canceladas, "OS cancelada", "OS canceladas"),
  ].filter(Boolean).join(" · ");
}
