import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { enviarEmail } from "@/lib/email";
import { impressaoDaSenha } from "@/lib/acesso/impressao-senha";
import { limparTentativas } from "@/lib/acesso/limite";

/**
 * Convite para o usuário DEFINIR a própria senha — sem coluna nova no banco e sem senha em texto.
 *
 * O link leva um token assinado (HMAC-SHA256 com o segredo do Auth) com: id do usuário, validade
 * e uma "impressão" da senha atual (hash do hash). Assim o link:
 *  - expira (VALIDADE_HORAS);
 *  - é de USO ÚNICO: depois que a senha é definida a impressão muda e o link morre;
 *  - não serve para usuário inativo nem de outra empresa;
 *  - não pode ser forjado sem o segredo do servidor.
 * O usuário novo nasce com uma senha aleatória que ninguém conhece (não entra até definir a dele).
 *
 * O mesmo link serve para "Esqueci minha senha" (finalidade "recuperacao", marca `p: "r"`): vale
 * VALIDADE_RECUPERACAO_MIN e as mensagens de erro mandam pedir outro link na tela de login.
 */
export const VALIDADE_HORAS = 72;
export const VALIDADE_RECUPERACAO_MIN = 60;
export { SENHA_MINIMA } from "@/lib/acesso/senha";

export type FinalidadeLink = "convite" | "recuperacao";

function segredo(): string {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET não configurado: não dá para gerar convites.");
  return s;
}
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const assinar = (corpo: string) => createHmac("sha256", segredo()).update(corpo).digest("base64url");
const impressao = impressaoDaSenha;

/** Senha inicial impossível de adivinhar (o hash entra no banco; o texto não sai daqui). */
export async function senhaInicialAleatoria(): Promise<string> {
  return bcrypt.hash(randomBytes(32).toString("base64url"), 12);
}

export function gerarTokenSenha(u: { id: string; senha: string }, finalidade: FinalidadeLink, agora = Date.now()): string {
  const validade = finalidade === "recuperacao" ? VALIDADE_RECUPERACAO_MIN * 60_000 : VALIDADE_HORAS * 3600_000;
  const dados = { u: u.id, e: agora + validade, f: impressao(u.senha), ...(finalidade === "recuperacao" && { p: "r" }) };
  const corpo = b64(JSON.stringify(dados));
  return `${corpo}.${assinar(corpo)}`;
}

export const gerarTokenConvite = (u: { id: string; senha: string }, agora = Date.now()) => gerarTokenSenha(u, "convite", agora);

export type ErroConvite = "invalido" | "expirado" | "usado";
export const MENSAGEM_ERRO_CONVITE: Record<ErroConvite, string> = {
  invalido: "Link inválido. Peça um novo convite ao administrador.",
  expirado: "Este link expirou. Peça um novo convite ao administrador.",
  usado: "Este link já foi usado. Se esqueceu a senha, peça um novo convite ao administrador.",
};
export const MENSAGEM_ERRO_RECUPERACAO: Record<ErroConvite, string> = {
  invalido: "Link inválido. Peça um novo em “Esqueci minha senha”, na tela de login.",
  expirado: `Este link expirou (vale ${VALIDADE_RECUPERACAO_MIN} minutos). Peça um novo em “Esqueci minha senha”, na tela de login.`,
  usado: "Este link já foi usado. Se precisar, peça um novo em “Esqueci minha senha”, na tela de login.",
};
export const mensagemErroLink = (erro: ErroConvite, finalidade: FinalidadeLink) =>
  (finalidade === "recuperacao" ? MENSAGEM_ERRO_RECUPERACAO : MENSAGEM_ERRO_CONVITE)[erro];

/** Confere assinatura, validade, uso único e se o usuário segue ativo. */
export async function verificarTokenConvite(token: string, agora = Date.now()): Promise<
  | { ok: true; finalidade: FinalidadeLink; usuario: { id: string; nome: string; email: string; empresaId: string } }
  | { ok: false; finalidade: FinalidadeLink; erro: ErroConvite }
> {
  const [corpo, assinatura] = String(token ?? "").split(".");
  let dados: { u?: string; e?: number; f?: string; p?: string } = {};
  try { dados = JSON.parse(Buffer.from(corpo ?? "", "base64url").toString("utf8")); } catch { /* inválido abaixo */ }
  // Só escolhe o texto do erro; quem decide se o link vale é a assinatura.
  const finalidade: FinalidadeLink = dados?.p === "r" ? "recuperacao" : "convite";
  const erro = (e: ErroConvite) => ({ ok: false as const, finalidade, erro: e });
  if (!corpo || !assinatura) return erro("invalido");
  const esperado = Buffer.from(assinar(corpo));
  const recebido = Buffer.from(assinatura);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return erro("invalido");
  if (!dados?.u || !dados.e || !dados.f) return erro("invalido");
  if (agora > dados.e) return erro("expirado");
  const u = await prisma.usuario.findUnique({ where: { id: dados.u }, select: { id: true, nome: true, email: true, empresaId: true, senha: true, ativo: true, empresa: { select: { ativo: true } } } });
  if (!u || !u.ativo || !u.empresa.ativo) return erro("invalido");
  if (impressao(u.senha) !== dados.f) return erro("usado");
  return { ok: true, finalidade, usuario: { id: u.id, nome: u.nome, email: u.email, empresaId: u.empresaId } };
}

/**
 * Define a senha pelo link (convite ou recuperação). Com isso o link deixa de valer, as sessões
 * abertas com a senha antiga caem (lib/sessao-ativa) e o bloqueio de login do e-mail é zerado.
 */
export async function definirSenhaPorConvite(token: string, senha: string) {
  const v = await verificarTokenConvite(token);
  if (!v.ok) return v;
  await prisma.usuario.update({ where: { id: v.usuario.id }, data: { senha: await bcrypt.hash(senha, 12) } });
  await limparTentativas("LOGIN", { email: v.usuario.email });
  return v;
}

/**
 * Gera o convite e tenta mandar por e-mail (modelo "CONVITE_USUARIO", editável em Configurações ›
 * E-mail). Sem e-mail configurado, devolve o LINK para quem convidou repassar — nunca uma senha.
 */
export async function enviarConvite(usuarioId: string, baseUrl: string): Promise<{ enviadoPorEmail: boolean; link?: string; erroEmail?: string }> {
  const u = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId }, select: { id: true, nome: true, email: true, senha: true, empresaId: true } });
  const link = `${baseUrl.replace(/\/$/, "")}/definir-senha?token=${encodeURIComponent(gerarTokenConvite(u))}`;
  const r = await enviarEmail(u.empresaId, {
    tipo: "CONVITE_USUARIO", para: u.email,
    variaveis: { usuario_nome: u.nome, link_definir_senha: link, validade_convite: `${VALIDADE_HORAS} horas` },
    referenciaId: u.id, referenciaTipo: "USUARIO",
  }).catch((e: unknown) => ({ ok: false, erro: e instanceof Error ? e.message : "Erro no envio." }));
  return r.ok ? { enviadoPorEmail: true } : { enviadoPorEmail: false, link, erroEmail: r.erro };
}
