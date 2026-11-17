/**
 * MODELOS DE DOCUMENTO — as REGRAS PURAS. Sem banco, sem rede, sem React: a tela, o servidor e os
 * testes leem as mesmas funções, então a tela nunca oferece o que a rota recusa.
 *
 * O desenho: a empresa escreve o MODELO (um texto com os campos entre chaves). Na ficha de alguém,
 * o RH escolhe o modelo, o sistema preenche o que conhece, o usuário completa o que falta, e o
 * papel vira PDF — assinado na hora (a mesma prova da admissão: nome digitado, foto, IP, hora) e
 * guardado na seção Documentos da ficha, na gaveta certa e com validade quando o tipo tem.
 *
 * O que NÃO está aqui: nenhuma cláusula. O sistema preenche, não inventa — o texto é da empresa,
 * e campo que o sistema não conhece fica visível no modelo para quem escreveu ver e corrigir.
 */

import { CATEGORIAS } from "@/lib/colaborador/documentos";
import { camposDesconhecidosEm, camposUsados, preencherModelo } from "@/lib/texto/modelo";
import { chaveDiaCivil, diaCivilDeChave } from "@/lib/fuso";
import type { Acao } from "@/lib/permissoes";

export { camposUsados, preencherModelo };

/* ───────────────────────── os tipos ───────────────────────── */

export const TIPOS_DOCUMENTO = ["EPI", "TERMO", "ADVERTENCIA", "ADITIVO", "OUTRO"] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

/** Um campo que o USUÁRIO completa na hora de gerar (o sistema não teria como saber). */
export interface CampoDoTipo {
  id: string;
  rotulo: string;
  /** "data" vira seletor de data na tela; "texto longo" vira área de texto. */
  formato?: "texto" | "textoLongo" | "data" | "numero";
  obrigatorio?: boolean;
}

export interface TipoDef {
  id: TipoDocumento;
  rotulo: string;
  /** A gaveta onde o papel gerado cai na seção Documentos (CATEGORIAS da casa). */
  categoria: string;
  /** A lista de itens: a ficha de EPI EXIGE (é o que a NR-6 pede), o termo permite, o resto não. */
  itens: "exige" | "permite" | "nao";
  /** Pede a assinatura do colaborador por padrão. */
  assinatura: boolean;
  /** A permissão que o tipo exige para ser gerado. Advertência e suspensão são papel sensível. */
  acao: Extract<Acao, "criar" | "disciplinar">;
  campos: CampoDoTipo[];
  dica: string;
}

export const TIPOS: TipoDef[] = [
  {
    id: "EPI",
    rotulo: "Ficha de entrega de EPI",
    categoria: "ficha_epi",
    itens: "exige",
    assinatura: true,
    acao: "criar",
    campos: [{ id: "entregaEm", rotulo: "Data da entrega", formato: "data", obrigatorio: true }],
    dica: "A NR-6 pede o registro do que foi entregue, com o número do CA. A lista de itens vira uma tabela no PDF.",
  },
  {
    id: "TERMO",
    rotulo: "Termo de responsabilidade",
    categoria: "termo_responsabilidade",
    itens: "permite",
    assinatura: true,
    acao: "criar",
    campos: [
      { id: "entregaEm", rotulo: "Data da entrega", formato: "data", obrigatorio: true },
      { id: "devolucaoEm", rotulo: "Previsão de devolução", formato: "data" },
    ],
    dica: "Ferramenta, notebook, celular ou veículo: o colaborador assume a guarda e assina.",
  },
  {
    id: "ADVERTENCIA",
    rotulo: "Advertência / suspensão",
    categoria: "disciplinar",
    itens: "nao",
    assinatura: true,
    acao: "disciplinar",
    campos: [
      { id: "ocorridoEm", rotulo: "Data do ocorrido", formato: "data", obrigatorio: true },
      { id: "motivo", rotulo: "Motivo", formato: "textoLongo", obrigatorio: true },
      { id: "medida", rotulo: "Medida aplicada", obrigatorio: true },
      { id: "diasSuspensao", rotulo: "Dias de suspensão", formato: "numero" },
    ],
    dica: "Papel sensível: só quem tem a permissão de advertência gera — e só quem tem enxerga na ficha.",
  },
  {
    id: "ADITIVO",
    rotulo: "Aditivo / atualização de contrato",
    categoria: "contrato",
    itens: "nao",
    assinatura: true,
    acao: "criar",
    campos: [
      { id: "vigenciaEm", rotulo: "A partir de", formato: "data", obrigatorio: true },
      { id: "alteracao", rotulo: "O que muda", obrigatorio: true },
      { id: "valorAnterior", rotulo: "Como era" },
      { id: "valorNovo", rotulo: "Como fica" },
    ],
    dica: "Salário, cargo, função ou jornada. O aditivo cita o contrato da pessoa: {{contratoEm}} traz a data da assinatura.",
  },
  {
    id: "OUTRO",
    rotulo: "Outro documento",
    categoria: "outros",
    itens: "permite",
    assinatura: true,
    acao: "criar",
    campos: [],
    dica: "Declaração, comunicado, recibo — qualquer papel que a empresa precise com os dados da pessoa.",
  },
];

export const TIPO_PADRAO: TipoDocumento = "EPI";
export const tipoDe = (id: string | null | undefined): TipoDef => TIPOS.find((t) => t.id === id) ?? TIPOS[TIPOS.length - 1];
export const rotuloTipo = (id: string | null | undefined): string => tipoDe(id).rotulo;
export const ehTipoValido = (id: string): id is TipoDocumento => TIPOS_DOCUMENTO.includes(id as TipoDocumento);
/** A permissão que o tipo exige para ser gerado (e, no disciplinar, para ser lido). */
export const acaoDoTipo = (id: string | null | undefined) => tipoDe(id).acao;
/** Os tipos que só quem tem a permissão de advertência enxerga. */
export const TIPOS_SENSIVEIS: TipoDocumento[] = TIPOS.filter((t) => t.acao === "disciplinar").map((t) => t.id);
export const ehSensivel = (tipo: string | null | undefined) => acaoDoTipo(tipo) === "disciplinar";

/* ───────────────────────── os campos ───────────────────────── */

/**
 * O que o SISTEMA preenche sozinho, do cadastro da pessoa e da empresa. É a lista que a tela mostra
 * em verde: o que já está pronto para usar no modelo.
 */
export const CAMPOS_AUTOMATICOS: { id: string; rotulo: string }[] = [
  { id: "nome", rotulo: "Nome do colaborador" },
  { id: "cpf", rotulo: "CPF" },
  { id: "rg", rotulo: "RG" },
  { id: "pis", rotulo: "PIS / NIS" },
  { id: "ctps", rotulo: "CTPS (número, série e UF)" },
  { id: "nascimento", rotulo: "Data de nascimento" },
  { id: "telefone", rotulo: "Telefone" },
  { id: "email", rotulo: "E-mail" },
  { id: "endereco", rotulo: "Endereço completo" },
  { id: "cargo", rotulo: "Cargo" },
  { id: "cbo", rotulo: "CBO do cargo" },
  { id: "salario", rotulo: "Salário" },
  { id: "jornada", rotulo: "Jornada" },
  { id: "admissao", rotulo: "Data de admissão" },
  { id: "contratoEm", rotulo: "Data do contrato assinado" },
  { id: "empresa", rotulo: "Empresa" },
  { id: "empresaCnpj", rotulo: "CNPJ da empresa" },
  { id: "cidade", rotulo: "Cidade da empresa" },
  { id: "data", rotulo: "Data de hoje" },
];

export const ID_CAMPOS_AUTOMATICOS = CAMPOS_AUTOMATICOS.map((c) => c.id);

/** Todos os campos que o sistema conhece para um tipo: os automáticos mais os do próprio tipo. */
export const camposConhecidos = (tipo: string | null | undefined): string[] =>
  [...ID_CAMPOS_AUTOMATICOS, ...tipoDe(tipo).campos.map((c) => c.id)];

/** Os campos que o modelo usa e o sistema não conhece — a tela avisa, e o texto não é tocado. */
export const camposDesconhecidosDoModelo = (texto: string, tipo: string | null | undefined): string[] =>
  camposDesconhecidosEm(texto, camposConhecidos(tipo));

/** Os campos do tipo que o modelo realmente usa — a tela de gerar só pergunta esses. */
export function camposAPreencher(texto: string, tipo: string | null | undefined): CampoDoTipo[] {
  const usados = new Set(camposUsados(texto));
  return tipoDe(tipo).campos.filter((c) => usados.has(c.id));
}

/**
 * O que o usuário digitou, do jeito que entra no TEXTO do papel. Campo de data viaja "AAAA-MM-DD"
 * (é o valor do seletor de data), e ninguém escreve "em 2026-11-17" num documento: no texto ele
 * vira dd/mm/aaaa, igual às datas que o próprio sistema preenche ({{data}}, {{admissao}}).
 */
export function valorNoTexto(campo: CampoDoTipo, valor: string): string {
  if (campo.formato !== "data") return valor;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : valor;
}

/* ───────────────────────── a lista de itens ───────────────────────── */

/** Uma linha da tabela do documento (a ficha de EPI é a razão de ela existir). */
export interface ItemDocumento {
  descricao: string;
  /** Certificado de Aprovação — é o que dá valor legal à ficha de EPI. */
  ca?: string;
  quantidade: number;
  /** Dia civil "AAAA-MM-DD" */
  entregaEm?: string;
}

export const ITENS_MAX = 50;
export const QUANTIDADE_MAX = 9999;
export const NOME_MAX = 80;
export const TEXTO_MAX = 20_000;
export const VALIDADE_DIAS_MAX = 3650;

/**
 * Confere a lista de itens. Para a ficha de EPI o **CA é obrigatório**: é ele que transforma a
 * ficha em prova de que o equipamento entregue era certificado. Item sem CA não é EPI — é material
 * de trabalho, e isso vai num termo de responsabilidade.
 */
export function erroDosItens(itens: readonly ItemDocumento[] | null | undefined, tipo: string | null | undefined): string | null {
  const def = tipoDe(tipo);
  const lista = itens ?? [];
  if (def.itens === "nao" && lista.length) return `${def.rotulo} não tem lista de itens.`;
  if (def.itens === "exige" && !lista.length) return "Acrescente pelo menos um item entregue.";
  if (lista.length > ITENS_MAX) return `A lista não pode passar de ${ITENS_MAX} itens.`;

  for (const [i, item] of lista.entries()) {
    const onde = `Item ${i + 1}`;
    if (!String(item?.descricao ?? "").trim()) return `${onde}: descreva o que foi entregue.`;
    const q = Number(item?.quantidade);
    if (!Number.isFinite(q) || !Number.isInteger(q) || q < 1) return `${onde}: a quantidade é um número inteiro a partir de 1.`;
    if (q > QUANTIDADE_MAX) return `${onde}: quantidade acima do limite (${QUANTIDADE_MAX}).`;
    if (def.id === "EPI" && !String(item?.ca ?? "").trim()) {
      return `${onde}: informe o número do CA. É o CA que dá valor legal à ficha de EPI — material sem CA vai num termo de responsabilidade.`;
    }
    if (item?.entregaEm && !/^\d{4}-\d{2}-\d{2}$/.test(item.entregaEm)) return `${onde}: data de entrega inválida.`;
  }
  return null;
}

/** Normaliza o que veio da tela: apara texto, arredonda a quantidade e tira linha vazia. */
export function limparItens(itens: readonly Partial<ItemDocumento>[] | null | undefined): ItemDocumento[] {
  return (itens ?? [])
    .map((i) => ({
      descricao: String(i?.descricao ?? "").trim().slice(0, 200),
      ca: String(i?.ca ?? "").trim().slice(0, 30) || undefined,
      quantidade: Math.trunc(Number(i?.quantidade ?? 1)) || 1,
      entregaEm: String(i?.entregaEm ?? "").trim() || undefined,
    }))
    .filter((i) => i.descricao || i.ca);
}

/* ───────────────────────── o modelo ───────────────────────── */

export interface ModeloEntrada {
  nome: string;
  tipo: string;
  texto: string;
  categoria?: string | null;
  temItens?: boolean;
  validadeDias?: number | null;
  exigeAssinatura?: boolean;
}

/** O que impede um modelo de ser salvo. Null = pode salvar. */
export function erroDoModelo(m: ModeloEntrada): string | null {
  const nome = String(m.nome ?? "").trim();
  if (nome.length < 2) return "Dê um nome ao modelo.";
  if (nome.length > NOME_MAX) return `O nome não pode passar de ${NOME_MAX} caracteres.`;
  if (!ehTipoValido(String(m.tipo))) return "Escolha o tipo do documento.";
  const texto = String(m.texto ?? "").trim();
  if (texto.length < 10) return "Escreva o texto do documento.";
  if (texto.length > TEXTO_MAX) return `O texto não pode passar de ${TEXTO_MAX} caracteres.`;
  if (m.categoria && !CATEGORIAS.some((c) => c.id === m.categoria)) return "Categoria desconhecida.";

  const def = tipoDe(m.tipo);
  if (def.itens === "exige" && m.temItens === false) return `${def.rotulo} tem lista de itens — é o que a NR-6 pede.`;
  if (def.itens === "nao" && m.temItens) return `${def.rotulo} não tem lista de itens.`;

  const dias = m.validadeDias;
  if (dias !== null && dias !== undefined) {
    if (!Number.isInteger(dias) || dias < 1) return "A validade é um número inteiro de dias a partir de 1.";
    if (dias > VALIDADE_DIAS_MAX) return `A validade não pode passar de ${VALIDADE_DIAS_MAX} dias.`;
  }
  return null;
}

/** A gaveta onde o papel gerado cai: a do modelo, se a empresa escolheu, senão a do tipo. */
export const categoriaDoModelo = (m: { categoria?: string | null; tipo: string }): string =>
  m.categoria?.trim() || tipoDe(m.tipo).categoria;

/** Se o tipo tem lista de itens por natureza, o modelo nasce com ela ligada. */
export const temItensPadrao = (tipo: string): boolean => tipoDe(tipo).itens === "exige";

/**
 * O dia em que o documento vence, a partir da entrega. NULL quando o modelo não tem validade —
 * e aí nenhum aviso de vencimento nasce, que é o certo: documento sem prazo não vence.
 */
export function vencimentoDe(validadeDias: number | null | undefined, base: Date | string): Date | null {
  if (!validadeDias || validadeDias < 1) return null;
  const dia = diaCivilDeChave(chaveDiaCivil(base));
  if (!dia) return null;
  return new Date(dia.getTime() + validadeDias * 24 * 60 * 60 * 1000);
}

/** O nome do papel na ficha e do arquivo baixado — o RH arquiva por nome. */
export const tituloDoDocumento = (nomeModelo: string, nomeColaborador: string): string =>
  `${String(nomeModelo ?? "").trim() || "Documento"} - ${String(nomeColaborador ?? "").trim()}`.trim();
