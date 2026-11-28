"use client";

/**
 * O que o FormField conta aos campos de dentro dele (Input, Select, Textarea, telefone, WhatsApp, data, hora,
 * seletor com busca…): se o campo está com erro e qual texto o descreve. Assim o erro marca o campo (borda
 * vermelha + aria-invalid + aria-describedby) sem cada formulário repetir `error={…}` em cada controle.
 * O que o controle recebe explicitamente (`error`, `aria-invalid`, `aria-describedby`) sempre vale mais.
 */
import { createContext, useContext } from "react";

export interface CampoContexto {
  /** O campo está com erro */
  invalido: boolean;
  /** Ids do texto de erro/dica abaixo do campo (aria-describedby) */
  descricaoId?: string;
}

export const CampoCtx = createContext<CampoContexto | null>(null);

export const useCampo = () => useContext(CampoCtx);

/** Junta ids de aria-describedby sem repetir */
export function juntarIds(...ids: (string | undefined | null | false)[]): string | undefined {
  const r = Array.from(new Set(ids.flatMap((i) => (i ? i.split(/\s+/) : [])).filter(Boolean)));
  return r.length ? r.join(" ") : undefined;
}

/**
 * As props de acessibilidade/erro de um controle dentro de um FormField: o explícito ganha do contexto.
 * `error` (boolean) é a borda vermelha.
 */
export function propsDoCampo(
  campo: CampoContexto | null,
  p: { error?: boolean; "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling"; "aria-describedby"?: string },
) {
  const error = p.error ?? (campo?.invalido || false);
  const ariaInvalid = p["aria-invalid"] ?? (error ? true : undefined);
  return { error, "aria-invalid": ariaInvalid, "aria-describedby": juntarIds(p["aria-describedby"], campo?.descricaoId) };
}
