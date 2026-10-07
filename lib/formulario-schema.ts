import { z } from "zod";
import { TipoCampo } from "@prisma/client";

/** Formulários (templates de atividade). A empresa vem SEMPRE da sessão, nunca do corpo. */

export const campoFormularioSchema = z.object({
  label: z.string().min(1),
  tipo: z.nativeEnum(TipoCampo),
  obrigatorio: z.boolean().default(false),
  ordem: z.number().default(0),
  opcoes: z.any().optional(),
});

const tipoOsId = z.preprocess((v) => (v === "" ? null : v), z.string().nullable().optional());

export const formularioCriarSchema = z.object({
  nome: z.string().trim().min(1),
  descricao: z.string().optional(),
  tipoOsId,
  campos: z.array(campoFormularioSchema).optional(),
});

/**
 * Edição PARCIAL: só os campos do formulário (qualquer outro — empresaId, id, criadoEm… — é
 * descartado) e só muda o que veio no corpo. `tipoOsId` ausente = mantém; null/"" = sem tipo.
 */
export const formularioEditarSchema = z.object({
  nome: z.string().trim().min(1),
  descricao: z.string().nullable(),
  tipoOsId,
  ativo: z.boolean(),
  campos: z.array(campoFormularioSchema),
}).partial();
