/**
 * Aproveitar o contato que a própria consulta de CNPJ já devolve (lib/api/cnpj) para adicionar um
 * contato do cliente. Regra:
 *  - contato: se vier e-mail/telefone e ainda não houver contato igual (mesmo e-mail, ou mesmo
 *    telefone quando não há e-mail), adiciona um contato; nunca duplica.
 * Função pura (testável), sem React: a tela passa a fábrica do item novo (com _tempId etc.).
 * (O endereço não é preenchido pela consulta — fica no controle manual do usuário.)
 */

export interface ContatoConsulta { email: string; telefone: string }

const vazio = (v: unknown) => !String(v ?? "").trim();
const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

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

/* ───────── Cadastro rápido de cliente: a consulta SUGERE, nunca sobrescreve ───────── */

export const digitosDoDocumento = (v: unknown) => digitos(v);
/** CNPJ completo (14 dígitos, com ou sem máscara)? Só então dá para consultar. */
export const cnpjCompleto = (v: unknown) => digitos(v).length === 14;

/** O que a consulta de CNPJ (/api/cnpj) devolve e o cadastro rápido aproveita: só texto não vazio. */
export function sugestaoDoCnpj(resposta: unknown): Record<string, string> {
  const r = (resposta && typeof resposta === "object" ? resposta : {}) as Record<string, unknown>;
  const saida: Record<string, string> = {};
  for (const campo of ["nome", "nomeFantasia", "telefone"]) {
    const v = typeof r[campo] === "string" ? (r[campo] as string).trim() : "";
    if (v) saida[campo] = v;
  }
  return saida;
}

/**
 * Aplica a sugestão SÓ nos campos que existem no formulário e ainda estão vazios: o que o usuário já
 * digitou fica como está. Devolve os valores novos e a lista do que foi preenchido (para a tela dizer).
 */
export function aplicarSugestao(
  valores: Record<string, string>, sugestao: Record<string, string>, campos: readonly string[],
): { valores: Record<string, string>; preenchidos: string[] } {
  const novo = { ...valores };
  const preenchidos: string[] = [];
  for (const campo of campos) {
    if (!sugestao[campo] || !vazio(valores[campo])) continue;
    novo[campo] = sugestao[campo];
    preenchidos.push(campo);
  }
  return { valores: novo, preenchidos };
}

/** A frase que acompanha o preenchimento: de onde veio e o que entrou. Vazia a lista, diz que nada mudou. */
export function notaDaSugestao(preenchidos: readonly string[], rotulos: Record<string, string>, origem: string): string {
  if (!preenchidos.length) return `${origem}: nada a preencher, os campos já estavam preenchidos.`;
  const nomes = preenchidos.map((c) => (rotulos[c] ?? c).toLowerCase());
  const lista = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  return `${origem}: ${lista}. Confira antes de salvar.`;
}
