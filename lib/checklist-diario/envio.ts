/**
 * Checklist obrigatório no app — o ENVIO do aparelho (puro: o app monta, o servidor valida com o mesmo esquema).
 * Cada envio tem um client_id próprio (uuid): reenviar não duplica.
 */
import { z } from "zod";
import { MAX_MOTIVO } from "@/lib/checklist-diario/regras";

const id = z.string().min(1).max(64);
const chave = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dia inválido.");

export const itemEnviadoSchema = z.object({
  itemTemplateId: id,
  valor: z.string().max(2000).nullable().optional(),
  /** Foto já comprimida no aparelho (data URL) */
  foto: z.string().max(3_000_000, "Foto grande demais.").nullable().optional(),
}).strict();

const base = {
  clientId: z.string().uuid("Envio sem identificador válido."),
  dia: chave,
  /** Relógio do aparelho na hora do toque (ISO) */
  feitoEm: z.string().max(40),
  veiculoId: id,
};

export const envioDiarioSchema = z.discriminatedUnion("situacao", [
  z.object({
    ...base,
    situacao: z.literal("FEITO"),
    templateId: id,
    itens: z.array(itemEnviadoSchema).max(200),
    observacaoGeral: z.string().max(2000).nullable().optional(),
    /** D13 — corrige o checklist feito HOJE (até o fim do dia): item sem foto nova mantém a que já estava */
    correcao: z.literal(true).optional(),
  }).strict(),
  z.object({
    ...base,
    situacao: z.literal("NAO_VAI_USAR"),
    motivo: z.string().max(MAX_MOTIVO, `Motivo: até ${MAX_MOTIVO} caracteres.`).nullable().optional(),
  }).strict(),
]);
export type EnvioDiario = z.infer<typeof envioDiarioSchema>;

/** O que o servidor responde ao aparelho */
export type RespostaEnvioDiario =
  | { ok: true; acao: "criar" | "repetido" | "trocar" | "manter" | "ignorado" | "corrigir"; registro: { dia: string; situacao: "FEITO" | "NAO_VAI_USAR" } | null }
  | { ok: false; erro: string };
