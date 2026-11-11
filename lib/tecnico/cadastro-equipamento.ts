/**
 * Cadastro de equipamento EM CAMPO, pelo app do técnico — regras PURAS (sem Prisma), as mesmas no
 * aparelho, no servidor e nos testes. O técnico cadastra, dentro da OS, o equipamento que ainda não
 * está na unidade: ele nasce NA UNIDADE do cliente da OS, já vinculado à atividade.
 *
 * O id do equipamento é gerado NO APARELHO (uuid): sem sinal, as gravações seguintes (checklist,
 * fotos) já apontam para ele, e a sincronização cria o equipamento com esse mesmo id — reenviar
 * não duplica.
 */
import { z } from "zod";
import { ambienteEquipamento, descricaoEquipamento, fabricanteModelo } from "@/lib/equipamento-descricao";
import type { EquipamentoInfo } from "@/lib/tecnico/offline/tipos";

/** Fotos do cadastro: a do equipamento (capa), a da etiqueta e mais uma */
export const MAX_FOTOS_CADASTRO = 3;
/** A partir de quantos caracteres a série é conferida (menos que isso dá coincidência demais) */
export const SERIE_MIN = 3;
export const UNIDADES_CAPACIDADE = ["BTU/h", "TR"] as const;

export const MSG_CADASTRO_DESLIGADO = "O cadastro de equipamento pelo app está desligado nesta empresa.";
export const MSG_SEM_UNIDADE = "Esta OS não tem endereço definido: peça ao escritório para definir antes de cadastrar equipamento.";
export const MSG_TIPO_OBRIGATORIO = "Escolha o tipo do equipamento.";
export const MSG_SEM_SINAL_SERIE = "Sem sinal: a conferência completa da série acontece ao sincronizar.";

const texto = (max: number) => z.string().trim().max(max).optional();

export const cadastroEquipamentoSchema = z.object({
  /** Id do equipamento, gerado no aparelho */
  id: z.string().uuid("Identificador do equipamento inválido."),
  /** Valor do seletor de tipo: chave do tipo padrão ou "custom:<id>" — sempre um tipo que JÁ existe */
  tipo: z.string().trim().min(1, MSG_TIPO_OBRIGATORIO).max(80),
  marca: texto(80),
  modelo: texto(120),
  numeroSerie: texto(80),
  capacidade: texto(40),
  setor: texto(80),
  ambiente: texto(80),
  /** Data URLs: [0] = o equipamento (capa), depois a etiqueta */
  fotos: z.array(z.string().min(30)).max(MAX_FOTOS_CADASTRO, `No máximo ${MAX_FOTOS_CADASTRO} fotos.`).optional(),
  /** Etiqueta QR já colada no equipamento (lida pela câmera); sem ela o sistema gera o número */
  qrLido: z.string().trim().min(1).max(500).optional(),
}).strict();
export type CadastroEquipamento = z.infer<typeof cadastroEquipamentoSchema>;

/** Um tipo de equipamento que o técnico pode escolher (só os que já existem e estão ativos) */
export interface TipoCadastro {
  /** Valor do seletor: chave do tipo padrão ou "custom:<id>" */
  valor: string;
  nome: string;
  /** Id do cadastro do tipo (checklist e formulário do tipo); null = tipo padrão ainda sem cadastro */
  tipoEquipamentoId: string | null;
}

/** O que o servidor manda no retrato da atividade para o app cadastrar sem sinal */
export interface CadastroCampo {
  /** A unidade onde o equipamento nasce (a da OS; ou a única do cliente). null = não dá para cadastrar */
  unidadeId: string | null;
  tipos: TipoCadastro[];
  /** Sugestões de setor e de ambiente: os que já existem nos equipamentos da unidade */
  setores: string[];
  ambientes: string[];
}

const limpo = (v: string | null | undefined) => (v ?? "").trim() || null;

/** "12000" + "BTU/h" → "12000 BTU/h"; vazio → undefined (o campo é opcional). */
export function montarCapacidade(valor: string, unidade: string): string | undefined {
  const v = valor.trim();
  return v ? `${v} ${unidade}` : undefined;
}

/**
 * Como o equipamento recém-cadastrado aparece no app ANTES de sincronizar — com as mesmas regras de
 * apresentação do servidor (título, descrição, local), para a tela não mudar quando o retrato chegar.
 */
export function apresentarCadastro(d: CadastroEquipamento, tipos: readonly TipoCadastro[]): EquipamentoInfo & { tipoEquipamentoId: string | null } {
  const tipo = tipos.find((t) => t.valor === d.tipo) ?? null;
  const base = { tipo: d.tipo, tipoLabel: tipo?.nome ?? null, capacidade: limpo(d.capacidade), marca: limpo(d.marca), modelo: limpo(d.modelo) };
  const amb = ambienteEquipamento({ localizacao: limpo(d.ambiente), setor: limpo(d.setor) }, null);
  return {
    id: d.id,
    titulo: descricaoEquipamento(base),
    descricao: descricaoEquipamento(base),
    fabricante: fabricanteModelo(base),
    tag: null,
    numeroSerie: limpo(d.numeroSerie),
    local: [amb.principal, amb.complemento].filter(Boolean).join(" · ") || null,
    unidade: null,
    ativo: true,
    tipo: tipo?.tipoEquipamentoId ? { id: tipo.tipoEquipamentoId, nome: tipo.nome } : null,
    tipoEquipamentoId: tipo?.tipoEquipamentoId ?? null,
  };
}

/** Mesma etiqueta? Sem ligar para maiúsculas e espaços nas pontas — a regra da consulta ao servidor */
export function mesmaSerie(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? "").trim().toLowerCase();
  return x.length >= SERIE_MIN && x === (b ?? "").trim().toLowerCase();
}

export interface SerieNoAparelho { id: string; titulo: string; local: string | null; origem: "unidade" | "fila" }

/**
 * A conferência que dá para fazer SEM SINAL: a série contra o que o aparelho já tem — os equipamentos
 * da unidade (vieram no retrato) e os cadastros que estão na fila esperando sincronizar (de qualquer
 * OS). A conferência contra a empresa inteira só o servidor faz.
 */
export function seriesNoAparelho(
  numero: string,
  daUnidade: readonly { id: string; titulo: string; local: string | null; numeroSerie: string | null }[],
  naFila: readonly { id: string; titulo: string; local: string | null; numeroSerie: string | null }[],
  ignorarId?: string,
): SerieNoAparelho[] {
  const vistos = new Set<string>();
  const saida: SerieNoAparelho[] = [];
  const juntar = (lista: typeof daUnidade, origem: SerieNoAparelho["origem"]) => {
    for (const e of lista) {
      if (e.id === ignorarId || vistos.has(e.id) || !mesmaSerie(numero, e.numeroSerie)) continue;
      vistos.add(e.id);
      saida.push({ id: e.id, titulo: e.titulo, local: e.local, origem });
    }
  };
  juntar(naFila, "fila"); // o que acabou de ser cadastrado no aparelho vem primeiro
  juntar(daUnidade, "unidade");
  return saida;
}
