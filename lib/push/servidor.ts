/**
 * O ENVIO das notificações push (servidor). Um caminho só para todo evento:
 *   enviarPush({ empresaId, tipo, alcance, usuarios, chave, mensagem })
 *  1. sem as chaves VAPID no ambiente, não faz nada (lib/push/config);
 *  2. confere cada pessoa: ativa, da empresa, com permissão para o tipo, com o tipo ligado na preferência
 *     e — no alcance "escritorio" — fora do modo técnico (o técnico nunca recebe o que é da empresa inteira);
 *  3. registra o envio em push_envios ANTES de mandar: a chave única (usuário, chave do evento) impede
 *     repetir o mesmo aviso (o mesmo evento de novo, ou o sino e o agendador vendo a mesma coisa);
 *  4. manda para cada aparelho da pessoa; o que o navegador recusa de vez (404/410) é apagado na hora.
 * Nunca lança: falha de push não pode derrubar quem gravou a OS (o erro vai para o log).
 */
import webpush from "web-push";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { permissoesDoUsuario } from "@/lib/permissoes";
import { emModoTecnico } from "@/lib/tecnico/modo";
import { chavesVapid } from "@/lib/push/config";
import { CHAVE_PREFERENCIA_PUSH, deveReceber, inscricaoMorta, lerPreferenciaPush, type MensagemPush, type QuemRecebe, type TipoPush } from "@/lib/push/tipos";

/** "pessoal": é destas pessoas (os técnicos da atividade, quem enviou a despesa); "escritorio": da empresa (sem o modo técnico) */
export type AlcancePush = "pessoal" | "escritorio";

export interface PedidoPush {
  empresaId: string;
  tipo: TipoPush;
  alcance: AlcancePush;
  usuarios: string[];
  /** Identifica o evento (ex.: "os-nova:<atividade>"): a mesma chave não vai duas vezes para a mesma pessoa */
  chave: string;
  /** A mensagem; pode depender de quem recebe (o técnico abre o app, o escritório abre a OS) */
  mensagem: MensagemPush | ((q: QuemRecebe) => MensagemPush);
}

export interface ResultadoPush {
  /** Quem recebeu e em quantos aparelhos */
  enviados: { usuarioId: string; aparelhos: number }[];
  /** Pulados: sem permissão/preferência, ou já recebido antes (chave repetida) */
  pulados: number;
  desligado?: boolean;
}

const VAZIO: ResultadoPush = { enviados: [], pulados: 0 };
/** Falhas seguidas (não definitivas) até desistir do aparelho */
export const MAX_FALHAS_APARELHO = 5;
/** Quanto tempo o serviço de push guarda a notificação se o aparelho estiver desligado */
const TTL_SEGUNDOS = 12 * 60 * 60;

/** Quem é cada pessoa para o push (permissões, modo técnico e técnico ligado). */
export async function quemSao(empresaId: string, usuarioIds: string[]): Promise<Map<string, QuemRecebe>> {
  const ids = [...new Set(usuarioIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const usuarios = await prisma.usuario.findMany({
    where: { id: { in: ids }, empresaId, ativo: true },
    select: { id: true, email: true, role: true, perfilAcesso: { select: { permissoes: true, ativo: true } } },
  });
  const emails = usuarios.map((u) => u.email.trim().toLowerCase());
  const tecnicos = emails.length ? await prisma.tecnico.findMany({
    where: { empresaId, ativo: true, email: { in: emails, mode: "insensitive" } }, select: { id: true, email: true },
  }) : [];
  const tecnicoDe = new Map(tecnicos.map((t) => [(t.email ?? "").trim().toLowerCase(), t.id]));
  return new Map(usuarios.map((u) => {
    const permissoes = permissoesDoUsuario(u);
    const tecnicoId = tecnicoDe.get(u.email.trim().toLowerCase()) ?? null;
    return [u.id, { permissoes, role: u.role, restrito: emModoTecnico({ role: u.role, permissoes, tecnicoId }), temTecnico: !!tecnicoId }];
  }));
}

/** Os usuários ligados a estes técnicos (mesmo e-mail, ativos, da empresa) — o "para você" do técnico. */
export async function usuariosDosTecnicos(empresaId: string, tecnicoIds: string[]): Promise<string[]> {
  const ids = [...new Set(tecnicoIds.filter(Boolean))];
  if (!ids.length) return [];
  const tecnicos = await prisma.tecnico.findMany({ where: { id: { in: ids }, empresaId }, select: { email: true } });
  const emails = tecnicos.map((t) => (t.email ?? "").trim()).filter(Boolean);
  if (!emails.length) return [];
  const usuarios = await prisma.usuario.findMany({
    where: { empresaId, ativo: true, OR: emails.map((e) => ({ email: { equals: e, mode: "insensitive" as const } })) },
    select: { id: true },
  });
  return usuarios.map((u) => u.id);
}

/** Todos os usuários ativos da empresa que têm algum aparelho inscrito (o filtro de permissão vem depois). */
export async function usuariosComAparelho(empresaId: string): Promise<string[]> {
  const subs = await prisma.pushSubscription.findMany({
    where: { usuario: { empresaId, ativo: true } }, select: { userId: true }, distinct: ["userId"],
  });
  return subs.map((s) => s.userId);
}

function configurar(): boolean {
  const chaves = chavesVapid();
  if (!chaves) return false;
  webpush.setVapidDetails(chaves.assunto, chaves.publica, chaves.privada);
  return true;
}

/** Manda a mensagem para todos os aparelhos de UMA pessoa; apaga os mortos. Devolve quantos aceitaram. */
async function mandarParaAparelhos(usuarioId: string, mensagem: MensagemPush): Promise<number> {
  const aparelhos = await prisma.pushSubscription.findMany({ where: { userId: usuarioId } });
  const corpo = JSON.stringify(mensagem);
  let ok = 0;
  await Promise.all(aparelhos.map(async (a) => {
    try {
      await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, corpo, { TTL: TTL_SEGUNDOS, urgency: "high" });
      ok++;
      await prisma.pushSubscription.update({ where: { id: a.id }, data: { ultimoEnvioEm: new Date(), falhas: 0 } }).catch(() => null);
    } catch (e) {
      const status = (e as { statusCode?: number })?.statusCode ?? null;
      if (inscricaoMorta(status) || a.falhas + 1 >= MAX_FALHAS_APARELHO) {
        // O navegador recusou de vez (desinstalou, revogou, expirou): a inscrição sai
        await prisma.pushSubscription.deleteMany({ where: { id: a.id } });
      } else {
        await prisma.pushSubscription.update({ where: { id: a.id }, data: { falhas: { increment: 1 } } }).catch(() => null);
      }
    }
  }));
  return ok;
}

export async function enviarPush(pedido: PedidoPush): Promise<ResultadoPush> {
  try {
    if (!configurar()) return { ...VAZIO, desligado: true };
    const quem = await quemSao(pedido.empresaId, pedido.usuarios);
    if (!quem.size) return VAZIO;
    const prefs = await prisma.preferenciaUsuario.findMany({
      where: { usuarioId: { in: [...quem.keys()] }, chave: CHAVE_PREFERENCIA_PUSH }, select: { usuarioId: true, valor: true },
    });
    const prefDe = new Map(prefs.map((p) => [p.usuarioId, lerPreferenciaPush(p.valor)]));
    const r: ResultadoPush = { enviados: [], pulados: 0 };
    for (const [usuarioId, q] of quem) {
      if (pedido.alcance === "escritorio" && q.restrito) { r.pulados++; continue; }
      if (!deveReceber(q, prefDe.get(usuarioId) ?? {}, pedido.tipo)) { r.pulados++; continue; }
      const msg = typeof pedido.mensagem === "function" ? pedido.mensagem(q) : pedido.mensagem;
      // Registra antes de mandar: a chave única barra a repetição (P2002 = já foi)
      let envioId: string;
      try {
        envioId = (await prisma.pushEnvio.create({
          data: { empresaId: pedido.empresaId, usuarioId, tipo: pedido.tipo, chave: pedido.chave.slice(0, 300), titulo: msg.titulo.slice(0, 200), url: msg.url },
          select: { id: true },
        })).id;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") { r.pulados++; continue; }
        throw e;
      }
      const aparelhos = await mandarParaAparelhos(usuarioId, msg);
      await prisma.pushEnvio.update({ where: { id: envioId }, data: { aparelhos } });
      r.enviados.push({ usuarioId, aparelhos });
    }
    return r;
  } catch (e) {
    console.error("[push] envio", pedido.tipo, (e as Error)?.message);
    return VAZIO;
  }
}
