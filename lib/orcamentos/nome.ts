/**
 * Nome automático do orçamento — curto, legível, instantâneo e sem IA:
 *   [o quê] — [cliente]
 *   - o quê: o tipo da OS ("Manutenção Corretiva"); sem OS, o 1º item ("Limpeza de split +2");
 *     sem nada, "Orçamento".
 *   - as partes vão INTEIRAS: o nome aparece no documento do cliente ("Objeto da proposta"), na OS e no
 *     app, e um "Limpeza completa de split…" ali parecia erro ("Pronto pra janeiro 2", H). Quem corta
 *     para caber numa linha é a LISTA, só na tela. Só um teto de segurança (NOME_AUTO_MAX = o do nome
 *     digitado) corta, na palavra, um nome fora do comum.
 * A tela mostra a prévia; ao salvar com o nome em branco, o servidor compõe com a MESMA função.
 * Nome digitado pelo usuário é sempre respeitado (até NOME_MAX). Orçamentos já gravados não mudam.
 */

export interface ContextoNomeOrcamento {
  tipoOs?: string | null;
  cliente?: string | null;
  /** Mantidos no contexto (a OS traz), mas não entram mais no nome: deixavam o nome longo demais */
  unidade?: string | null;
  equipamento?: string | null;
  /** Descrições dos itens, serviços primeiro */
  itens?: (string | null | undefined)[];
}

/** Teto do nome digitado */
export const NOME_MAX = 120;
/** Teto de segurança do nome automático: o mesmo do nome digitado (o corte visual é da lista) */
export const NOME_AUTO_MAX = NOME_MAX;

const espacos = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Corta no limite, de preferência numa palavra inteira, com "…" (sem pontuação pendurada). */
export function cortarTexto(s: string | null | undefined, max: number): string {
  const t = espacos(s);
  if (t.length <= max) return t;
  let corte = t.slice(0, max - 1);
  const espaco = corte.lastIndexOf(" ");
  // A palavra só é cortada ao meio quando não há espaço razoável antes; se o corte já cai no fim de
  // uma palavra, ela fica inteira
  if (t[max - 1] !== " " && espaco >= Math.floor(max * 0.6)) corte = corte.slice(0, espaco);
  return `${corte.replace(/[\s,;:.·—–-]+$/, "")}…`;
}

export function nomeAutomaticoOrcamento(c: ContextoNomeOrcamento): string {
  const itens = (c.itens ?? []).map(espacos).filter(Boolean);
  let oQue = espacos(c.tipoOs);
  if (!oQue && itens.length) {
    const resto = itens.length - 1;
    oQue = `${itens[0]}${resto > 0 ? ` +${resto}` : ""}`;
  }
  const partes = [oQue || "Orçamento", espacos(c.cliente)].filter(Boolean);
  return cortarTexto(partes.join(" — "), NOME_AUTO_MAX);
}

/** O nome que vale: o digitado (aparado) ou o automático quando vazio */
export const nomeFinalOrcamento = (digitado: string | null | undefined, c: ContextoNomeOrcamento) =>
  cortarTexto(digitado, 200) || nomeAutomaticoOrcamento(c);

/** Rótulo do equipamento para o nome: o apelido, ou marca + modelo */
export const rotuloEquipamentoNome = (e: { nome?: string | null; marca?: string | null; modelo?: string | null } | null | undefined) =>
  !e ? "" : (e.nome?.trim() || [e.marca, e.modelo].filter(Boolean).join(" ").trim());
