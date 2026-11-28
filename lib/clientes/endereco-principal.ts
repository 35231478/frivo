/**
 * Leva H — o ENDEREÇO PRINCIPAL do cliente (o de cobrança, o que vai na nota fiscal como tomador): campos do
 * próprio cadastro (Cliente.endereco/numero/complemento/bairro/cidade/estado/cep). Os outros endereços são os
 * LOCAIS DE ATENDIMENTO (unidades), na aba Endereços. Regra pura: sem banco.
 */

export const CAMPOS_ENDERECO = ["cep", "endereco", "numero", "complemento", "bairro", "cidade", "estado"] as const;
export type CampoEndereco = (typeof CAMPOS_ENDERECO)[number];
export type EnderecoPrincipal = Partial<Record<CampoEndereco, string | null>>;

const limpo = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * O que a consulta do CNPJ preenche no endereço principal: só os campos VAZIOS (o que a pessoa já digitou fica).
 * Devolve só os campos a mudar ({} = nada a preencher).
 */
export function enderecoDaConsulta(consulta: EnderecoPrincipal, atual: EnderecoPrincipal): Partial<Record<CampoEndereco, string>> {
  const patch: Partial<Record<CampoEndereco, string>> = {};
  for (const c of CAMPOS_ENDERECO) {
    const novo = limpo(consulta[c]);
    if (novo && !limpo(atual[c])) patch[c] = c === "estado" ? novo.toUpperCase().slice(0, 2) : novo;
  }
  return patch;
}

/** Tem endereço? (rua ou CEP ou cidade: o suficiente para virar um local de atendimento) */
export function temEndereco(e: EnderecoPrincipal): boolean {
  return !!(limpo(e.endereco) || limpo(e.cep) || limpo(e.cidade));
}

/** "Av. Paulista, 1000 — sala 3 · Bela Vista · São Paulo/SP · CEP 01310-100" (só o que existe) */
export function enderecoPrincipalEmUmaLinha(e: EnderecoPrincipal): string {
  const rua = [limpo(e.endereco), limpo(e.numero)].filter(Boolean).join(", ");
  const comp = limpo(e.complemento);
  const cidade = [limpo(e.cidade), limpo(e.estado)].filter(Boolean).join("/");
  const cep = limpo(e.cep);
  return [rua + (comp ? ` — ${comp}` : ""), limpo(e.bairro), cidade, cep ? `CEP ${cep}` : ""].filter(Boolean).join(" · ");
}

const chave = (v: unknown) => limpo(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

/** O mesmo lugar? (rua + número, ou CEP + número; sem rua nem CEP, não dá para dizer: não é) */
export function mesmoEndereco(a: { logradouro?: string | null; numero?: string | null; cep?: string | null }, b: EnderecoPrincipal): boolean {
  const num = chave(a.numero) === chave(b.numero);
  if (!num) return false;
  if (chave(a.logradouro) && chave(a.logradouro) === chave(b.endereco)) return true;
  return !!chave(a.cep) && chave(a.cep) === chave(b.cep);
}

type LocalInformado = { logradouro?: string | null; numero?: string | null; cep?: string | null; principal?: boolean };

/**
 * Cliente NOVO com endereço principal: o servidor cria o local "Principal" com esse endereço (as OS, os
 * equipamentos e o PMOC precisam de um local), e os outros locais informados entram como secundários.
 * Sem endereço principal, ou se um dos locais informados já é esse endereço, nada é criado.
 */
export function localDoEnderecoPrincipal(e: EnderecoPrincipal, locaisInformados: readonly LocalInformado[] = []) {
  if (!temEndereco(e) || locaisInformados.some((l) => mesmoEndereco(l, e))) return null;
  return {
    nome: "Principal", principal: true,
    logradouro: limpo(e.endereco) || undefined, numero: limpo(e.numero) || undefined, complemento: limpo(e.complemento) || undefined,
    bairro: limpo(e.bairro) || undefined, cidade: limpo(e.cidade) || undefined, estado: limpo(e.estado).toUpperCase().slice(0, 2) || undefined, cep: limpo(e.cep) || undefined,
  };
}

/** Os locais a criar com o cliente novo: o "Principal" (do endereço principal) primeiro; os informados depois, secundários. */
export function locaisDoClienteNovo<T extends LocalInformado>(e: EnderecoPrincipal, informados: readonly T[]) {
  const principal = localDoEnderecoPrincipal(e, informados);
  if (!principal) return { principal: null, locais: [...informados] };
  return { principal, locais: informados.map((l) => ({ ...l, principal: false })) };
}
