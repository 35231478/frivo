/**
 * ERRO NO CAMPO — as regras puras do padrão único de validação dos formulários (escritório, portal e app do técnico).
 *
 *  - O erro mora no CAMPO: `campos` é { nomeDoCampo: "mensagem curta" }. O nome é o do formulário (ex.: "cpfCnpj",
 *    "itens.2.quantidade" numa tabela editável).
 *  - `geral` é o erro que não pertence a nenhum campo (ex.: "Erro de conexão.").
 *  - A faixa do topo é só o RESUMO (`resumoDosErros`): um erro de campo sozinho repete o texto; mais de um vira
 *    "N campos para corrigir"; o geral continua em cima.
 *  - A API responde `{ erro, campos? }` (o `erro` de sempre continua lá: quem já lê só o `erro` não quebra);
 *    `lerErroDaApi` também entende o `detalhes` do zod (`flatten()`) que várias rotas já devolvem.
 *  - Formato óbvio (CNPJ/CPF, e-mail, CEP, telefone, data, hora, valor) é conferido AO SAIR do campo
 *    (`validarFormato`); vazio nunca é erro de formato: o obrigatório só acusa ao salvar.
 */
import { cnpjValido, cpfValido, digitos } from "@/lib/documento";

export type ErrosDeCampo = Record<string, string>;

export interface EstadoErros {
  geral?: string | null;
  campos: ErrosDeCampo;
}

/** Mensagens genéricas do servidor que não dizem nada quando os campos já dizem (somem da faixa) */
const GENERICAS = new Set(["dados inválidos", "dados invalidos", "erro de validação", "validation error", "invalid data"]);
const ehGenerica = (m: string) => GENERICAS.has(m.trim().replace(/[.!]+$/, "").toLocaleLowerCase("pt-BR"));

/** Tira os vazios: um campo só conta como erro com mensagem */
export function limparCampos(campos: Record<string, unknown> | null | undefined): ErrosDeCampo {
  const r: ErrosDeCampo = {};
  for (const [k, v] of Object.entries(campos ?? {})) {
    const m = Array.isArray(v) ? v.find((x) => typeof x === "string" && x.trim()) : v;
    if (typeof m === "string" && m.trim()) r[k] = m.trim();
  }
  return r;
}

/** "1 campo para corrigir" / "3 campos para corrigir" */
export const textoQuantos = (n: number) => `${n} ${n === 1 ? "campo" : "campos"} para corrigir`;

export interface Resumo {
  /** A linha principal da faixa */
  texto: string;
  /** "N campos para corrigir" (só quando há mais de um erro, ou erro geral junto com erros de campo) */
  quantos: string | null;
  /** Os campos, na ordem em que aparecem */
  itens: { campo: string; mensagem: string }[];
}

/**
 * O resumo da faixa do topo:
 *  - nada → null (sem faixa);
 *  - só o geral → o geral;
 *  - um erro de campo, sem geral → a mesma mensagem do campo;
 *  - mais de um, ou geral + campos → o geral (ou "N campos para corrigir") e a contagem.
 * `ordem` (opcional): a ordem dos campos na tela.
 */
export function resumoDosErros(e: EstadoErros, ordem?: string[]): Resumo | null {
  const campos = limparCampos(e.campos);
  const nomes = Object.keys(campos);
  if (ordem?.length) {
    const pos = (n: string) => { const i = ordem.indexOf(n); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
    nomes.sort((a, b) => pos(a) - pos(b));
  }
  const itens = nomes.map((campo) => ({ campo, mensagem: campos[campo] }));
  const geral = (e.geral ?? "").trim();
  const geralUtil = geral && !(itens.length && (ehGenerica(geral) || itens.some((i) => i.mensagem === geral))) ? geral : "";
  if (!itens.length) return geralUtil ? { texto: geralUtil, quantos: null, itens: [] } : null;
  if (itens.length === 1 && !geralUtil) return { texto: itens[0].mensagem, quantos: null, itens };
  return { texto: geralUtil || textoQuantos(itens.length), quantos: geralUtil ? textoQuantos(itens.length) : null, itens };
}

/** Os erros do zod (`error.issues`) por campo: o caminho vira "a.b.0.c"; vale a 1ª mensagem de cada campo */
export function camposDoZod(issues: { path: (string | number)[]; message: string }[] | null | undefined): ErrosDeCampo {
  const r: ErrosDeCampo = {};
  for (const i of issues ?? []) {
    const k = (i.path ?? []).join(".");
    if (k && !r[k] && i.message) r[k] = i.message;
  }
  return r;
}

/**
 * A resposta de erro da API → { geral, campos }. Entende:
 *  - `{ erro, campos }` (o padrão novo);
 *  - `{ erro, detalhes: zod.flatten() }` (fieldErrors) — o que as rotas já devolvem;
 *  - `{ error }` / `{ message }` / texto.
 * Com campos, o "Dados inválidos" genérico (ou a mesma frase do campo) não vira faixa à parte.
 */
export function lerErroDaApi(corpo: unknown, padrao = "Não foi possível salvar."): EstadoErros {
  if (typeof corpo === "string") return { geral: corpo.trim() || padrao, campos: {} };
  const c = (corpo && typeof corpo === "object" ? corpo : {}) as Record<string, unknown>;
  const detalhes = c.detalhes && typeof c.detalhes === "object" ? (c.detalhes as Record<string, unknown>) : null;
  let campos = limparCampos(c.campos && typeof c.campos === "object" ? (c.campos as Record<string, unknown>) : null);
  if (!Object.keys(campos).length && detalhes?.fieldErrors && typeof detalhes.fieldErrors === "object") {
    campos = limparCampos(detalhes.fieldErrors as Record<string, unknown>);
  }
  const msg = [c.erro, c.error, c.message].find((x) => typeof x === "string" && x.trim()) as string | undefined;
  const geral = msg?.trim() ?? (Object.keys(campos).length ? "" : padrao);
  const geralUtil = geral && Object.keys(campos).length && (ehGenerica(geral) || Object.values(campos).includes(geral)) ? "" : geral;
  return { geral: geralUtil || null, campos };
}

/* ───────────── Formato ao sair do campo ───────────── */

export type Formato = "cnpj" | "cpf" | "cpfCnpj" | "email" | "cep" | "telefone" | "celular" | "data" | "hora" | "valor";

export const MSG_FORMATO = {
  cnpjIncompleto: "Informe os 14 dígitos do CNPJ.",
  cnpjInvalido: "CNPJ inválido: confira os dígitos.",
  cpfIncompleto: "Informe os 11 dígitos do CPF.",
  cpfInvalido: "CPF inválido: confira os dígitos.",
  documentoIncompleto: "Informe os 11 dígitos do CPF ou os 14 do CNPJ.",
  email: "E-mail inválido: confira o endereço.",
  cep: "Informe os 8 dígitos do CEP.",
  telefone: "Telefone incompleto: informe o DDD e o número.",
  celular: "Celular incompleto: informe o DDD e os 9 dígitos.",
  dataIncompleta: "Data incompleta: use dd/mm/aaaa.",
  dataInexistente: "Data inexistente: confira o dia e o mês.",
  hora: "Hora inválida: use hh:mm.",
  valor: "Valor inválido: use só números (ex.: 1.250,00).",
} as const;

/** A mensagem é de formato (não de "obrigatório" nem do servidor)? */
export const ehMensagemDeFormato = (m: string | null | undefined) => !!m && (Object.values(MSG_FORMATO) as string[]).includes(m);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Número digitado no jeito brasileiro ("1.250,50", "1250,5", "1250.50", "R$ 10") → número, ou null */
export function numeroDigitado(v: string): number | null {
  let t = v.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "").replace(/%$/, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function dataValida(t: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (!m) return MSG_FORMATO.dataIncompleta;
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(a, mes - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === mes - 1 && dt.getUTCDate() === d ? null : MSG_FORMATO.dataInexistente;
}

/**
 * Confere o formato óbvio do que foi digitado. Vazio → null (o obrigatório só acusa ao salvar).
 * Devolve a mensagem curta do erro, ou null quando está certo.
 */
export function validarFormato(formato: Formato, valor: string | null | undefined): string | null {
  const t = (valor ?? "").trim();
  if (!t) return null;
  const d = digitos(t);
  switch (formato) {
    case "cnpj":
      return d.length !== 14 ? MSG_FORMATO.cnpjIncompleto : cnpjValido(d) ? null : MSG_FORMATO.cnpjInvalido;
    case "cpf":
      return d.length !== 11 ? MSG_FORMATO.cpfIncompleto : cpfValido(d) ? null : MSG_FORMATO.cpfInvalido;
    case "cpfCnpj":
      if (d.length === 11) return cpfValido(d) ? null : MSG_FORMATO.cpfInvalido;
      if (d.length === 14) return cnpjValido(d) ? null : MSG_FORMATO.cnpjInvalido;
      return MSG_FORMATO.documentoIncompleto;
    case "email":
      return t.length <= 160 && EMAIL.test(t) ? null : MSG_FORMATO.email;
    case "cep":
      return d.length === 8 ? null : MSG_FORMATO.cep;
    case "telefone": {
      const n = d.length > 11 && d.startsWith("55") ? d.slice(2) : d;
      return n.length === 10 || n.length === 11 ? null : MSG_FORMATO.telefone;
    }
    case "celular": {
      const n = d.length > 11 && d.startsWith("55") ? d.slice(2) : d;
      return n.length === 11 && n[2] === "9" ? null : MSG_FORMATO.celular;
    }
    case "data":
      return dataValida(t);
    case "hora":
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? null : MSG_FORMATO.hora;
    case "valor":
      return numeroDigitado(t) === null ? MSG_FORMATO.valor : null;
  }
}

/** O formato do documento pelo tipo de pessoa do cadastro (cliente, fornecedor) */
export const formatoDoDocumento = (tipoPessoa: string | null | undefined): Formato =>
  tipoPessoa === "FISICA" ? "cpf" : tipoPessoa === "JURIDICA" ? "cnpj" : "cpfCnpj";

/* ───────────── Abas ───────────── */

/** Quantos erros em cada aba (pelo mapa campo → aba; campo sem aba não conta). "itens.2.x" procura "itens.2.x" e "itens" */
export function errosPorAba(campos: ErrosDeCampo, abaDoCampo: (nome: string) => string | undefined | null): Record<string, number> {
  const r: Record<string, number> = {};
  for (const nome of Object.keys(limparCampos(campos))) {
    const aba = abaDoCampo(nome) ?? abaDoCampo(nome.split(".")[0]);
    if (aba) r[aba] = (r[aba] ?? 0) + 1;
  }
  return r;
}

/** Os erros do react-hook-form (aninhados) → { "a.b.0.c": mensagem } */
export function camposDoRhf(errors: unknown, prefixo = ""): ErrosDeCampo {
  const r: ErrosDeCampo = {};
  if (!errors || typeof errors !== "object") return r;
  for (const [k, v] of Object.entries(errors as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || k === "ref") continue;
    const nome = prefixo ? `${prefixo}.${k}` : k;
    const msg = (v as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) r[nome] = msg.trim();
    else Object.assign(r, camposDoRhf(v, nome));
  }
  return r;
}
