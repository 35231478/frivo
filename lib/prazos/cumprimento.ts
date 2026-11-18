/**
 * CUMPRIMENTO DE PRAZOS — as regras do relatório (puras, sem banco e sem tela).
 *
 * O relatório não decide nada sozinho: ele LÊ a situação que as libs únicas já calcularam
 * (lib/atendimento/prazo.ts para o prazo de atendimento do contrato, lib/os/prazo-execucao.ts para o
 * prazo de execução) e a traduz nos quatro estados que o gestor e o cliente entendem.
 *
 * OS QUATRO ESTADOS — e as duas regras inegociáveis:
 *   • CUMPRIDO    — a promessa foi medida e atendida.
 *   • DESCUMPRIDO — a promessa foi medida e não foi atendida.
 *   • CAUSA_CLIENTE — foi medida, não foi atendida, e a gestão marcou na OS que a causa foi do
 *     cliente (falta de acesso, ausência do responsável, pendência dele). Fica à parte, fora do
 *     percentual, como prevê o contrato. Só sai de MARCAÇÃO EXPLÍCITA (lib/os/prazo-execucao ›
 *     atrasoPorCausaDoCliente): nunca do motivo sozinho, nunca do texto livre, nunca de adivinhação.
 *   • SEM_REGISTRO — a OS encerrou sem que ninguém medisse (o técnico não tocou "Cheguei", ou a OS
 *     foi cancelada com o prazo em aberto). NUNCA soma como descumprido: fica à parte, fora do
 *     percentual. É injusto afirmar um atraso que ninguém mediu — e é esse número que o gestor usa
 *     para cobrar o uso do "Cheguei".
 *
 * As duas saídas do percentual são de naturezas opostas e por isso não se misturam: "sem registro"
 * é prazo que ninguém mediu; "causa do cliente" é prazo medido, descumprido e explicado. Nenhuma das
 * duas some da tela nem do papel — as duas aparecem, com o motivo à vista.
 *
 * Prazo que ainda está correndo (ou que o contrato não promete) não tem estado: não entra no
 * relatório, porque não há o que relatar ainda.
 */
import { atendimentoDaOs, type SituacaoAtendimento } from "@/lib/atendimento/prazo";
import {
  atrasoPorCausaDoCliente, execucaoNoPrazo, haAtrasoParaJustificar, rotuloMotivoAtraso, type OsParaAtraso,
} from "@/lib/os/prazo-execucao";

/* ───────── os quatro estados ───────── */

export const ESTADOS = ["CUMPRIDO", "DESCUMPRIDO", "CAUSA_CLIENTE", "SEM_REGISTRO"] as const;
export type EstadoCumprimento = (typeof ESTADOS)[number];

export const ROTULO_ESTADO: Record<EstadoCumprimento, string> = {
  CUMPRIDO: "Cumprido", DESCUMPRIDO: "Descumprido", CAUSA_CLIENTE: "Causa do cliente", SEM_REGISTRO: "Sem registro",
};

/** O que cada estado quer dizer, na própria tela e no PDF — sem jargão e sem rodeio. */
export const LEGENDA_ESTADO: Record<EstadoCumprimento, string> = {
  CUMPRIDO: "O prazo foi medido e atendido.",
  DESCUMPRIDO: "O prazo foi medido e não foi atendido.",
  CAUSA_CLIENTE: "O prazo não foi atendido por uma causa do cliente — falta de acesso ao local, ausência do responsável ou pendência dele —, conferida e marcada pela gestão na ordem de serviço. Fica fora do percentual, como prevê o contrato, e aparece aqui com o motivo à vista.",
  SEM_REGISTRO: "A OS encerrou sem o registro que mede este prazo (o técnico não tocou “Cheguei”). Fica fora do percentual: não afirmamos atraso que ninguém mediu.",
};

/* ───────── de cada prazo para o estado ───────── */

/**
 * A situação de um prazo de ATENDIMENTO (lib/atendimento/prazo.ts) no estado do relatório.
 * `null` = ainda correndo, ou o contrato não promete nada: nada a relatar.
 */
export function estadoDoAtendimento(situacao: SituacaoAtendimento): EstadoCumprimento | null {
  switch (situacao) {
    case "CUMPRIDO": return "CUMPRIDO";
    // Cumprido fora do prazo e estourado são a mesma coisa para o cliente: a promessa não foi atendida
    case "CUMPRIDO_FORA": case "ESTOURADO": return "DESCUMPRIDO";
    case "SEM_REGISTRO": return "SEM_REGISTRO";
    default: return null; // SEM_PRAZO, NO_PRAZO, VENCENDO
  }
}

/** A OS como as DUAS libs de prazo a leem: só o que decide os estados (sem nada de tela). */
export interface OsComPrazos extends OsParaAtraso {
  chamadoAbertoEm?: Date | string | null;
  atendimentoComparecerAte?: Date | string | null;
  atendimentoResolverAte?: Date | string | null;
  atendimentoComparecidoEm?: Date | string | null;
}

/** A OS como o relatório precisa dela: o que as duas libs leem, mais o que a tela mostra. */
export interface OsDoCumprimento extends OsComPrazos {
  id: string;
  numero: string;
  chamadoNumero?: string | null;
  clienteNome: string;
  contratoNumero?: string | null;
  atrasoJustificadoMotivo?: string | null;
  atrasoJustificadoObs?: string | null;
  atrasoResponsavel?: string | null;
  criadoEm: Date | string;
}

/**
 * O estado do PRAZO DE EXECUÇÃO (o compromisso interno: até que dia a OS termina). Quem decide é a
 * regra única do sistema (`execucaoNoPrazo`, lib/os/prazo-execucao.ts) — aqui só se traduz o que ela
 * diz. Note que o prazo de execução não tem "sem registro": a conclusão da OS é o registro, e ele
 * sempre existe quando ela foi concluída.
 */
export function estadoDaExecucao(os: OsParaAtraso, agora: Date = new Date()): EstadoCumprimento | null {
  const noPrazo = execucaoNoPrazo(os, agora);
  return noPrazo === null ? null : noPrazo ? "CUMPRIDO" : "DESCUMPRIDO";
}

/**
 * O estado CRU de cada prazo da OS — sem nada de tela e ANTES da pausa. É daqui que saem a linha do
 * relatório e a resposta a "há o que justificar?": uma conta só, dois usos. A pausa vem depois, em
 * `linhaDoCumprimento`, de propósito: o botão "Justificar atraso" tem de continuar aparecendo na OS
 * já marcada, para o gestor poder alterar ou desfazer o que marcou.
 */
export function estadosDosPrazos(os: OsComPrazos, agora: Date = new Date()): Record<PrazoRelatado, EstadoCumprimento | null> {
  const { comparecer, resolver } = atendimentoDaOs(os, agora);
  return {
    comparecer: estadoDoAtendimento(comparecer.situacao),
    resolver: estadoDoAtendimento(resolver.situacao),
    execucao: estadoDaExecucao(os, agora),
  };
}

/**
 * Há descumprimento a justificar nesta OS? Justificar serve exatamente para explicar o que o
 * relatório chamaria de DESCUMPRIDO — qualquer um dos três prazos (comparecer, resolver, execução) —
 * mais o atraso de atividade, que só o desempenho enxerga.
 *
 * Antes isto era só `haAtrasoParaJustificar` (prazo de execução e atividades): o chamado que estourou
 * o "comparecer" porque o cliente não deu acesso não tinha como ser justificado, logo não tinha como
 * ser classificado — e é justamente o caso que pausa o SLA no papel do cliente.
 */
export function haDescumprimentoParaJustificar(os: OsComPrazos, agora: Date = new Date()): boolean {
  const estados = estadosDosPrazos(os, agora);
  return PRAZOS.some((p) => estados[p] === "DESCUMPRIDO") || haAtrasoParaJustificar(os, agora);
}

/* ───────── uma linha do relatório ───────── */

/** Os três prazos de uma OS, cada um no seu estado (ou `null` quando não há o que relatar). */
export interface LinhaCumprimento {
  id: string;
  /** O número que o cliente conhece: o do chamado quando existe, senão o da OS */
  numero: string;
  clienteNome: string;
  contratoNumero: string | null;
  /** Quando o cliente abriu o chamado; sem chamado, quando a OS foi aberta */
  abertura: Date;
  status: string;
  comparecer: EstadoCumprimento | null;
  resolver: EstadoCumprimento | null;
  execucao: EstadoCumprimento | null;
  /** O motivo que a gestão gravou ao justificar o atraso (PR 2), quando há */
  justificativa: string | null;
  /** O motivo por extenso, pronto para a tela e o papel ("Acesso ao local negado"); "" quando não há */
  motivo: string;
}

/**
 * A PAUSA, num lugar só: um prazo DESCUMPRIDO vira CAUSA_CLIENTE quando — e apenas quando — a gestão
 * marcou na OS que a causa foi do cliente. Três coisas que esta linha garante, e que os testes
 * travam:
 *   • a pausa só mexe no que já era descumprido. "Sem registro" nunca vira pausa (ninguém mediu), e
 *     cumprido nunca muda de estado;
 *   • o denominador só pode encolher com a pausa, nunca crescer: nada entra em DESCUMPRIDO por aqui;
 *   • sem marcação, nada muda — o justificado sem causa do cliente segue descumprido, como sempre foi.
 */
const comPausa = (e: EstadoCumprimento | null, pausa: boolean): EstadoCumprimento | null =>
  pausa && e === "DESCUMPRIDO" ? "CAUSA_CLIENTE" : e;

export function linhaDoCumprimento(os: OsDoCumprimento, agora: Date = new Date()): LinhaCumprimento {
  const estados = estadosDosPrazos(os, agora);
  // a marcação explícita do gestor (lib/os/prazo-execucao): nunca o motivo sozinho, nunca o texto livre
  const pausa = atrasoPorCausaDoCliente(os);
  return {
    id: os.id,
    numero: os.chamadoNumero || os.numero,
    clienteNome: os.clienteNome,
    contratoNumero: os.contratoNumero ?? null,
    abertura: new Date(os.chamadoAbertoEm ?? os.criadoEm),
    status: os.status,
    comparecer: comPausa(estados.comparecer, pausa),
    resolver: comPausa(estados.resolver, pausa),
    execucao: comPausa(estados.execucao, pausa),
    justificativa: os.atrasoJustificadoMotivo || null,
    motivo: rotuloMotivoAtraso(os.atrasoJustificadoMotivo),
  };
}

/** Este estado é a pausa? A tela e o papel perguntam aqui em vez de escrever o nome do estado. */
export const ehPausa = (e: EstadoCumprimento | null) => e === "CAUSA_CLIENTE";

/** A linha teve algum prazo fora da conta por causa do cliente? */
export const linhaPausada = (l: LinhaCumprimento) => PRAZOS.some((p) => ehPausa(l[p]));

/** A linha tem algo a relatar? Sem nenhum dos três prazos decidido, ela não entra. */
export const linhaRelata = (l: LinhaCumprimento) => !!(l.comparecer || l.resolver || l.execucao);

/* ───────── a conta ───────── */

export interface Contagem { cumpridos: number; descumpridos: number; causaCliente: number; semRegistro: number }

export const CONTAGEM_ZERO = (): Contagem => ({ cumpridos: 0, descumpridos: 0, causaCliente: 0, semRegistro: 0 });

/**
 * Quantos prazos foram MEDIDOS **e contam**. É o denominador do percentual — e nem o "sem registro"
 * nem a "causa do cliente" estão nele, de propósito: são as duas regras inegociáveis do relatório.
 */
export const medidos = (c: Contagem) => c.cumpridos + c.descumpridos;

/** Tudo o que o relatório conta: os que contam, mais os dois baldes que ficam de fora. */
export const total = (c: Contagem) => medidos(c) + c.semRegistro + c.causaCliente;

/**
 * O percentual de cumprimento: cumpridos sobre os MEDIDOS, arredondado ao inteiro. `null` quando
 * nada foi medido (nada a afirmar — a tela e o PDF mostram "—", nunca 0%).
 */
export function percentualCumprimento(c: Contagem): number | null {
  const base = medidos(c);
  return base === 0 ? null : Math.round((c.cumpridos / base) * 100);
}

/** "92%" · "—" quando nada foi medido */
export const textoPercentual = (c: Contagem) => {
  const p = percentualCumprimento(c);
  return p === null ? "—" : `${p}%`;
};

export function contar(estados: (EstadoCumprimento | null)[]): Contagem {
  const c = CONTAGEM_ZERO();
  for (const e of estados) {
    if (e === "CUMPRIDO") c.cumpridos++;
    else if (e === "DESCUMPRIDO") c.descumpridos++;
    else if (e === "CAUSA_CLIENTE") c.causaCliente++;
    else if (e === "SEM_REGISTRO") c.semRegistro++;
  }
  return c;
}

/* ───────── o resumo do período ───────── */

export const PRAZOS = ["comparecer", "resolver", "execucao"] as const;
export type PrazoRelatado = (typeof PRAZOS)[number];

/** Cada prazo com o seu nome na tela e no papel — "prazo de atendimento" ≠ "prazo de execução". */
export const ROTULO_PRAZO: Record<PrazoRelatado, string> = {
  comparecer: "Comparecer", resolver: "Resolver", execucao: "Prazo de execução",
};
export const AJUDA_PRAZO: Record<PrazoRelatado, string> = {
  comparecer: "Prazo de atendimento do contrato: em quantas horas o técnico comparece, contadas da abertura do chamado.",
  resolver: "Prazo de atendimento do contrato: em quantas horas o chamado é resolvido, contadas da abertura.",
  execucao: "O compromisso interno com a equipe: até que dia a OS precisa estar concluída.",
};

export interface ResumoCumprimento {
  comparecer: Contagem;
  resolver: Contagem;
  execucao: Contagem;
  /** Os três somados: o número que resume o período */
  geral: Contagem;
  /** Quantas OS/chamados o relatório olhou */
  linhas: number;
}

export function resumoCumprimento(linhas: LinhaCumprimento[]): ResumoCumprimento {
  const comparecer = contar(linhas.map((l) => l.comparecer));
  const resolver = contar(linhas.map((l) => l.resolver));
  const execucao = contar(linhas.map((l) => l.execucao));
  const geral = contar(linhas.flatMap((l) => [l.comparecer, l.resolver, l.execucao]));
  return { comparecer, resolver, execucao, geral, linhas: linhas.length };
}

/* ───────── o que a tela e o PDF dizem ───────── */

/** A frase que explica, em todo lugar, por que o "sem registro" não entra na conta. */
export const NOTA_SEM_REGISTRO =
  "Os casos sem registro ficam fora do percentual: a OS encerrou sem o registro que mede o prazo, e não afirmamos um atraso que ninguém mediu.";

/**
 * A frase que explica a pausa, em linguagem de cliente — a mesma na tela, no papel e em qualquer
 * conversa sobre o número. Sem jargão: quem lê o relatório não precisa saber o que é "SLA".
 */
export const NOTA_CAUSA_CLIENTE =
  "Os prazos com causa do cliente — falta de acesso ao local, ausência do responsável ou pendência dele — ficam fora do percentual, como prevê o contrato. Eles continuam listados, com o motivo à vista: nada é escondido, apenas não é cobrado de quem não causou.";

/** "12 de 13 prazos cumpridos" · "nenhum prazo medido" */
export function textoMedidos(c: Contagem): string {
  const base = medidos(c);
  return base === 0 ? "nenhum prazo medido" : `${c.cumpridos} de ${base} ${base === 1 ? "prazo cumprido" : "prazos cumpridos"}`;
}

/** "1 sem registro, fora da conta" · "" quando não há nenhum */
export const textoSemRegistro = (c: Contagem) => (c.semRegistro === 0 ? "" : `${c.semRegistro} sem registro, fora da conta`);

/** "2 por causa do cliente, fora da conta" · "" quando não há nenhum */
export const textoCausaCliente = (c: Contagem) =>
  c.causaCliente === 0 ? "" : `${c.causaCliente} por causa do cliente, fora da conta`;

/**
 * "12 de 13 prazos cumpridos · 1 sem registro, fora da conta · 2 por causa do cliente, fora da
 * conta" — a tela e o papel dizem o mesmo, e o que saiu da conta é dito em voz alta, não omitido.
 */
export const textoDaContagem = (c: Contagem) =>
  [textoMedidos(c), textoSemRegistro(c), textoCausaCliente(c)].filter(Boolean).join(" · ");
