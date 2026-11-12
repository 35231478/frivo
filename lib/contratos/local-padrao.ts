/**
 * 1º local coberto do contrato = endereço do cadastro do cliente. Puro (tela e testes).
 * - O cliente sem endereço (sem rua nem cidade) não sugere nada.
 * - Se o cliente já tem um local (unidade) com esse endereço, é ESSE que entra — nunca duplica.
 *   Mesmo endereço = mesma rua + número (sem acento/maiúsculas/pontuação) ou mesmo CEP + número.
 */
export interface EnderecoCliente {
  endereco?: string | null; numero?: string | null; complemento?: string | null; bairro?: string | null;
  cidade?: string | null; estado?: string | null; cep?: string | null;
}
export interface UnidadeEndereco {
  id: string; logradouro?: string | null; numero?: string | null; cep?: string | null; ativo?: boolean;
}
/** Campos para criar a unidade (POST /api/unidades) a partir do endereço do cliente */
export interface NovoLocal { nome: string; logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; estado: string; cep: string }

export const NOME_LOCAL_CLIENTE = "Endereço do cadastro";

const norm = (s?: string | null) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const digitos = (s?: string | null) => (s ?? "").replace(/\D/g, "");

export function temEndereco(c: EnderecoCliente | null | undefined): c is EnderecoCliente {
  return !!c && !!(norm(c.endereco) || norm(c.cidade));
}

export function mesmoEndereco(u: UnidadeEndereco, c: EnderecoCliente) {
  const num = norm(u.numero) === norm(c.numero);
  if (norm(u.logradouro) && norm(u.logradouro) === norm(c.endereco) && num) return true;
  return digitos(u.cep).length === 8 && digitos(u.cep) === digitos(c.cep) && num;
}

/** O local já cadastrado com o endereço do cliente (ou null). */
export function unidadeDoCliente(unidades: UnidadeEndereco[], c: EnderecoCliente | null | undefined) {
  if (!temEndereco(c)) return null;
  return unidades.find((u) => u.ativo !== false && mesmoEndereco(u, c)) ?? null;
}

export function novoLocalDoCliente(c: EnderecoCliente): NovoLocal {
  return {
    nome: NOME_LOCAL_CLIENTE, logradouro: c.endereco ?? "", numero: c.numero ?? "", complemento: c.complemento ?? "",
    bairro: c.bairro ?? "", cidade: c.cidade ?? "", estado: c.estado ?? "", cep: c.cep ?? "",
  };
}

export function textoEndereco(e: { logradouro?: string | null; endereco?: string | null; numero?: string | null; bairro?: string | null; cidade?: string | null; estado?: string | null }) {
  return [e.logradouro ?? e.endereco, e.numero, e.bairro, e.cidade, e.estado].filter(Boolean).join(", ");
}
