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
