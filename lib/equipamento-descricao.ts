import { LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";

/**
 * Como um equipamento é apresentado (lista, relatório da OS, PMOC…), separando
 * sempre O QUE é (tipo + potência) de ONDE está (ambiente/setor):
 *   Equipamento: "Split Piso Teto — 48.000 BTU/h"    Ambiente: "Recepção" (2º andar)
 * Arquivo puro: pode ser usado no servidor e no cliente.
 */

/** "48000 BTU/h" → "48.000 BTU/h"; "48000" → "48.000 BTU/h"; "5 TR" fica igual. */
export function formatarCapacidade(cap: string | null | undefined): string | null {
  const txt = (cap ?? "").trim();
  if (!txt) return null;
  const m = /^([\d.,]+)\s*(BTU\/h|BTU|TR)?$/i.exec(txt);
  if (!m) return txt;
  const unidade = (m[2] ?? "BTU/h").toUpperCase() === "TR" ? "TR" : "BTU/h";
  const num = Number(m[1].replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(num)) return txt;
  const valor = unidade === "TR" ? num.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : Math.round(num).toLocaleString("pt-BR");
  return `${valor} ${unidade}`;
}

export function rotuloTipoEquipamento(e: { tipo: string; tipoEquipamento?: { nome: string } | null; tipoLabel?: string | null }): string {
  return e.tipoLabel ?? e.tipoEquipamento?.nome ?? LABELS_TIPO_EQUIPAMENTO[e.tipo] ?? e.tipo;
}

/** "Split Piso Teto — 48.000 BTU/h" (sem capacidade: só o tipo). */
export function descricaoEquipamento(e: { tipo: string; capacidade?: string | null; tipoEquipamento?: { nome: string } | null; tipoLabel?: string | null }): string {
  const cap = formatarCapacidade(e.capacidade);
  const tipo = rotuloTipoEquipamento(e);
  return cap ? `${tipo} — ${cap}` : tipo;
}

/** "LG S4-W12JA3AA" — identificação de fabricante. */
export function fabricanteModelo(e: { marca?: string | null; modelo?: string | null }): string {
  return [e.marca, e.modelo].filter(Boolean).join(" ");
}

/**
 * Ambiente principal (sala) e o complemento (setor/andar). Sem ambiente, o setor
 * sobe para o principal; sem nenhum dos dois, usa o endereço/unidade como reserva.
 */
export function ambienteEquipamento(e: { localizacao?: string | null; ambiente?: string | null; setor?: string | null }, reserva?: string | null): { principal: string | null; complemento: string | null; informado: boolean } {
  const amb = (e.localizacao ?? e.ambiente ?? "").trim() || null;
  const setor = (e.setor ?? "").trim() || null;
  if (amb) return { principal: amb, complemento: setor, informado: true };
  if (setor) return { principal: setor, complemento: null, informado: true };
  // Sem ambiente cadastrado: mostra a unidade, deixando claro que a sala não foi informada
  return { principal: reserva?.trim() || null, complemento: reserva?.trim() ? "ambiente não informado" : null, informado: false };
}
