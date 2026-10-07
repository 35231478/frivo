import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { enviarEmail } from "@/lib/email";

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
 */
export const VALIDADE_HORAS = 72;
export const SENHA_MINIMA = 8;

function segredo(): string {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET não configurado: não dá para gerar convites.");
  return s;
}
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const assinar = (corpo: string) => createHmac("sha256", segredo()).update(corpo).digest("base64url");
const impressao = (senhaHash: string) => createHash("sha256").update(senhaHash).digest("base64url").slice(0, 22);

/** Senha inicial impossível de adivinhar (o hash entra no banco; o texto não sai daqui). */
export async function senhaInicialAleatoria(): Promise<string> {
  return bcrypt.hash(randomBytes(32).toString("base64url"), 12);
}

export function gerarTokenConvite(u: { id: string; senha: string }, agora = Date.now()): string {
  const corpo = b64(JSON.stringify({ u: u.id, e: agora + VALIDADE_HORAS * 3600_000, f: impressao(u.senha) }));
  return `${corpo}.${assinar(corpo)}`;
}

export type ErroConvite = "invalido" | "expirado" | "usado";
export const MENSAGEM_ERRO_CONVITE: Record<ErroConvite, string> = {
  invalido: "Link inválido. Peça um novo convite ao administrador.",
  expirado: "Este link expirou. Peça um novo convite ao administrador.",
  usado: "Este link já foi usado. Se esqueceu a senha, peça um novo convite ao administrador.",
};

/** Confere assinatura, validade, uso único e se o usuário segue ativo. */
export async function verificarTokenConvite(token: string, agora = Date.now()):
  Promise<{ ok: true; usuario: { id: string; nome: string; email: string; empresaId: string } } | { ok: false; erro: ErroConvite }> {
  const [corpo, assinatura] = String(token ?? "").split(".");
  if (!corpo || !assinatura) return { ok: false, erro: "invalido" };
  const esperado = Buffer.from(assinar(corpo));
  const recebido = Buffer.from(assinatura);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return { ok: false, erro: "invalido" };
  let dados: { u?: string; e?: number; f?: string };
  try { dados = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")); } catch { return { ok: false, erro: "invalido" }; }
  if (!dados.u || !dados.e || !dados.f) return { ok: false, erro: "invalido" };
  if (agora > dados.e) return { ok: false, erro: "expirado" };
  const u = await prisma.usuario.findUnique({ where: { id: dados.u }, select: { id: true, nome: true, email: true, empresaId: true, senha: true, ativo: true, empresa: { select: { ativo: true } } } });
  if (!u || !u.ativo || !u.empresa.ativo) return { ok: false, erro: "invalido" };
  if (impressao(u.senha) !== dados.f) return { ok: false, erro: "usado" };
  return { ok: true, usuario: { id: u.id, nome: u.nome, email: u.email, empresaId: u.empresaId } };
}

/** Define a senha pelo convite (e com isso o link deixa de valer). */
export async function definirSenhaPorConvite(token: string, senha: string) {
  const v = await verificarTokenConvite(token);
  if (!v.ok) return v;
  await prisma.usuario.update({ where: { id: v.usuario.id }, data: { senha: await bcrypt.hash(senha, 12) } });
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
