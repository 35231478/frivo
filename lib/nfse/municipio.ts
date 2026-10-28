/**
 * Código IBGE do município (7 dígitos) a partir do endereço da empresa:
 *  1. pelo CEP no ViaCEP (o campo `ibge` da resposta);
 *  2. se não der, pela UF + nome da cidade na lista de municípios do IBGE (BrasilAPI),
 *     comparando sem acento e sem maiúsculas.
 * Só sugere: a tela deixa ajustar o código à mão.
 */
import { ehCodigoIbge, soDigitos } from "@/lib/nfse/regras";

export interface Municipio { codigo: string; nome: string; uf: string; fonte: "cep" | "cidade" }

const TIMEOUT_MS = 8000;

/** "São Paulo" → "sao paulo" (para comparar nomes de cidade) */
export const normalizarNome = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function json(url: string): Promise<unknown> {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Frivo/1.0" }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function buscarMunicipio(p: { cep?: string | null; cidade?: string | null; uf?: string | null }): Promise<Municipio | null> {
  const cep = soDigitos(p.cep);
  if (cep.length === 8) {
    const v = (await json(`https://viacep.com.br/ws/${cep}/json/`)) as { ibge?: string; localidade?: string; uf?: string; erro?: unknown } | null;
    if (v && !v.erro && ehCodigoIbge(v.ibge) && v.localidade && v.uf) return { codigo: v.ibge!, nome: v.localidade, uf: v.uf.toUpperCase(), fonte: "cep" };
  }
  const uf = (p.uf ?? "").trim().toUpperCase();
  const cidade = normalizarNome(p.cidade ?? "");
  if (!/^[A-Z]{2}$/.test(uf) || !cidade) return null;
  const lista = (await json(`https://brasilapi.com.br/api/ibge/municipios/v1/${uf}`)) as { nome?: string; codigo_ibge?: string }[] | null;
  const achado = Array.isArray(lista) ? lista.find((m) => m.nome && normalizarNome(m.nome) === cidade && ehCodigoIbge(String(m.codigo_ibge ?? ""))) : undefined;
  if (!achado) return null;
  // A lista vem em maiúsculas ("SAO PAULO"): mostra o nome como está no cadastro da empresa
  return { codigo: String(achado.codigo_ibge), nome: (p.cidade ?? "").trim() || achado.nome!, uf, fonte: "cidade" };
}
