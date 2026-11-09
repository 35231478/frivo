/**
 * Pontes de Zod para a padronização de caixa (lib/texto/normalizar.ts). Ficam separadas para o
 * normalizador em si continuar sem dependência de framework (testável e reusável no cliente). Use
 * estes transformadores no FINAL dos campos de texto dos schemas do servidor — a validação de
 * tamanho roda antes, a padronização grava a forma final.
 */
import { z } from "zod";
import { padronizarNome, padronizarEmail, apararTextoLivre, apararLinha } from "./normalizar";

const nulo = (v: unknown): v is null | undefined => v === null || v === undefined;

/** Nome próprio (cliente, colaborador, fornecedor, contato, equipe, cidade, endereço). Preserva nulo. */
export const caixaNome = <T extends string | null | undefined>(v: T): T =>
  (nulo(v) ? v : (padronizarNome(v) as T));

/** E-mail em minúsculo + trim. Preserva nulo. */
export const caixaEmail = <T extends string | null | undefined>(v: T): T =>
  (nulo(v) ? v : (padronizarEmail(v) as T));

/** Texto livre: só apara espaços (não muda o casing). Preserva nulo. */
export const caixaLivre = <T extends string | null | undefined>(v: T): T =>
  (nulo(v) ? v : (apararTextoLivre(v) as T));

/** Apara espaços de uma linha única, sem mudar o casing. Preserva nulo. */
export const caixaLinha = <T extends string | null | undefined>(v: T): T =>
  (nulo(v) ? v : (apararLinha(v) as T));

/** Campo Zod de nome próprio obrigatório (para os cadastros do registro). */
export const nomeProprioZod = (opts: { min?: number; max?: number; msg?: string } = {}) =>
  z.string().trim().min(opts.min ?? 1, opts.msg ?? "Nome é obrigatório.").max(opts.max ?? 200)
    .transform((v) => padronizarNome(v));
