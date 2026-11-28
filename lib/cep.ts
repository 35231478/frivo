/**
 * Consulta de CEP (ViaCEP, com a BrasilAPI de reserva) — UMA função para todas as telas que preenchem endereço (unidade do
 * cliente, cadastro rápido, admissão digital). Sem rede (ou CEP que não existe), devolve null e a
 * tela segue com o que a pessoa digitar: a consulta é conforto, nunca trava o formulário.
 */
export interface EnderecoCep {
  logradouro: string;
  bairro: string;
  cidade: string;
  estado: string;
  complemento: string;
}

export const cepCompleto = (cep: string) => cep.replace(/\D/g, "").length === 8;

/** Formata enquanto digita: 13010-000 */
export function formatarCep(cep: string): string {
  const d = cep.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** A consulta deu certo, ou por que não deu: CEP que não existe × serviço fora do ar (a tela diz o certo) */
export type ResultadoCep = { ok: true; endereco: EnderecoCep } | { ok: false; motivo: "invalido" | "nao-encontrado" | "indisponivel" };

/** Cada consulta espera no máximo isto: o formulário nunca trava esperando o CEP */
export const TEMPO_MAX_CEP_MS = 4000;

async function comPrazo(url: string): Promise<Response | null> {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), TEMPO_MAX_CEP_MS) : null;
  try { return await fetch(url, ctrl ? { signal: ctrl.signal } : undefined); } catch { return null; } finally { if (t) clearTimeout(t); }
}

/** ViaCEP, e se ele cair, a BrasilAPI (o mesmo formato de volta) */
const PROVEDORES: { url: (cep: string) => string; ler: (d: any) => EnderecoCep | "nao-encontrado" | null }[] = [
  {
    url: (cep) => `https://viacep.com.br/ws/${cep}/json/`,
    ler: (d) => (!d ? null : d.erro ? "nao-encontrado" : { logradouro: d.logradouro ?? "", bairro: d.bairro ?? "", cidade: d.localidade ?? "", estado: d.uf ?? "", complemento: d.complemento ?? "" }),
  },
  {
    url: (cep) => `https://brasilapi.com.br/api/cep/v1/${cep}`,
    ler: (d) => (!d || !d.cep ? null : { logradouro: d.street ?? "", bairro: d.neighborhood ?? "", cidade: d.city ?? "", estado: d.state ?? "", complemento: "" }),
  },
];

export async function consultarCep(cepBruto: string): Promise<ResultadoCep> {
  const cep = cepBruto.replace(/\D/g, "");
  if (cep.length !== 8) return { ok: false, motivo: "invalido" };
  let naoEncontrado = false;
  for (const p of PROVEDORES) {
    const res = await comPrazo(p.url(cep));
    if (!res) continue; // fora do ar ou demorou: o próximo
    if (res.status === 404) { naoEncontrado = true; continue; }
    if (!res.ok) continue;
    const lido = p.ler(await res.json().catch(() => null));
    if (lido === "nao-encontrado") { naoEncontrado = true; continue; }
    if (lido) return { ok: true, endereco: lido };
  }
  return { ok: false, motivo: naoEncontrado ? "nao-encontrado" : "indisponivel" };
}

/** O endereço do CEP, ou null (sem rede, CEP que não existe): quem chama segue com o que a pessoa digitar */
export async function buscarCep(cepBruto: string): Promise<EnderecoCep | null> {
  const r = await consultarCep(cepBruto);
  return r.ok ? r.endereco : null;
}

/**
 * O endereço do CEP aplicado ao formulário (um jeito só): logradouro, bairro, cidade e UF vêm da consulta quando ela
 * traz o dado; o que a consulta não traz fica como a pessoa digitou. Número e complemento são da pessoa.
 * `nomes` diz como cada campo se chama no formulário (ex.: o logradouro do colaborador é "endereco").
 */
export function enderecoDoCep<T extends object>(
  atual: T, e: EnderecoCep,
  nomes: { logradouro: keyof T; bairro: keyof T; cidade: keyof T; estado: keyof T },
): Partial<T> {
  const r: Partial<T> = {};
  for (const k of ["logradouro", "bairro", "cidade", "estado"] as const) {
    const v = e[k];
    (r as Record<string, unknown>)[nomes[k] as string] = v ? v : (atual as Record<string, unknown>)[nomes[k] as string];
  }
  return r;
}
