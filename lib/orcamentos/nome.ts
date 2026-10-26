/**
 * Nome automático do orçamento — regra de composição legível, instantânea e sem IA:
 *   [o quê] — [equipamento principal] — [cliente · unidade]
 *   - o quê: o tipo da OS ("Manutenção Corretiva"); sem OS, o 1º item ("Limpeza de split + 2 itens");
 *     sem nada, "Orçamento".
 * A tela mostra a prévia; ao salvar com o nome em branco, o servidor compõe com a MESMA função.
 * Nome digitado pelo usuário é sempre respeitado.
 */

export interface ContextoNomeOrcamento {
  tipoOs?: string | null;
  cliente?: string | null;
  unidade?: string | null;
  equipamento?: string | null;
  /** Descrições dos itens, serviços primeiro */
  itens?: (string | null | undefined)[];
}

export const NOME_MAX = 120;

const limpa = (s: string | null | undefined, max: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

export function nomeAutomaticoOrcamento(c: ContextoNomeOrcamento): string {
  const itens = (c.itens ?? []).map((i) => limpa(i, 50)).filter(Boolean);
  let oQue = limpa(c.tipoOs, 50);
  if (!oQue && itens.length) {
    const resto = itens.length - 1;
    oQue = resto > 0 ? `${itens[0]} + ${resto} ${resto === 1 ? "item" : "itens"}` : itens[0];
  }
  const local = [limpa(c.cliente, 50), limpa(c.unidade, 40)].filter(Boolean).join(" · ");
  const partes = [oQue || "Orçamento", limpa(c.equipamento, 40), local].filter(Boolean);
  return limpa(partes.join(" — "), NOME_MAX);
}

/** O nome que vale: o digitado (aparado) ou o automático quando vazio */
export const nomeFinalOrcamento = (digitado: string | null | undefined, c: ContextoNomeOrcamento) =>
  limpa(digitado, 200) || nomeAutomaticoOrcamento(c);

/** Rótulo do equipamento para o nome: o apelido, ou marca + modelo */
export const rotuloEquipamentoNome = (e: { nome?: string | null; marca?: string | null; modelo?: string | null } | null | undefined) =>
  !e ? "" : (e.nome?.trim() || [e.marca, e.modelo].filter(Boolean).join(" ").trim());
