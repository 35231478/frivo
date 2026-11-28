/**
 * HOTFIX push + comentários — PONTA A PONTA, com o `web-push` DE VERDADE contra um serviço de push de teste (um
 * servidor HTTPS local que faz o papel do FCM/Apple) e PostgreSQL real:
 *  - o envio assina com VAPID (o cabeçalho leva a chave pública do servidor), cifra a mensagem (aes128gcm) e o
 *    aparelho consegue DECIFRAR com as chaves dele — e o resultado de cada aparelho fica no envio;
 *  - recusas: 403 de chave VAPID diferente e 410 apagam a inscrição; 500 conta falha e guarda o motivo;
 *  - a inscrição confere a chave: com outra, 409 "reinscrever" (e só a impressão da chave é gravada);
 *  - a rota de diagnóstico: só ADMIN; mostra o par de chaves conferido (sem a chave), o resultado por aparelho, e
 *    nenhuma chave aparece na resposta;
 *  - o comentário do técnico avisa quem está ligado à OS no escritório (e, sem ninguém ligado com aparelho, o escritório);
 *  - o escritório lê TODOS os comentários da OS, com a marca da atividade e o "novo".
 * As chaves VAPID e as do aparelho são geradas na hora, só na memória do teste — nada é impresso nem gravado.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createECDH, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import webpush from "web-push";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ece = require("http_ece");
import { PRESETS, permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_hotfix_push_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const h = vi.hoisted(() => ({ sessao: null as any, pendentes: [] as (() => unknown)[] }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.sessao) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { h.pendentes.push(fn); } }));
const depoisDaResposta = async () => { const fs = h.pendentes.splice(0); for (const f of fs) await f(); };

const b64u = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/* ───────── o serviço de push de teste (HTTPS local) ───────── */
interface Pedido { caminho: string; headers: Record<string, string | string[] | undefined>; corpo: Buffer }
const servico = { pedidos: [] as Pedido[], resposta: {} as Record<string, { status: number; corpo?: string }>, porta: 0, servidor: null as https.Server | null, dir: "" };
const endpoint = (nome: string) => `https://127.0.0.1:${servico.porta}/push/${nome}`;

/** Um aparelho de verdade: as chaves ECDH e o segredo de autenticação (o que o navegador gera ao inscrever) */
function aparelho() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, p256dh: b64u(ecdh.getPublicKey()), authB64: b64u(auth) };
}

const USUARIOS = {
  uAdmin: { role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null, email: "admin@clima.exemplo" },
  uResp: { role: "OPERADOR", permissoes: permissoesTotais(), tecnicoId: null, email: "resp@clima.exemplo" },
  uOutro: { role: "OPERADOR", permissoes: permissoesTotais(), tecnicoId: null, email: "outro@clima.exemplo" },
  uCarlos: { role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "tCarlos", email: "carlos@clima.exemplo" },
} as const;
const como = (id: keyof typeof USUARIOS) => {
  const u = USUARIOS[id];
  h.sessao = { user: { id, name: id, email: u.email, empresaId: "e1", empresaNome: "x", role: u.role, permissoes: u.permissoes, tecnicoId: u.tecnicoId } };
};
async function rota(caminho: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/${caminho}/route`);
  const req = new NextRequest("https://app.exemplo.com/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const texto = await res.text();
  return { status: res.status, texto, json: (() => { try { return JSON.parse(texto); } catch { return null; } })() };
}

describe.skipIf(!URL_PG)("hotfix push + comentários — web-push de verdade, PostgreSQL real", () => {
  let prisma: any;
  let srv: typeof import("@/lib/push/servidor");
  let ev: typeof import("@/lib/push/eventos");
  const vapid = webpush.generateVAPIDKeys(); // só na memória do teste
  const outroPar = webpush.generateVAPIDKeys();
  const dispositivos: Record<string, ReturnType<typeof aparelho>> = {};

  async function inscrever(id: string, usuario: keyof typeof USUARIOS, nome = id) {
    const a = aparelho();
    dispositivos[nome] = a;
    await prisma.pushSubscription.create({ data: { id, userId: usuario, empresaId: "e1", endpoint: endpoint(nome), p256dh: a.p256dh, auth: a.authB64, userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130" } });
  }
  /** Decifra o que o serviço de push recebeu, com as chaves do aparelho (o que o navegador faz) */
  const decifrar = (p: Pedido) => {
    const a = dispositivos[p.caminho.replace("/push/", "")];
    return JSON.parse(ece.decrypt(p.corpo, { version: "aes128gcm", privateKey: a.ecdh, authSecret: a.auth }).toString("utf8"));
  };

  beforeAll(async () => {
    // O serviço de push de teste: HTTPS com certificado gerado na hora (o web-push só fala HTTPS)
    servico.dir = mkdtempSync(path.join(os.tmpdir(), "push-teste-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(servico.dir, "k.pem"), "-out", path.join(servico.dir, "c.pem"), "-days", "1", "-subj", "/CN=127.0.0.1"], { stdio: "pipe" });
    servico.servidor = https.createServer({ key: readFileSync(path.join(servico.dir, "k.pem")), cert: readFileSync(path.join(servico.dir, "c.pem")) }, (req, res) => {
      const partes: Buffer[] = [];
      req.on("data", (d) => partes.push(d));
      req.on("end", () => {
        const caminho = req.url ?? "";
        servico.pedidos.push({ caminho, headers: req.headers, corpo: Buffer.concat(partes) });
        const r = servico.resposta[caminho] ?? { status: 201 };
        res.writeHead(r.status, { "Content-Type": "text/plain" });
        res.end(r.corpo ?? "");
      });
    });
    await new Promise<void>((ok) => servico.servidor!.listen(0, "127.0.0.1", () => ok()));
    servico.porta = (servico.servidor!.address() as { port: number }).port;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // só o certificado do serviço de teste
    vi.stubEnv("VAPID_PUBLIC_KEY", vapid.publicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", vapid.privateKey);
    vi.stubEnv("VAPID_SUBJECT", "mailto:suporte@ficticio.test");

    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    srv = await import("@/lib/push/servidor");
    ev = await import("@/lib/push/eventos");
    await Promise.all(["api/push/subscribe", "api/push/diagnostico", "api/push/teste", "api/ordens/[id]/comentarios"].map((r) => import(/* @vite-ignore */ `@/app/${r}/route`)));

    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total (fictícia)", cnpj: "12.345.678/0001-90", email: "c@x.test" } });
    // o escritório com um perfil que vê e edita OS (as permissões do push vêm do cadastro, não da sessão)
    await prisma.perfilAcesso.create({ data: { id: "pEscritorio", empresaId: "e1", nome: "Escritório", tipo: "SUPERVISOR", permissoes: permissoesTotais() } });
    for (const [id, u] of Object.entries(USUARIOS)) await prisma.usuario.create({ data: { id, empresaId: "e1", nome: id, email: u.email, senha: "x", role: u.role, ...(u.role === "OPERADOR" ? { perfilAcessoId: "pEscritorio" } : {}) } });
    await prisma.tecnico.create({ data: { id: "tCarlos", empresaId: "e1", nome: "Carlos", cpf: "1", telefone: "1", email: "carlos@clima.exemplo" } });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Mercado Fictício", cpfCnpj: "44.555.666/0001-77" } });
    await prisma.ordemServico.create({ data: { id: "os1", empresaId: "e1", numero: "OS-4442", clienteId: "c1", criadoPorId: "uAdmin", responsavelId: "uResp", descricao: "Preventiva", status: "EM_ANDAMENTO" } });
    await prisma.atividadeOs.create({ data: { id: "at1", empresaId: "e1", ordemServicoId: "os1", titulo: "Limpeza dos splits", status: "EM_ANDAMENTO", tecnicoId: "tCarlos" } });
  }, 180_000);
  beforeEach(() => { servico.pedidos = []; servico.resposta = {}; });
  afterAll(async () => {
    vi.unstubAllEnvs();
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    servico.servidor?.close();
    rmSync(servico.dir, { recursive: true, force: true });
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("envio de verdade: assinado com VAPID (a chave pública do servidor), cifrado, o aparelho decifra; o resultado fica no envio", async () => {
    await inscrever("adm-cel", "uAdmin");
    const r = await srv.enviarPush({ empresaId: "e1", tipo: "TESTE", alcance: "pessoal", usuarios: ["uAdmin"], chave: "e2e-1", mensagem: { titulo: "Notificações ligadas", corpo: "Teste ponta a ponta", url: "/", tag: "teste" } });
    expect(r.enviados).toEqual([{ usuarioId: "uAdmin", aparelhos: 1, falhas: 0 }]);
    expect(servico.pedidos).toHaveLength(1);
    const p = servico.pedidos[0];
    const autorizacao = String(p.headers.authorization ?? "");
    expect(autorizacao.startsWith("vapid t=")).toBe(true);
    expect(autorizacao.includes(`k=${vapid.publicKey}`)).toBe(true); // a pública do servidor (comparada, nunca impressa)
    expect([p.headers["content-encoding"], p.headers.ttl, p.headers.urgency]).toEqual(["aes128gcm", "43200", "high"]);
    expect(decifrar(p)).toEqual({ titulo: "Notificações ligadas", corpo: "Teste ponta a ponta", url: "/", tag: "teste" });
    const envio = await prisma.pushEnvio.findFirst({ where: { chave: "e2e-1" } });
    expect([envio.aparelhos, envio.falhas, envio.resultados]).toEqual([1, 0, [{ aparelho: "adm-cel", servico: "127.0.0.1:" + servico.porta, ok: true, status: 201, motivo: "Aceito pelo serviço de push." }]]);
    expect((await prisma.pushSubscription.findUnique({ where: { id: "adm-cel" } })).ultimoStatus).toBe(201);
  });

  it("recusas do serviço: 403 de chave VAPID diferente e 410 apagam; 500 conta falha e guarda o motivo", async () => {
    await inscrever("adm-chave-velha", "uAdmin");
    await inscrever("adm-expirado", "uAdmin");
    await inscrever("adm-instavel", "uAdmin");
    servico.resposta = {
      "/push/adm-chave-velha": { status: 403, corpo: "the VAPID credentials in the authorization header do not correspond to the credentials used to create the subscriptions." },
      "/push/adm-expirado": { status: 410, corpo: "push subscription has unsubscribed or expired." },
      "/push/adm-instavel": { status: 500, corpo: "internal" },
    };
    const r = await srv.enviarPush({ empresaId: "e1", tipo: "TESTE", alcance: "pessoal", usuarios: ["uAdmin"], chave: "e2e-2", mensagem: { titulo: "x", corpo: "", url: "/", tag: "t" } });
    expect(r.enviados).toEqual([{ usuarioId: "uAdmin", aparelhos: 1, falhas: 3 }]);
    const envio = await prisma.pushEnvio.findFirst({ where: { chave: "e2e-2" } });
    expect((envio.resultados as any[]).map((x) => [x.aparelho, x.ok, x.status]).sort()).toEqual([["adm-cel", true, 201], ["adm-chave-velha", false, 403], ["adm-expirado", false, 410], ["adm-instavel", false, 500]]);
    expect(await prisma.pushSubscription.findUnique({ where: { id: "adm-chave-velha" } })).toBeNull();
    expect(await prisma.pushSubscription.findUnique({ where: { id: "adm-expirado" } })).toBeNull();
    const instavel = await prisma.pushSubscription.findUnique({ where: { id: "adm-instavel" } });
    expect([instavel.falhas, instavel.ultimoStatus, instavel.ultimoErro]).toEqual([1, 500, "Erro temporário no serviço de push (500). (internal)"]);
    await prisma.pushSubscription.deleteMany({ where: { id: "adm-instavel" } });
  });

  it("a inscrição confere a chave: a do servidor entra (só a impressão é gravada); com outra, 409 'reinscrever'", async () => {
    const a = aparelho();
    como("uOutro");
    const ok = await rota("api/push/subscribe", "POST", { endpoint: endpoint("outro-pc"), keys: { p256dh: a.p256dh, auth: a.authB64 }, userAgent: "Windows Chrome", chave: vapid.publicKey });
    expect(ok.status).toBe(201);
    const gravada = await prisma.pushSubscription.findFirst({ where: { endpoint: endpoint("outro-pc") } });
    expect(gravada.chaveImpressao).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(gravada)).not.toContain(vapid.publicKey);
    dispositivos["outro-pc"] = a;
    const errada = await rota("api/push/subscribe", "POST", { endpoint: endpoint("outro-velho"), keys: { p256dh: a.p256dh, auth: a.authB64 }, chave: outroPar.publicKey });
    expect([errada.status, errada.json.reinscrever]).toEqual([409, true]);
    expect(await prisma.pushSubscription.findFirst({ where: { endpoint: endpoint("outro-velho") } })).toBeNull();
    // o navegador antigo (sem a chave no corpo, ex.: a troca automática do service worker) continua entrando
    expect((await rota("api/push/subscribe", "POST", { endpoint: endpoint("sem-chave"), keys: { p256dh: a.p256dh, auth: a.authB64 } })).status).toBe(201);
    await prisma.pushSubscription.deleteMany({ where: { endpoint: endpoint("sem-chave") } });
  });

  it("diagnóstico: só ADMIN; confere o par de chaves (sem mostrar nenhuma) e devolve o resultado de cada aparelho", async () => {
    como("uCarlos");
    expect((await rota("api/push/diagnostico", "POST", {})).status).toBe(403);
    como("uResp");
    expect((await rota("api/push/diagnostico", "POST", {})).status).toBe(403);
    como("uAdmin");
    servico.resposta = { "/push/adm-cel": { status: 201 } };
    const d = await rota("api/push/diagnostico", "POST", {});
    expect(d.status).toBe(200);
    expect(d.json.servidor).toMatchObject({ ligado: true, faltando: [], assuntoValido: true, parDeChavesConfere: true });
    expect(d.json.servidor.impressaoDaChavePublica).toMatch(/^[0-9a-f]{12}$/);
    expect(d.json.aparelhos.map((x: any) => [x.id, x.ok, x.status, x.aparelho])).toEqual([["adm-cel", true, 201, "Android · Chrome"]]);
    expect(decifrar(servico.pedidos[0]).titulo).toBe("Teste de diagnóstico");
    // nenhuma chave na resposta
    for (const k of [vapid.publicKey, vapid.privateKey]) expect(d.texto.includes(k)).toBe(false);
    // de outra pessoa da empresa: os aparelhos dela
    const o = await rota("api/push/diagnostico", "POST", { usuarioId: "uOutro" });
    expect(o.json.aparelhos.map((x: any) => [x.id ? "id" : null, x.ok, x.chaveConfere])).toEqual([["id", true, true]]);
    // o par trocado (a privada de outro par): o diagnóstico acusa, sem mostrar nada
    vi.stubEnv("VAPID_PRIVATE_KEY", outroPar.privateKey);
    const trocado = await rota("api/push/diagnostico", "POST", { usuarioId: "uNinguem" });
    expect(trocado.status).toBe(404);
    const t2 = await rota("api/push/diagnostico", "POST", {});
    expect(t2.json.servidor.parDeChavesConfere).toBe(false);
    expect(t2.texto.includes(outroPar.privateKey)).toBe(false);
    vi.stubEnv("VAPID_PRIVATE_KEY", vapid.privateKey);
    // sem as chaves: diz o NOME da variável que falta
    vi.stubEnv("VAPID_SUBJECT", "");
    const sem = await rota("api/push/diagnostico", "POST", {});
    expect([sem.json.servidor.ligado, sem.json.servidor.faltando]).toEqual([false, ["VAPID_SUBJECT"]]);
    vi.stubEnv("VAPID_SUBJECT", "mailto:suporte@ficticio.test");
  });

  it("comentário do técnico: avisa quem está LIGADO à OS no escritório; sem ninguém ligado com aparelho, o escritório", async () => {
    await inscrever("resp-pc", "uResp");
    const pc = async () => { await depoisDaResposta(); return servico.pedidos.map((p) => [p.caminho.replace("/push/", ""), decifrar(p).titulo]).sort(); };
    // o responsável da OS (uResp) e o admin que abriu a OS (criadoPor) estão ligados; o uOutro, não
    await ev.notificarComentarioOS("os1", "uCarlos", { comentarioId: "cm-1", texto: "Falta a peça" });
    expect(await pc()).toEqual([["adm-cel", "Comentário novo na OS OS-4442"], ["resp-pc", "Comentário novo na OS OS-4442"]]);
    // sem ninguém ligado com aparelho: o escritório todo que vê OS (o aviso não se perde)
    servico.pedidos = [];
    await prisma.pushSubscription.deleteMany({ where: { id: { in: ["resp-pc", "adm-cel"] } } });
    await ev.notificarComentarioOS("os1", "uCarlos", { comentarioId: "cm-2", texto: "Outra" });
    expect((await pc()).map((x) => x[0])).toEqual(["outro-pc"]);
  });

  it("o escritório lê TODOS os comentários da OS (inclusive os do app, ligados à atividade), com a marca da atividade e o 'novo'", async () => {
    await prisma.osComentario.createMany({ data: [
      { id: "k1", empresaId: "e1", ordemServicoId: "os1", atividadeId: null, usuarioId: "uResp", autorNome: "Resp", origem: "ESCRITORIO", texto: "Leve a escada", criadoEm: new Date("2026-11-28T02:27:00Z") },
      { id: "k2", empresaId: "e1", ordemServicoId: "os1", atividadeId: "at1", usuarioId: "uCarlos", autorNome: "Carlos", origem: "APP", texto: "Cheguei", clientId: "cli-1", criadoEm: new Date("2026-11-28T02:28:00Z") },
      { id: "k3", empresaId: "e1", ordemServicoId: "os1", atividadeId: "at1", usuarioId: "uCarlos", autorNome: "Carlos", origem: "APP", texto: "Falta a peça", clientId: "cli-2", criadoEm: new Date("2026-11-28T02:30:00Z") },
    ] });
    como("uResp");
    const r = await rota("api/ordens/[id]/comentarios", "GET", undefined, { id: "os1" });
    expect(r.json.comentarios.map((c: any) => [c.texto, c.origem, c.atividade, c.novo])).toEqual([
      ["Leve a escada", "ESCRITORIO", null, false], ["Cheguei", "APP", "Limpeza dos splits", true], ["Falta a peça", "APP", "Limpeza dos splits", true],
    ]);
    // lido: na próxima leitura nada é "novo"
    const de2 = await rota("api/ordens/[id]/comentarios", "GET", undefined, { id: "os1" });
    expect(de2.json.comentarios.every((c: any) => !c.novo)).toBe(true);
  });
});
