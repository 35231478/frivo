import { z } from "zod";

/**
 * PMOC — regras compartilhadas (tela e servidor; sem dependências de Node).
 *
 * Status exibido:
 * - RASCUNHO: enquanto não publicado (status gravado = RASCUNHO, manual);
 * - VIGENTE:  publicado e hoje ≤ data de expiração (o dia da expiração ainda vale);
 * - EXPIRADO: publicado e hoje > data de expiração.
 * Vigente/Expirado não são gravados: são calculados pela data, então nunca ficam
 * desatualizados (não depende de rotina agendada).
 */

export type StatusExibidoPmoc = "RASCUNHO" | "VIGENTE" | "EXPIRADO";
export const DIAS_AVISO_VENCIMENTO = 30;

export const LABELS_STATUS_PMOC: Record<StatusExibidoPmoc, string> = {
  RASCUNHO: "Rascunho",
  VIGENTE: "Vigente",
  EXPIRADO: "Expirado",
};

/** "YYYY-MM-DD" de hoje no fuso de Brasília (datas do PMOC são só data, sem hora). */
export function hojeISO(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

/** Data gravada como DATE (meia-noite UTC) → "YYYY-MM-DD", sem deslocar o dia pelo fuso. */
export function dataISO(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function dataBR(d: Date | string | null | undefined): string {
  const iso = dataISO(d);
  if (!iso) return "—";
  const [y, m, dia] = iso.split("-");
  return `${dia}/${m}/${y}`;
}

function diasEntre(deISO: string, ateISO: string): number {
  return Math.round((Date.parse(`${ateISO}T00:00:00Z`) - Date.parse(`${deISO}T00:00:00Z`)) / 864e5);
}

export function situacaoPmoc(p: { status: string; dataInicio: Date | string; dataExpiracao: Date | string }, agora = new Date()): {
  status: StatusExibidoPmoc; diasParaExpirar: number | null; vencendo: boolean; aIniciar: boolean;
} {
  if (p.status !== "PUBLICADO") return { status: "RASCUNHO", diasParaExpirar: null, vencendo: false, aIniciar: false };
  const hoje = hojeISO(agora);
  const fim = dataISO(p.dataExpiracao)!;
  const dias = diasEntre(hoje, fim);
  if (dias < 0) return { status: "EXPIRADO", diasParaExpirar: dias, vencendo: false, aIniciar: false };
  return { status: "VIGENTE", diasParaExpirar: dias, vencendo: dias <= DIAS_AVISO_VENCIMENTO, aIniciar: diasEntre(hoje, dataISO(p.dataInicio)!) > 0 };
}

/** Filtro de status (lista) em SQL: Vigente/Expirado dependem da data de hoje. */
export function filtroStatusPmoc(status: string, agora = new Date()): Record<string, unknown> | null {
  const hoje = new Date(`${hojeISO(agora)}T00:00:00Z`);
  if (status === "RASCUNHO") return { status: "RASCUNHO" };
  if (status === "VIGENTE") return { status: "PUBLICADO", dataExpiracao: { gte: hoje } };
  if (status === "EXPIRADO") return { status: "PUBLICADO", dataExpiracao: { lt: hoje } };
  return null;
}

/** Texto técnico/legal padrão (editável em cada PMOC). */
export const DESCRICAO_PADRAO_PMOC = `Plano de Manutenção, Operação e Controle (PMOC) dos sistemas de climatização do estabelecimento identificado neste documento, elaborado para garantir a qualidade do ar interior, a segurança dos ocupantes e o bom desempenho dos equipamentos.

Base legal e normativa:
• Lei Federal nº 13.589/2018 — obriga edifícios de uso público e coletivo com ambientes climatizados artificialmente a manter um PMOC;
• Portaria nº 3.523/GM/MS, de 28 de agosto de 1998 — regulamento técnico de limpeza e manutenção dos sistemas de climatização;
• Resolução ANVISA RE nº 09/2003 — padrões referenciais de qualidade do ar interior;
• ABNT NBR 13971 — sistemas de refrigeração, condicionamento de ar, ventilação e aquecimento: manutenção programada;
• ABNT NBR 16401 — instalações de ar-condicionado: projetos, conforto térmico e qualidade do ar interior.

O plano contempla a relação dos equipamentos cobertos, a periodicidade das atividades de manutenção, operação e controle, o registro das execuções e as recomendações para correção de não conformidades, sob a responsabilidade do Responsável Técnico habilitado indicado, com a respectiva Anotação de Responsabilidade Técnica (ART).`;

/* ───────── Validação (POST/PUT) ───────── */
const texto = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const dataStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");
export const TIPOS_ART = ["application/pdf", "image/jpeg", "image/png"] as const;
export const TAMANHO_MAX_ART = 5 * 1024 * 1024;

export const pmocSchema = z.object({
  nome: z.string().trim().min(3, "Informe o nome do PMOC (mín. 3 caracteres).").max(150),
  descricao: z.string().max(20_000).optional().nullable(),
  clienteId: z.string().min(1, "Selecione o cliente."),
  unidadeId: z.string().min(1, "Selecione a unidade/local."),
  dataInicio: dataStr,
  dataExpiracao: dataStr,
  status: z.enum(["RASCUNHO", "PUBLICADO"]).default("RASCUNHO"),
  responsavelTecnicoId: z.string().optional().nullable().transform((v) => v || null),
  rtNome: texto(150),
  rtCrea: texto(50),
  artNumero: texto(60),
  // Arquivo da ART: data URL para trocar; `removerArt: true` para tirar; ausente = mantém
  artArquivo: z.string().optional().nullable(),
  artArquivoNome: z.string().max(200).optional().nullable(),
  removerArt: z.boolean().optional(),
}).refine((d) => d.dataExpiracao > d.dataInicio, { message: "A data de expiração deve ser depois da data de início.", path: ["dataExpiracao"] });

export type PmocInput = z.infer<typeof pmocSchema>;

/** O que falta para publicar (vazio = pode publicar). Usado na tela e no servidor. */
export function pendenciasPublicacao(d: { rtNome?: string | null; rtCrea?: string | null; artNumero?: string | null }, totalEquipamentos: number): string[] {
  const p: string[] = [];
  if (!d.rtNome?.trim()) p.push("nome do Responsável Técnico");
  if (!d.rtCrea?.trim()) p.push("registro CREA do Responsável Técnico");
  if (!d.artNumero?.trim()) p.push("número da ART");
  if (totalEquipamentos < 1) p.push("pelo menos 1 equipamento coberto");
  return p;
}

/** Datas DATE vindas do banco/API → "YYYY-MM-DD" (formato do editor). Pode rodar no servidor e no cliente. */
export function serializarPmoc<T>(d: any): T {
  return { ...d, dataInicio: String(d.dataInicio).slice(0, 10), dataExpiracao: String(d.dataExpiracao).slice(0, 10) } as T;
}
