/**
 * HISTÓRICO DA OS para o gestor: o que aconteceu, em linhas que se leem de relance.
 *
 * O registro (os_historico) é de auditoria: cada foto, cada item executado, cada edição e cada mudança
 * automática de status vira uma linha, com o código interno do status ("AGENDADA → EM_ANDAMENTO (app do
 * técnico)"). Um dia de campo enchia o cartão de linhas repetidas. Aqui, sem apagar nada:
 *  - AGRUPA eventos seguidos da mesma família, da mesma pessoa, sem pausa longa entre eles
 *    ("4 fotos adicionadas", "3 itens executados", "Atividade “X” editada · data agendada, técnico");
 *  - JUNTA o "Status automático" ao evento que o causou, como consequência ("Atividade iniciada" · OS em
 *    execução) — sozinho, ele vira "OS em execução";
 *  - TRADUZ os códigos de status para as palavras da tela;
 *  - GUARDA os registros originais de cada linha (`itens`), para o detalhe sob demanda e a auditoria.
 *
 * Função pura: a tela (components/os/central/resumo-os) só desenha.
 */
import { ROTULO_ESTAGIO, type EstagioOs } from "@/lib/os/status";

export interface EventoHistorico {
  id: string;
  acao: string;
  detalhes?: string | null;
  criadoEm: Date | string;
  usuario?: { nome?: string | null } | null;
}

export interface LinhaHistorico {
  /** O id do registro mais recente da linha (chave estável) */
  id: string;
  titulo: string;
  detalhe: string | null;
  /** O que o evento causou na OS (o "Status automático" que veio junto): "OS em execução" */
  consequencia: string | null;
  quem: string;
  /** O momento do registro mais recente e o do mais antigo da linha */
  quando: Date | string;
  desde: Date | string;
  /** Quantos registros a linha resume (1 = um evento só) */
  quantidade: number;
  /** Os registros originais, do mais recente ao mais antigo — o detalhe e a auditoria */
  itens: EventoHistorico[];
}

/** Eventos seguidos com mais que isto entre um e outro não se agrupam (são outro momento do dia). */
export const PAUSA_AGRUPAR_MS = 60 * 60_000;
/** O "Status automático" até este tempo depois de um evento é consequência dele. */
export const JANELA_CONSEQUENCIA_MS = 2 * 60_000;

const ACAO_STATUS_AUTO = "Status automático";
const ACAO_STATUS_ATIVIDADE = "Status da atividade alterado";

const ROTULO_STATUS_OS: Record<string, string> = {
  ...Object.fromEntries((Object.keys(ROTULO_ESTAGIO) as EstagioOs[]).map((k) => [k, ROTULO_ESTAGIO[k]])),
  AGUARDANDO_ATENDIMENTO: "Aguardando atendimento", PAUSADA: "Pausada", AGUARDANDO_PECA: "Aguardando peça",
};
const TITULO_ATIVIDADE: Record<string, string> = {
  EM_ANDAMENTO: "Atividade iniciada", CONCLUIDA: "Atividade concluída", CANCELADA: "Atividade cancelada", AGENDADA: "Atividade voltou para agendada",
};

/** Plural das famílias que mais se repetem; o resto vira "Ação (N vezes)". */
const PLURAL: Record<string, (n: number) => string> = {
  "Foto adicionada": (n) => `${n} fotos adicionadas`,
  "Foto excluída": (n) => `${n} fotos excluídas`,
  "Documento adicionado": (n) => `${n} documentos adicionados`,
  "Documento excluído": (n) => `${n} documentos excluídos`,
  "Item executado": (n) => `${n} itens executados`,
  "Atividade adicionada": (n) => `${n} atividades adicionadas`,
  "Item de orçamento adicionado": (n) => `${n} itens adicionados à OS`,
  "Item da OS editado": (n) => `${n} itens da OS editados`,
};

const ms = (d: Date | string) => new Date(d).getTime();
const semApp = (t: string) => t.replace(/\s*\(app do técnico\)\s*$/i, "").trim();
/** O título da atividade no começo do detalhe: "\"Manutenção\": ..." → Manutenção */
const atividadeDoDetalhe = (d: string | null | undefined) => /^"([^"]+)"/.exec(d ?? "")?.[1] ?? null;
const depoisDaSeta = (d: string | null | undefined) => /→\s*([A-Z_]+)/.exec(d ?? "")?.[1] ?? null;

/** "OS em execução", "OS concluída"… (o alvo do status automático) */
export function textoStatusOs(alvo: string | null): string | null {
  if (!alvo) return null;
  const r = ROTULO_STATUS_OS[alvo];
  return r ? `OS ${r.charAt(0).toLowerCase()}${r.slice(1)}` : null;
}

/** Um evento como o gestor lê: título sem código, detalhe sem o rabicho técnico. */
export function traduzir(e: EventoHistorico): { titulo: string; detalhe: string | null } {
  const det = e.detalhes ? semApp(e.detalhes) : null;
  if (e.acao === ACAO_STATUS_AUTO) return { titulo: textoStatusOs(depoisDaSeta(e.detalhes)) ?? "Status da OS atualizado", detalhe: null };
  if (e.acao === ACAO_STATUS_ATIVIDADE) {
    const alvo = depoisDaSeta(e.detalhes);
    return { titulo: (alvo && TITULO_ATIVIDADE[alvo]) || "Status da atividade alterado", detalhe: atividadeDoDetalhe(e.detalhes) };
  }
  if (e.acao === "Atividade editada") {
    const atv = atividadeDoDetalhe(e.detalhes);
    const oque = det?.replace(/^"[^"]+":\s*/, "") || null;
    return { titulo: atv ? `Atividade “${atv}” editada` : "Atividade editada", detalhe: oque };
  }
  return { titulo: e.acao, detalhe: det || null };
}

/** A família de um evento: só eventos da mesma família se agrupam. */
function familia(e: EventoHistorico): string {
  if (e.acao === "Atividade editada") return `${e.acao}|${atividadeDoDetalhe(e.detalhes) ?? ""}`;
  if (PLURAL[e.acao]) return e.acao;
  // O resto só se agrupa quando é o MESMO registro repetido (mesma ação e mesmo detalhe)
  return `${e.acao}|${e.detalhes ?? ""}`;
}

/** Os detalhes distintos de um grupo, juntos: os três primeiros e "e mais N". */
function juntarDetalhes(detalhes: (string | null)[], separador = "; "): string | null {
  const unicos = [...new Set(detalhes.filter((d): d is string => !!d))];
  if (!unicos.length) return null;
  return unicos.length <= 3 ? unicos.join(separador) : `${unicos.slice(0, 3).join(separador)} e mais ${unicos.length - 3}`;
}

/**
 * Resume o histórico (em qualquer ordem) em linhas para o gestor, da mais recente para a mais antiga.
 * Nenhum registro se perde: a soma de `quantidade` das linhas mais as consequências é o total de registros.
 */
export function resumirHistorico(eventos: EventoHistorico[]): LinhaHistorico[] {
  const asc = [...eventos].sort((a, b) => ms(a.criadoEm) - ms(b.criadoEm) || a.id.localeCompare(b.id));
  type Grupo = { fam: string; quem: string; itens: EventoHistorico[]; consequencias: EventoHistorico[] };
  const grupos: Grupo[] = [];

  for (const e of asc) {
    const quem = e.usuario?.nome ?? "";
    const ultimo = grupos[grupos.length - 1];
    const fimDoUltimo = ultimo ? ms(ultimo.itens[ultimo.itens.length - 1].criadoEm) : -Infinity;

    // O status automático logo depois de um evento é consequência dele (não é uma linha própria)
    if (e.acao === ACAO_STATUS_AUTO && ultimo && ultimo.fam !== ACAO_STATUS_AUTO && ms(e.criadoEm) - fimDoUltimo <= JANELA_CONSEQUENCIA_MS && !ultimo.consequencias.length) {
      ultimo.consequencias.push(e);
      continue;
    }
    const fam = e.acao === ACAO_STATUS_AUTO ? ACAO_STATUS_AUTO : familia(e);
    if (ultimo && ultimo.fam === fam && ultimo.quem === quem && !ultimo.consequencias.length
      && e.acao !== ACAO_STATUS_AUTO && ms(e.criadoEm) - fimDoUltimo <= PAUSA_AGRUPAR_MS) {
      ultimo.itens.push(e);
      continue;
    }
    grupos.push({ fam, quem, itens: [e], consequencias: [] });
  }

  return grupos.reverse().map((g) => {
    const recente = g.itens[g.itens.length - 1];
    const n = g.itens.length;
    const base = traduzir(recente);
    let titulo = base.titulo;
    let detalhe = base.detalhe;
    if (n > 1) {
      const acao = recente.acao;
      if (acao === "Atividade editada") {
        // "data agendada" + "técnico" → "data agendada, técnico" (sem repetir)
        detalhe = juntarDetalhes(g.itens.map((x) => traduzir(x).detalhe), ", ");
      } else {
        titulo = PLURAL[acao] ? PLURAL[acao](n) : `${base.titulo} (${n} vezes)`;
        detalhe = juntarDetalhes(g.itens.map((x) => traduzir(x).detalhe));
      }
    }
    const consequencia = g.consequencias.length ? textoStatusOs(depoisDaSeta(g.consequencias[0].detalhes)) : null;
    return {
      id: recente.id, titulo, detalhe, consequencia, quem: g.quem,
      quando: recente.criadoEm, desde: g.itens[0].criadoEm, quantidade: n,
      itens: [...g.itens, ...g.consequencias].sort((a, b) => ms(b.criadoEm) - ms(a.criadoEm) || b.id.localeCompare(a.id)),
    };
  });
}
