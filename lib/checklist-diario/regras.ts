/**
 * Checklist de veículo OBRIGATÓRIO no app — o "porteiro" (regras PURAS: servidor, app e testes usam as mesmas).
 *
 * - Nos dias da semana que a empresa escolher (dia civil de Brasília), o colaborador obrigado — com veículo padrão
 *   ativo — só usa o app depois do checklist do dia ou de "Hoje não vou usar o veículo". Feito uma vez, libera o dia.
 * - Quem é obrigado: todos com veículo padrão (o padrão) ou só os colaboradores escolhidos pela empresa.
 * - Problema na inspeção não trava: o checklist fica "Com alertas", o gestor vê no sino, o técnico segue.
 * - NUNCA prende o técnico: o que o aparelho já registrou hoje libera (mesmo sem ter subido); sem o resumo do dia
 *   (opção desligada, módulo Frota desligado, sem veículo…), não há porteiro.
 * - Um registro por colaborador por dia: o "não vou usar" pode virar "feito" (com o rastro da troca); o "feito" nunca
 *   volta a "não vou usar"; reenviar (mesmo client_id) não duplica.
 */
import { chaveDiaBR } from "@/lib/fuso";
import type { ItemDoModelo } from "@/lib/veiculos/checklist";

export type SituacaoDiario = "FEITO" | "NAO_VAI_USAR";

export interface ConfigChecklistDiario {
  ativo: boolean;
  /** 0 = domingo … 6 = sábado */
  dias: number[];
  templateId: string | null;
  /** true = todos com veículo padrão; false = só os de `tecnicos` */
  todos: boolean;
  tecnicos: string[];
}

export const CONFIG_DIARIO_PADRAO: ConfigChecklistDiario = { ativo: false, dias: [1, 2, 3, 4, 5], templateId: null, todos: true, tecnicos: [] };

export const NOMES_DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;
export const SIGLAS_DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

/** Dias válidos (0–6), sem repetir, em ordem */
export function diasValidos(dias: readonly unknown[] | null | undefined): number[] {
  return [...new Set((dias ?? []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
}

/** A configuração do banco (colunas checklist_diario_*) no formato das regras; ausente = desligado */
export function normalizarConfigDiario(row: {
  checklistDiarioAtivo?: boolean | null; checklistDiarioDias?: readonly number[] | null; checklistDiarioTemplateId?: string | null;
  checklistDiarioTodos?: boolean | null; checklistDiarioTecnicos?: readonly string[] | null;
} | null | undefined): ConfigChecklistDiario {
  if (!row) return { ...CONFIG_DIARIO_PADRAO, dias: [...CONFIG_DIARIO_PADRAO.dias] };
  return {
    ativo: row.checklistDiarioAtivo === true,
    dias: diasValidos(row.checklistDiarioDias ?? CONFIG_DIARIO_PADRAO.dias),
    templateId: row.checklistDiarioTemplateId || null,
    todos: row.checklistDiarioTodos !== false,
    tecnicos: [...new Set((row.checklistDiarioTecnicos ?? []).filter(Boolean))],
  };
}

const CHAVE = /^\d{4}-\d{2}-\d{2}$/;
export const chaveValida = (chave: unknown): chave is string => typeof chave === "string" && CHAVE.test(chave) && !Number.isNaN(Date.parse(`${chave}T12:00:00Z`));

/** Dia da semana (0 = domingo) de uma chave "AAAA-MM-DD" (dia civil; o meio-dia evita qualquer fuso) */
export function diaDaSemana(chave: string): number {
  return new Date(`${chave}T12:00:00Z`).getUTCDay();
}

/** "Hoje" em Brasília (chave AAAA-MM-DD), pelo relógio dado */
export const hojeBR = (agora: Date | number = Date.now()) => chaveDiaBR(agora);

/** A chave do dia `n` dias depois (ou antes, com n negativo) */
export function somarDias(chave: string, n: number): string {
  const d = new Date(`${chave}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** O dia exige checklist? Opção ligada, com modelo, e o dia da semana está entre os escolhidos */
export function diaExigeChecklist(config: ConfigChecklistDiario, chave: string): boolean {
  return config.ativo && !!config.templateId && config.dias.includes(diaDaSemana(chave));
}

/** O colaborador é obrigado? (todos com veículo padrão, ou só os escolhidos) */
export function colaboradorObrigado(config: ConfigChecklistDiario, tecnicoId: string): boolean {
  return config.todos || config.tecnicos.includes(tecnicoId);
}

/** Veículo que dá porteiro: existe e está em uso (inativo ou em manutenção, não há checklist a fazer) */
export const veiculoEmUso = (v: { status?: string | null } | null | undefined) => !!v && v.status !== "INATIVO" && v.status !== "MANUTENCAO";

/**
 * O que a página do app leva para o porteiro funcionar até sem sinal (a cópia guardada pelo navegador): os dias da
 * semana, o veículo, o modelo com os itens e o que o servidor já sabe de hoje. null = este colaborador não tem porteiro.
 */
export interface ResumoPorteiro {
  dias: number[];
  /** Hoje, pelo servidor, na hora em que a página foi montada */
  diaServidor: string;
  veiculo: { id: string; placa: string; modelo: string };
  modelo: { id: string; nome: string; itens: ItemDoModelo[] };
  /** O registro do servidor no dia `diaServidor` (null = nenhum ainda) */
  registro: { dia: string; situacao: SituacaoDiario } | null;
  /** D13 — o checklist feito hoje, para corrigir até o fim do dia (as respostas; a foto só "tem"). Ausente = nenhum. */
  feitoHoje?: { itens: { itemTemplateId: string; valor: string | null; temFoto: boolean }[]; observacaoGeral: string | null } | null;
}

/**
 * Hoje o porteiro aparece? Só com resumo (o servidor decidiu que o colaborador é obrigado), num dia de checklist, e
 * sem registro de hoje — nem no servidor nem no aparelho (o que ficou guardado para subir depois também libera).
 */
export function porteiroAberto(resumo: ResumoPorteiro | null | undefined, hoje: string, diasRegistradosNoAparelho: readonly string[] = []): boolean {
  if (!resumo || !chaveValida(hoje)) return false;
  if (!resumo.dias.includes(diaDaSemana(hoje))) return false;
  if (resumo.registro?.dia === hoje) return false;
  if (diasRegistradosNoAparelho.includes(hoje)) return false;
  return true;
}

/** O que o servidor faz com um envio do aparelho, diante do que já existe naquele dia para o colaborador */
export type DecisaoGravacao = "criar" | "repetido" | "trocar" | "manter" | "corrigir";

export function decidirGravacao(
  existente: { situacao: SituacaoDiario; clientId: string } | null | undefined,
  nova: { situacao: SituacaoDiario; clientId: string; correcao?: boolean },
): DecisaoGravacao {
  if (!existente) return "criar";
  if (existente.clientId === nova.clientId) return "repetido";
  if (existente.situacao === "NAO_VAI_USAR" && nova.situacao === "FEITO") return "trocar";
  // D13: o colaborador corrige o checklist feito (pedido explícito; um 2º checklist comum não passa por cima)
  if (existente.situacao === "FEITO" && nova.situacao === "FEITO" && nova.correcao) return "corrigir";
  return "manter";
}

export const MSG_CORRECAO_FORA_DO_DIA = "O checklist do veículo só pode ser corrigido no mesmo dia.";
export const MSG_CORRECAO_INATIVADO = "Este checklist foi excluído pelo escritório: não dá para corrigir.";

/**
 * D13 — a correção vale até o fim do dia do checklist: o toque (relógio do aparelho, já conferido com a chegada) tem
 * de ser no mesmo dia civil (Brasília). Feita sem sinal às 23h50 e enviada de manhã: vale (o toque foi no dia).
 */
export const correcaoNoPrazo = (diaDoChecklist: string, diaDoToque: string) => diaDoChecklist === diaDoToque;

/** D13 — o que mudou na correção, item a item (na ordem do modelo), e a observação. Nada mudou = []. */
export function mudancasDoChecklist(
  itens: readonly { id: string; descricao: string }[],
  antes: { itens: Record<string, { valor: string | null; temFoto: boolean }>; observacao: string | null },
  depois: { itens: Record<string, { valor: string | null; fotoNova: boolean }>; observacao: string | null },
): string[] {
  const m: string[] = [];
  const v = (x: string | null | undefined) => (x ?? "").trim();
  for (const it of itens) {
    const a = antes.itens[it.id], d = depois.itens[it.id];
    if (v(a?.valor) !== v(d?.valor)) m.push(`${it.descricao}: ${v(a?.valor) || "(sem)"} → ${v(d?.valor) || "(sem)"}`);
    if (d?.fotoNova) m.push(a?.temFoto ? `${it.descricao}: foto trocada` : `${it.descricao}: foto incluída`);
  }
  if (v(antes.observacao) !== v(depois.observacao)) m.push(`Observação: ${v(antes.observacao) ? `“${v(antes.observacao)}”` : "(sem)"} → ${v(depois.observacao) ? `“${v(depois.observacao)}”` : "(sem)"}`);
  return m;
}

/** Tolerância entre o toque e a chegada para não chamar de "sem sinal" um envio comum */
export const TOLERANCIA_ENVIO_MS = 5 * 60_000;
/** Até quantos dias atrás um registro guardado no aparelho ainda é aceito */
export const DIAS_ACEITOS_ATRAS = 30;

/**
 * Hora do toque (relógio do aparelho) conferida com a chegada: aparelho adiantado não grava "no futuro" (vale a
 * chegada). Chegou bem depois do toque = foi enviado sem sinal.
 */
export function horarioDoToque(feitoEm: string | Date | null | undefined, recebidoEm: Date): { feitoEm: Date; offline: boolean } {
  const t = feitoEm ? new Date(feitoEm) : null;
  if (!t || Number.isNaN(t.getTime()) || t.getTime() > recebidoEm.getTime() + TOLERANCIA_ENVIO_MS) return { feitoEm: recebidoEm, offline: false };
  return { feitoEm: t, offline: recebidoEm.getTime() - t.getTime() > TOLERANCIA_ENVIO_MS };
}

/** O dia informado pelo aparelho é aceito? Não pode ser depois de hoje (servidor) nem velho demais */
export function diaAceito(dia: string, hojeServidor: string): boolean {
  return chaveValida(dia) && dia <= hojeServidor && dia >= somarDias(hojeServidor, -DIAS_ACEITOS_ATRAS);
}

/** Situação de um dia no histórico do gestor */
export type SituacaoHistorico = "FEITO" | "COM_ALERTAS" | "NAO_VAI_USAR" | "SEM_REGISTRO" | "PENDENTE";

export const ROTULO_SITUACAO_HISTORICO: Record<SituacaoHistorico, string> = {
  FEITO: "Feito", COM_ALERTAS: "Com alertas", NAO_VAI_USAR: "Não vai usar", SEM_REGISTRO: "Sem registro", PENDENTE: "Ainda não fez",
};

/** Sem registro: dia passado = "Sem registro"; hoje (ainda pode fazer) = "Ainda não fez" */
export function situacaoNoHistorico(
  registro: { situacao: SituacaoDiario; comAlertas?: boolean } | null | undefined,
  dia: string, hoje: string,
): SituacaoHistorico {
  if (registro) return registro.situacao === "NAO_VAI_USAR" ? "NAO_VAI_USAR" : registro.comAlertas ? "COM_ALERTAS" : "FEITO";
  return dia < hoje ? "SEM_REGISTRO" : "PENDENTE";
}

export interface ObrigadoHistorico { tecnicoId: string; nome: string; veiculo: string | null }
export interface RegistroHistorico {
  id: string; tecnicoId: string; nome: string; dia: string; situacao: SituacaoDiario; comAlertas: boolean; veiculo: string | null;
  feitoEm: string; enviadoOffline: boolean; motivo: string | null; checklistId: string | null;
  situacaoAnterior: SituacaoDiario | null; trocadoEm: string | null;
}
export interface LinhaHistorico {
  chave: string; dia: string; tecnicoId: string; nome: string; veiculo: string | null; situacao: SituacaoHistorico;
  registro: RegistroHistorico | null;
}

/**
 * As linhas do histórico no período: cada registro gravado e, para cada dia de checklist (pela configuração ATUAL) e
 * cada colaborador obrigado HOJE sem registro naquele dia, uma linha "Sem registro" (dia passado) ou "Ainda não fez"
 * (hoje). Dias futuros não entram. Mais novo primeiro; no mesmo dia, por nome.
 */
export function linhasDoHistorico(p: {
  config: ConfigChecklistDiario; obrigados: readonly ObrigadoHistorico[]; registros: readonly RegistroHistorico[];
  de: string; ate: string; hoje: string;
}): LinhaHistorico[] {
  const linhas: LinhaHistorico[] = p.registros.filter((r) => r.dia >= p.de && r.dia <= p.ate && r.dia <= p.hoje).map((r) => ({
    chave: r.id, dia: r.dia, tecnicoId: r.tecnicoId, nome: r.nome, veiculo: r.veiculo, registro: r,
    situacao: situacaoNoHistorico(r, r.dia, p.hoje),
  }));
  const feitos = new Set(p.registros.map((r) => `${r.tecnicoId}|${r.dia}`));
  const fim = p.ate < p.hoje ? p.ate : p.hoje;
  // limite de segurança: no máximo ~1 ano de dias
  for (let dia = p.de, n = 0; dia <= fim && n < 400; dia = somarDias(dia, 1), n++) {
    if (!diaExigeChecklist(p.config, dia)) continue;
    for (const o of p.obrigados) {
      if (feitos.has(`${o.tecnicoId}|${dia}`)) continue;
      linhas.push({ chave: `${o.tecnicoId}|${dia}`, dia, tecnicoId: o.tecnicoId, nome: o.nome, veiculo: o.veiculo, registro: null, situacao: situacaoNoHistorico(null, dia, p.hoje) });
    }
  }
  return linhas.sort((a, b) => (a.dia === b.dia ? a.nome.localeCompare(b.nome, "pt-BR") : a.dia < b.dia ? 1 : -1));
}

export const MAX_MOTIVO = 300;
export const MSG_PORTEIRO_SEM_MODELO = "Escolha o modelo de checklist para ligar o checklist obrigatório.";
