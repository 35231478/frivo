/**
 * Aproveitar o endereço e o contato que a própria consulta de CNPJ já devolve (lib/api/cnpj) para
 * preencher o endereço principal e um contato do cliente — sem segunda chamada ao ViaCEP. Regras:
 *  - endereço: se o cliente não tem nenhum, cria o principal preenchido; se já tem, preenche só os
 *    campos VAZIOS do principal (nunca sobrescreve o que já está lá);
 *  - contato: se vier e-mail/telefone e ainda não houver contato igual (mesmo e-mail, ou mesmo
 *    telefone quando não há e-mail), adiciona um contato; nunca duplica.
 * Funções puras (testáveis), sem React: a tela passa a fábrica do item novo (com _tempId etc.).
 */

export interface EnderecoConsulta {
  logradouro: string; numero: string; complemento: string;
  bairro: string; cidade: string; estado: string; cep: string;
}
export interface ContatoConsulta { email: string; telefone: string }

/** Campos de endereço que a consulta de CNPJ preenche. */
export const CAMPOS_ENDERECO = ["logradouro", "numero", "complemento", "bairro", "cidade", "estado", "cep"] as const;

const vazio = (v: unknown) => !String(v ?? "").trim();
const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/**
 * Mescla o endereço da consulta na lista de endereços do cliente. `novo` cria um item em branco
 * (com _tempId etc.). Devolve a lista nova e se algo foi preenchido.
 */
export function mesclarEnderecoPrincipal<U>(
  unidades: U[], end: EnderecoConsulta, novo: () => U,
): { unidades: U[]; preencheu: boolean } {
  const rec = (u: U) => u as unknown as Record<string, unknown>;
  const temDados = CAMPOS_ENDERECO.some((c) => !vazio(end[c]));
  if (!temDados) return { unidades, preencheu: false };

  if (unidades.length === 0) {
    const u = novo();
    if (vazio(rec(u).nome)) rec(u).nome = "Matriz";
    rec(u).principal = true;
    for (const c of CAMPOS_ENDERECO) rec(u)[c] = end[c] ?? "";
    return { unidades: [u], preencheu: true };
  }

  // Já existe endereço: preenche só os campos VAZIOS do principal (ou do 1º, se nenhum é principal).
  const idxPrincipal = unidades.findIndex((u) => rec(u).principal === true);
  const alvo = idxPrincipal >= 0 ? idxPrincipal : 0;
  let preencheu = false;
  const novas = unidades.map((u, i) => {
    if (i !== alvo) return u;
    const nu = { ...rec(u) };
    for (const c of CAMPOS_ENDERECO) {
      if (vazio(nu[c]) && !vazio(end[c])) { nu[c] = end[c]; preencheu = true; }
    }
    return nu as unknown as U;
  });
  return { unidades: novas, preencheu };
}

/**
 * Adiciona um contato a partir do e-mail/telefone da consulta, sem duplicar. `novo` cria um contato
 * em branco. `nomeCliente` entra como nome do contato quando não há um melhor.
 */
export function mesclarContato<C>(
  contatos: C[], contato: ContatoConsulta, nomeCliente: string, novo: () => C,
): { contatos: C[]; adicionou: boolean } {
  const rec = (c: C) => c as unknown as Record<string, unknown>;
  const email = String(contato.email ?? "").trim();
  const telefone = String(contato.telefone ?? "").trim();
  if (!email && !telefone) return { contatos, adicionou: false };

  const jaExiste = contatos.some((c) => {
    if (email) return String(rec(c).email ?? "").trim().toLowerCase() === email.toLowerCase();
    return !!telefone && digitos(rec(c).telefone) === digitos(telefone);
  });
  if (jaExiste) return { contatos, adicionou: false };

  const c = novo();
  const alvo = rec(c);
  if (vazio(alvo.nome)) alvo.nome = nomeCliente.trim() || "Contato";
  alvo.email = email;
  alvo.telefone = telefone;
  alvo.principal = contatos.length === 0;
  return { contatos: [...contatos, c], adicionou: true };
}
