/**
 * E-MAIL DE LOGIN ÚNICO NO FRIVO INTEIRO — uma resposta só, usada em todo lugar que cria ou altera um login.
 *
 * Por quê: o login procura o e-mail em TODAS as empresas e fica com o primeiro que achar
 * (lib/auth.ts: `usuario.findFirst({ email, ativo })`; lib/auth-portal.ts: `contatoCliente.findFirst({ email,
 * senha não nula, ... })`). O mesmo e-mail em duas empresas deixaria o login ambíguo: a pessoa entraria na
 * empresa errada, ou nunca na certa.
 *
 * Dois ESPAÇOS de login, separados (decisão da Leva I.2):
 *  - USUÁRIOS (painel e app do técnico): tabela `usuarios`, tela /login, sessão do painel. Um e-mail é login
 *    de no máximo UM usuário, em qualquer empresa, ativo ou não (o inativo pode ser reativado).
 *  - CONTATOS COM ACESSO AO PORTAL: tabela `contatos_cliente` com senha (sem senha não é login), tela
 *    /portal/login, sessão própria do portal. Um e-mail é acesso de no máximo UM contato, em qualquer empresa.
 *  Um usuário e um contato de portal podem ter o mesmo e-mail: cada login procura só no seu espaço, então não há
 *  ambiguidade (ex.: o administrador de uma empresa que também é cliente de outra).
 *
 * Sem diferença de maiúsculas; o próprio registro não conflita consigo (`exceto`).
 */
import { prisma } from "@/lib/prisma";

export const MSG_EMAIL_LOGIN_EM_USO = "Este e-mail já é login de outro usuário do Frivo. Use outro e-mail.";
export const MSG_EMAIL_PORTAL_EM_USO = "Este e-mail já é acesso ao portal de outro contato do Frivo. Use outro e-mail.";

/** O e-mail como o login compara: sem espaços nas pontas, minúsculo. Vazio = null (não há o que conferir). */
export function normalizarEmailLogin(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e || null;
}

/** O filtro de "outro registro com este e-mail" (puro: os testes conferem a forma). */
export function filtroEmailEmUso(email: string, exceto?: string | null) {
  return { email: { equals: email, mode: "insensitive" as const }, ...(exceto ? { id: { not: exceto } } : {}) };
}

/** Já existe OUTRO usuário (de qualquer empresa) com este e-mail de login? */
export async function emailDeLoginEmUso(email: string | null | undefined, exceto?: string | null): Promise<boolean> {
  const e = normalizarEmailLogin(email);
  if (!e) return false;
  return !!(await prisma.usuario.findFirst({ where: filtroEmailEmUso(e, exceto), select: { id: true } }));
}

/** Já existe OUTRO contato com acesso ao portal (de qualquer empresa) com este e-mail? */
export async function emailDePortalEmUso(email: string | null | undefined, exceto?: string | null): Promise<boolean> {
  const e = normalizarEmailLogin(email);
  if (!e) return false;
  return !!(await prisma.contatoCliente.findFirst({ where: { ...filtroEmailEmUso(e, exceto), senha: { not: null } }, select: { id: true } }));
}
