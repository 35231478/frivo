import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Limite de tentativas (anti força bruta). Cada tentativa que "conta" vira uma linha em
 * tentativas_acesso; passou do máximo dentro da janela, o alvo fica bloqueado até a tentativa mais
 * antiga sair da janela. Conta por e-mail E por IP (quem tenta vários e-mails do mesmo IP também
 * para) — e o bloqueio vale igual para e-mail cadastrado ou não, então não revela quem existe.
 *
 * A chave é só o hash do e-mail/IP/usuário (nunca o texto). Falha do banco (ou a tabela ainda não
 * criada) NÃO bloqueia ninguém: sem o limite o login continua como era.
 */
const MIN = 60_000;

export type TipoTentativa = "LOGIN" | "ESQUECI_SENHA" | "TROCA_SENHA" | "PORTAL_LOGIN" | "CHAMADO_PUBLICO";
type Alvo = "email" | "ip" | "usuario";

export const LIMITES: Record<TipoTentativa, { janelaMs: number; max: Partial<Record<Alvo, number>> }> = {
  LOGIN: { janelaMs: 15 * MIN, max: { email: 5, ip: 20 } },        // senha errada
  ESQUECI_SENHA: { janelaMs: 60 * MIN, max: { email: 3, ip: 10 } }, // pedidos de link
  TROCA_SENHA: { janelaMs: 15 * MIN, max: { usuario: 5 } },          // senha atual errada no perfil
  PORTAL_LOGIN: { janelaMs: 15 * MIN, max: { email: 5, ip: 20 } },   // senha errada no portal do cliente
  CHAMADO_PUBLICO: { janelaMs: 60 * MIN, max: { ip: 10, usuario: 15 } }, // abertura de chamado (QR público / portal)
};
const RETENCAO_MS = 24 * 60 * MIN;

export interface Alvos { email?: string | null; ip?: string | null; usuarioId?: string | null }

/** Hash de uma senha qualquer: e-mail sem cadastro também passa pelo bcrypt (mesmo tempo de resposta). */
export const HASH_FICTICIO = "$2a$12$7iO7A0TNVR0wJBH13ZoMZO3pBDvS3G3396vVIYEYECixnoKDcn1yW";

const hash = (s: string) => createHash("sha256").update(s).digest("base64url").slice(0, 32);

function chaves(tipo: TipoTentativa, alvos: Alvos) {
  const max = LIMITES[tipo].max;
  const valores: [Alvo, string | null | undefined][] = [
    ["email", alvos.email?.trim().toLowerCase()], ["ip", alvos.ip?.trim()], ["usuario", alvos.usuarioId],
  ];
  return valores.flatMap(([alvo, v]) => (v && max[alvo] ? [{ chave: `${alvo}:${hash(v)}`, max: max[alvo]! }] : []));
}

export type Bloqueio = { bloqueado: false } | { bloqueado: true; liberaEm: Date; minutos: number };

/** Algum alvo já chegou ao máximo dentro da janela? */
export async function conferirBloqueio(tipo: TipoTentativa, alvos: Alvos, agora = new Date()): Promise<Bloqueio> {
  const { janelaMs } = LIMITES[tipo];
  let liberaEm: Date | null = null;
  try {
    for (const { chave, max } of chaves(tipo, alvos)) {
      const recentes = await prisma.tentativaAcesso.findMany({
        where: { tipo, chave, criadoEm: { gt: new Date(agora.getTime() - janelaMs) } },
        orderBy: { criadoEm: "desc" }, take: max, select: { criadoEm: true },
      });
      if (recentes.length < max) continue;
      const libera = new Date(recentes[max - 1].criadoEm.getTime() + janelaMs);
      if (!liberaEm || libera > liberaEm) liberaEm = libera;
    }
  } catch (e) {
    console.error("[acesso] limite de tentativas indisponível", e);
    return { bloqueado: false };
  }
  if (!liberaEm) return { bloqueado: false };
  return { bloqueado: true, liberaEm, minutos: Math.max(1, Math.ceil((liberaEm.getTime() - agora.getTime()) / MIN)) };
}

/**
 * Registra uma tentativa para cada alvo (e apaga as que já passaram de 1 dia).
 * Devolve os ids criados: um login que REGISTRA ANTES de validar a senha (para
 * requisições paralelas não furarem o limite) apaga os seus com `apagarTentativas`
 * quando a senha está certa — sucesso não conta contra o IP do escritório.
 */
export async function registrarTentativa(tipo: TipoTentativa, alvos: Alvos, agora = new Date()): Promise<string[]> {
  const cs = chaves(tipo, alvos);
  if (!cs.length) return [];
  const linhas = cs.map(({ chave }) => ({ id: randomUUID(), tipo, chave, criadoEm: agora }));
  try {
    await prisma.tentativaAcesso.createMany({ data: linhas });
    await prisma.tentativaAcesso.deleteMany({ where: { criadoEm: { lt: new Date(agora.getTime() - RETENCAO_MS) } } });
    return linhas.map((l) => l.id);
  } catch (e) {
    console.error("[acesso] não foi possível registrar a tentativa", e);
    return [];
  }
}

/** Apaga registros específicos (os da própria requisição, quando o login deu certo). */
export async function apagarTentativas(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    await prisma.tentativaAcesso.deleteMany({ where: { id: { in: ids } } });
  } catch (e) {
    console.error("[acesso] não foi possível apagar os registros", e);
  }
}

/** Deu certo: zera as falhas do e-mail/usuário. As do IP continuam contando. */
export async function limparTentativas(tipo: TipoTentativa, alvos: Pick<Alvos, "email" | "usuarioId">): Promise<void> {
  const cs = chaves(tipo, { email: alvos.email, usuarioId: alvos.usuarioId });
  if (!cs.length) return;
  try {
    await prisma.tentativaAcesso.deleteMany({ where: { tipo, chave: { in: cs.map((c) => c.chave) } } });
  } catch (e) {
    console.error("[acesso] não foi possível limpar as tentativas", e);
  }
}

/** IP de quem chamou (na Vercel o x-forwarded-for é preenchido pela própria plataforma). */
export function ipDaRequisicao(headers: Headers | undefined): string | null {
  const xff = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || headers?.get("x-real-ip")?.trim() || null;
}
