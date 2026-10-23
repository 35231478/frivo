import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { enviarEmail } from "@/lib/email";
import { impressaoDaSenha } from "@/lib/acesso/impressao-senha";
import { limparTentativas } from "@/lib/acesso/limite";

/**
 * "Esqueci minha senha" do PORTAL DO CLIENTE (UX-5/Y13) — mesmo desenho do fluxo interno
 * (lib/usuarios/convite.ts), sem coluna nova no banco e sem senha em texto:
 *  - token assinado (HMAC-SHA256 com o segredo do Auth) com id do CONTATO, validade e a
 *    "impressão" da senha atual → expira, é de USO ÚNICO (definiu a senha, o link morre),
 *    não serve para contato sem acesso/inativo e não pode ser forjado;
 *  - a marca `p: "pc"` separa este token dos links de usuário interno: um NUNCA vale no
 *    lugar do outro.
 */
export const VALIDADE_RECUPERACAO_PORTAL_MIN = 60;
export const MENSAGEM_ESQUECI_PORTAL =
  "Se este e-mail tiver acesso ao portal, um link para criar uma nova senha chega na caixa de entrada em instantes.";

function segredo(): string {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET não configurado: não dá para gerar o link de nova senha.");
  return s;
}
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const assinar = (corpo: string) => createHmac("sha256", segredo()).update(corpo).digest("base64url");

export function gerarTokenSenhaPortal(c: { id: string; senha: string }, agora = Date.now()): string {
  const dados = { u: c.id, e: agora + VALIDADE_RECUPERACAO_PORTAL_MIN * 60_000, f: impressaoDaSenha(c.senha), p: "pc" };
  const corpo = b64(JSON.stringify(dados));
  return `${corpo}.${assinar(corpo)}`;
}

export type ErroTokenPortal = "invalido" | "expirado" | "usado";
export const MENSAGEM_ERRO_TOKEN_PORTAL: Record<ErroTokenPortal, string> = {
  invalido: "Link inválido. Peça um novo em “Esqueci minha senha”, na tela de entrada do portal.",
  expirado: `Este link expirou (vale ${VALIDADE_RECUPERACAO_PORTAL_MIN} minutos). Peça um novo em “Esqueci minha senha”.`,
  usado: "Este link já foi usado. Se precisar, peça um novo em “Esqueci minha senha”.",
};

/** Confere assinatura, validade, uso único, a marca do PORTAL e se o contato segue com acesso. */
export async function verificarTokenPortal(token: string, agora = Date.now()): Promise<
  | { ok: true; contato: { id: string; nome: string; email: string } }
  | { ok: false; erro: ErroTokenPortal }
> {
  const [corpo, assinatura] = String(token ?? "").split(".");
  let dados: { u?: string; e?: number; f?: string; p?: string } = {};
  try { dados = JSON.parse(Buffer.from(corpo ?? "", "base64url").toString("utf8")); } catch { /* inválido abaixo */ }
  const erro = (e: ErroTokenPortal) => ({ ok: false as const, erro: e });
  if (!corpo || !assinatura) return erro("invalido");
  const esperado = Buffer.from(assinar(corpo));
  const recebido = Buffer.from(assinatura);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return erro("invalido");
  // Token de usuário interno (ou sem a marca do portal) NÃO entra aqui
  if (!dados?.u || !dados.e || !dados.f || dados.p !== "pc") return erro("invalido");
  if (agora > dados.e) return erro("expirado");
  const c = await prisma.contatoCliente.findFirst({
    where: { id: dados.u, ativo: true, senha: { not: null }, cliente: { ativo: true, portalAtivo: true } },
    select: { id: true, nome: true, email: true, senha: true },
  });
  if (!c?.email) return erro("invalido");
  if (impressaoDaSenha(c.senha!) !== dados.f) return erro("usado");
  return { ok: true, contato: { id: c.id, nome: c.nome, email: c.email } };
}

/** Define a senha pelo link: o link morre (impressão muda) e o bloqueio de login do portal zera. */
export async function definirSenhaPortal(token: string, senha: string) {
  const v = await verificarTokenPortal(token);
  if (!v.ok) return v;
  await prisma.contatoCliente.update({
    where: { id: v.contato.id },
    // A senha provisória anotada para o gestor deixa de valer junto
    data: { senha: await bcrypt.hash(senha, 12), senhaProvisoria: null },
  });
  await limparTentativas("PORTAL_LOGIN", { email: v.contato.email });
  return v;
}

/**
 * Manda o link para TODO contato com acesso ativo nesse e-mail (pode haver mais de uma empresa).
 * Quem decide se o e-mail existe é só o servidor — a resposta pública é sempre a mesma.
 */
export async function enviarRecuperacaoPortal(email: string, baseUrl: string): Promise<number> {
  const contatos = await prisma.contatoCliente.findMany({
    where: {
      email: { equals: email.trim(), mode: "insensitive" },
      ativo: true, senha: { not: null },
      cliente: { ativo: true, portalAtivo: true, empresa: { ativo: true } },
    },
    select: { id: true, nome: true, email: true, senha: true, empresaId: true },
  });
  let enviados = 0;
  for (const c of contatos) {
    const link = `${baseUrl.replace(/\/$/, "")}/portal/definir-senha?token=${encodeURIComponent(gerarTokenSenhaPortal({ id: c.id, senha: c.senha! }))}`;
    const r = await enviarEmail(c.empresaId, {
      tipo: "RECUPERACAO_SENHA", para: c.email!,
      variaveis: { usuario_nome: c.nome, link_definir_senha: link, validade_link: `${VALIDADE_RECUPERACAO_PORTAL_MIN} minutos` },
      referenciaId: c.id, referenciaTipo: "CONTATO_CLIENTE",
    }).catch((e: unknown) => ({ ok: false, erro: e instanceof Error ? e.message : "Erro no envio." }));
    if (r.ok) enviados++;
    else console.warn(`[portal] link de nova senha não enviado (contato ${c.id}): ${r.erro}`);
  }
  return enviados;
}
