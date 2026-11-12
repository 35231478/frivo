/**
 * NFS-e PR3 (B) — aviso automático (webhook) do PlugNotas, reconciliação e sino, pelas rotas REAIS
 * com o Prisma num PostgreSQL real e o PlugNotas simulado no `fetch`:
 *  - gerar/girar a URL (Financeiro › Fiscal): segredo só na resposta, no banco só o hash, cadastro
 *    no PlugNotas (POST; 409 → PUT; recusa = pendente com o motivo, sem segredos); girar mata a antiga;
 *  - o webhook: 401 sem/errado; o corpo NUNCA muda a nota (só manda consultar); só notas da empresa
 *    do segredo; por id, por idIntegracao, pelo cabeçalho; corpo desconhecido confere as que esperam;
 *    PlugNotas fora = 503 (ele reenviar); corpo grande = 413;
 *  - reconciliação: idade/intervalo, cron com CRON_SECRET, sino puxa a da empresa (1×/min);
 *  - sino: autorizadas/não aceitas não vistas e paradas há 30 min, só com Fiscal; abrir as notas com
 *    Fiscal tira do sino (só Medições não tira).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/nfse-webhook-pg
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { montarPermissoes, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_nfse_webhook_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const TOKEN = "tok-sandbox-SEGREDO-123456";
const BASE = "https://api.sandbox.plugnotas.com.br";
const APP = "https://app.frivo.test";
const MIN = 60_000;

const FISCAL = montarPermissoes({ financeiro: ["visualizar", "medicoes", "fiscal"] });
const SO_MEDICOES = montarPermissoes({ financeiro: ["visualizar", "medicoes"] });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes, empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "u1" : "u2", name: "Ana", email: "a@x.com", empresaId, role: "OPERADOR", permissoes } };
};
// after() do Next só existe dentro de uma requisição de verdade: aqui guarda e roda quando o teste mandar
const depois = vi.hoisted(() => ({ fila: [] as (() => unknown)[] }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (fn: () => unknown) => { depois.fila.push(fn); } }));
const rodarDepois = async () => { const f = depois.fila.splice(0); for (const fn of f) await fn(); };

/* ───────── PlugNotas simulado ───────── */
const pn = vi.hoisted(() => ({
  notas: new Map<string, any>(), chamadas: [] as { metodo: string; url: string; chave: string | null; corpo: any }[],
  webhook: "ok" as "ok" | "existe" | "recusa", consulta: "ok" as "ok" | "erro500", seq: 0,
}));
const resposta = (status: number, corpo: unknown, tipo = "application/json") =>
  new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status, headers: { "Content-Type": tipo } });

async function fetchFalso(entrada: string | URL, init?: RequestInit) {
  const url = String(entrada);
  if (url.startsWith("https://viacep.com.br/")) return resposta(200, { ibge: "5220454", localidade: "Senador Canedo", uf: "GO" });
  const chave = new Headers(init?.headers).get("x-api-key");
  const caminho = url.replace(BASE, "");
  const metodo = init?.method ?? "GET";
  pn.chamadas.push({ metodo, url: caminho, chave, corpo: typeof init?.body === "string" ? JSON.parse(init.body) : null });
  if (chave !== TOKEN) return resposta(401, { error: { message: "Unauthorized" } });
  let m: RegExpMatchArray | null;
  if ((m = caminho.match(/^\/empresa\/(\d+)\/webhook$/))) {
    if (pn.webhook === "recusa") return resposta(400, { error: { message: `URL não aceita: ${JSON.parse(String(init!.body)).url}` } });
    if (pn.webhook === "existe" && metodo === "POST") return resposta(409, { error: { message: "Webhook já cadastrado" } });
    return resposta(200, { message: "ok" });
  }
  if (metodo === "POST" && caminho === "/nfse") {
    const corpo = JSON.parse(String(init!.body));
    const docs = corpo.map((n: any) => {
      const id = `pn${(++pn.seq).toString().padStart(4, "0")}`;
      pn.notas.set(id, { id, idIntegracao: n.idIntegracao, situacao: "PROCESSANDO" });
      return { idIntegracao: n.idIntegracao, prestador: n.prestador.cpfCnpj, id };
    });
    return resposta(200, { documents: docs, message: "Nota(as) em processamento", protocol: `prot-${pn.seq}` });
  }
  if ((m = caminho.match(/^\/nfse\/consultar\/([^/]+)$/))) {
    if (pn.consulta === "erro500") return resposta(500, { error: { message: "Erro interno" } });
    const n = pn.notas.get(decodeURIComponent(m[1]));
    return n ? resposta(200, [{ ...n, numeroNfse: n.numeroNfse, emissao: "29/10/2026" }]) : resposta(404, { error: { message: "Nota não encontrada" } });
  }
  return resposta(404, { error: { message: "rota desconhecida" } });
}
const situar = (id: string, s: Record<string, unknown>) => pn.notas.set(id, { ...pn.notas.get(id), ...s });
const consultasPn = () => pn.chamadas.filter((c) => c.url.startsWith("/nfse/consultar/")).map((c) => c.url.replace("/nfse/consultar/", ""));

/* ───────── Rotas ───────── */
async function chamar(mod: string, metodo: "GET" | "POST", url: string, o: { corpo?: unknown; bruto?: string; headers?: Record<string, string>; params?: Record<string, string> } = {}) {
  const { NextRequest } = await import("next/server");
  const m = await import(/* @vite-ignore */ `@/app/api/${mod}/route`);
  const body = o.bruto ?? (o.corpo === undefined ? undefined : JSON.stringify(o.corpo));
  const req = new NextRequest(`${APP}${url}`, { method: metodo, headers: { "Content-Type": "application/json", ...o.headers }, body });
  const res: Response = await m[metodo](req, { params: Promise.resolve(o.params ?? {}) });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
const gerarUrl = () => chamar("fiscal/webhook", "POST", "/api/fiscal/webhook");
const segredoDe = (url: string) => new URL(url).searchParams.get("token")!;
const aviso = (segredo: string | null, corpo: unknown, headers: Record<string, string> = {}) =>
  chamar("webhooks/plugnotas", "POST", `/api/webhooks/plugnotas${segredo ? `?token=${segredo}` : ""}`, { corpo, headers });
const emitir = () => chamar("fiscal/notas", "POST", "/api/fiscal/notas", { corpo: { medicaoId: "m1", origem: "MEDICAO" } });
const listar = () => chamar("fiscal/notas", "GET", "/api/fiscal/notas?medicaoId=m1");
const sino = () => chamar("alertas", "GET", "/api/alertas");
const cron = (auth?: string) => chamar("fiscal/reconciliar", "GET", "/api/fiscal/reconciliar", { headers: auth ? { Authorization: auth } : {} });

describe.skipIf(!URL_PG)("NFS-e: aviso automático do PlugNotas, reconciliação e sino (PostgreSQL real)", () => {
  let prisma: any;
  let ws: typeof import("@/lib/nfse/webhook-server");
  const nota = (id: string) => prisma.notaFiscal.findUnique({ where: { id }, include: { eventos: { orderBy: { criadoEm: "asc" } } } });
  const fiscalDe = (empresaId: string) => prisma.empresaFiscal.findUnique({ where: { empresaId } });
  /** Emite pela rota real: 1 nota PROCESSANDO no PlugNotas (pn0001) */
  async function notaProcessando() {
    const r = await emitir();
    expect(r.status).toBe(201);
    const [n] = await prisma.notaFiscal.findMany();
    expect(n.status).toBe("PROCESSANDO");
    return n;
  }
  /** Envelhece a nota (como se tivesse sido criada há `min` minutos) */
  const envelhecer = (id: string, min: number, consultaMin: number | null = null) => prisma.notaFiscal.update({
    where: { id }, data: { criadoEm: new Date(Date.now() - min * MIN), ultimaConsultaEm: consultaMin == null ? null : new Date(Date.now() - consultaMin * MIN) },
  });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ws = await import("@/lib/nfse/webhook-server");
    await Promise.all(["fiscal/webhook", "webhooks/plugnotas", "fiscal/notas", "alertas", "fiscal/reconciliar", "fiscal/emitente"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn(fetchFalso));
    vi.stubEnv("PLUGNOTAS_API_TOKEN", TOKEN);
    vi.stubEnv("PLUGNOTAS_API_URL", "");
    vi.stubEnv("NEXTAUTH_URL", APP);
    vi.stubEnv("CRON_SECRET", "cron-secreto");
    pn.notas.clear(); pn.chamadas = []; pn.webhook = "ok"; pn.consulta = "ok"; pn.seq = 0;
    depois.fila = [];
    ws.esquecerRodadas();
    for (const t of ["notaFiscalEvento", "notaFiscalItem", "notaFiscal", "osHistorico", "medicaoNf", "contaReceber", "medicaoItem", "medicao", "servico", "cliente", "configuracao", "empresaFiscal", "usuario", "empresa"]) {
      await prisma[t].deleteMany({});
    }
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com", cnaePrincipal: "4322302" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" },
      { id: "u2", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
    ] });
    await prisma.configuracao.create({ data: { empresaId: "e1", issAliquota: 3.5 } });
    const fiscal = { regimeTributario: "SIMPLES_NACIONAL", ambiente: "HOMOLOGACAO", status: "ATIVO", emitenteAmbiente: "HOMOLOGACAO", codigoMunicipio: "5220454", municipioNome: "Senador Canedo", municipioUf: "GO" };
    await prisma.empresaFiscal.createMany({ data: [
      { empresaId: "e1", emitenteCnpj: "12345678000190", ...fiscal },
      { empresaId: "e2", emitenteCnpj: "98765432000110", ...fiscal },
    ] });
    await prisma.cliente.create({ data: {
      id: "c1", empresaId: "e1", nome: "Condomínio Jardim", cpfCnpj: "11.222.333/0001-81", email: "fin@jardim.com",
      endereco: "Av. Goiás", numero: "100", bairro: "Centro", cidade: "Senador Canedo", estado: "GO", cep: "75250-000",
    } });
    await prisma.servico.create({ data: { id: "sHig", empresaId: "e1", nome: "Higienização", codigoLc116: "14.01", codigoMunicipal: "140101", aliquotaISS: 5 } });
    await prisma.medicao.create({ data: {
      id: "m1", empresaId: "e1", clienteId: "c1", numero: "MED-2026-0012", tipo: "ADICIONAL", status: "PC_RECEBIDO",
      valorTotal: 300, descontoValor: 0, valorLiquido: 300, tokenPublico: "tok-m1",
      itens: { create: [{ id: "i1", tipo: "SERVICO", servicoId: "sHig", descricao: "Higienização split 12k", quantidade: 2, valorUnitario: 150, valorTotal: 300, ordem: 0 }] },
    } });
    await prisma.contaReceber.create({ data: { id: "cr1", empresaId: "e1", clienteId: "c1", medicaoId: "m1", numero: "CR-0001", descricao: "Medição", valor: 300, status: "PREVISTO" } });
    logar(FISCAL);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  describe("gerar a URL do aviso (Dados fiscais)", () => {
    it("só com Financeiro › Fiscal; sem o emitente cadastrado no PlugNotas = 409", async () => {
      logar(SO_MEDICOES);
      expect((await gerarUrl()).status).toBe(403);
      logar(FISCAL);
      await prisma.empresaFiscal.update({ where: { empresaId: "e1" }, data: { emitenteCnpj: null } });
      const r = await gerarUrl();
      expect([r.status, r.json.erro]).toEqual([409, "Cadastre a empresa no PlugNotas (salve os Dados fiscais) antes de ligar o aviso automático."]);
      expect(pn.chamadas).toEqual([]);
      expect((await fiscalDe("e1")).webhookTokenHash).toBeNull();
      expect((await chamar("fiscal/emitente", "GET", "/api/fiscal/emitente")).json.webhook).toMatchObject({ ativo: false, podeGerar: false });
    });

    it("gera: a URL (com o segredo) volta UMA vez; no banco só o hash; cadastrada no PlugNotas do ambiente do emitente", async () => {
      const r = await gerarUrl();
      expect(r.status).toBe(200);
      expect(r.json.url).toMatch(new RegExp(`^${APP}/api/webhooks/plugnotas\\?token=[a-f0-9]{64}$`));
      const segredo = segredoDe(r.json.url);
      expect([r.json.registrado, r.json.erro]).toEqual([true, null]);
      expect(r.json.webhook).toMatchObject({ ativo: true, podeGerar: true, ambiente: "HOMOLOGACAO", erro: null, recebidoEm: null, desatualizado: false });
      expect(r.json.webhook.registradoEm).toBeTruthy();
      const f = await fiscalDe("e1");
      expect(f.webhookTokenHash).toBe(createHash("sha256").update(segredo).digest("hex"));
      expect(JSON.stringify(f)).not.toContain(segredo);
      expect([f.webhookAmbiente, f.atualizadoPorId, !!f.webhookGeradoEm, !!f.webhookRegistradoEm]).toEqual(["HOMOLOGACAO", "u1", true, true]);
      expect(pn.chamadas).toEqual([{ metodo: "POST", url: "/empresa/12345678000190/webhook", chave: TOKEN, corpo: { url: r.json.url, method: "POST", headers: { Authorization: `Bearer ${segredo}` } } }]);
      // a tela de Dados fiscais nunca mais mostra o segredo nem o hash
      const tela = await chamar("fiscal/emitente", "GET", "/api/fiscal/emitente");
      expect(tela.json.webhook).toMatchObject({ ativo: true, ambiente: "HOMOLOGACAO" });
      expect(JSON.stringify(tela.json)).not.toContain(segredo);
      expect(JSON.stringify(tela.json)).not.toContain(f.webhookTokenHash);
      expect(JSON.stringify(tela.json)).not.toContain(TOKEN);
    });

    it("já cadastrado lá (409): atualiza com PUT", async () => {
      pn.webhook = "existe";
      const r = await gerarUrl();
      expect(r.json.registrado).toBe(true);
      expect(pn.chamadas.map((c) => c.metodo)).toEqual(["POST", "PUT"]);
    });

    it("PlugNotas recusa o cadastro: a URL vale do nosso lado e fica PENDENTE com o motivo (sem o segredo)", async () => {
      pn.webhook = "recusa";
      const r = await gerarUrl();
      expect([r.status, r.json.registrado]).toEqual([200, false]);
      const segredo = segredoDe(r.json.url);
      expect(r.json.erro).toBe("URL não aceita: •••");
      expect(r.json.webhook).toMatchObject({ ativo: true, registradoEm: null, erro: "URL não aceita: •••" });
      const f = await fiscalDe("e1");
      expect([f.webhookErro, f.webhookRegistradoEm]).toEqual(["URL não aceita: •••", null]);
      expect(JSON.stringify(f)).not.toContain(segredo);
      // mesmo pendente lá, a URL já autentica (dá para colar no painel do PlugNotas)
      expect((await aviso(segredo, {})).status).toBe(200);
    });

    it("girar: a URL antiga para de valer na hora; a nova vale", async () => {
      const antiga = segredoDe((await gerarUrl()).json.url);
      const nova = segredoDe((await gerarUrl()).json.url);
      expect(nova).not.toBe(antiga);
      expect((await aviso(antiga, {})).status).toBe(401);
      expect((await aviso(nova, {})).status).toBe(200);
    });

    it("gerar de novo zera o resultado do cadastro anterior: o 'cadastrado em' não fica de uma URL morta, nem o erro antigo", async () => {
      expect((await gerarUrl()).json.registrado).toBe(true);
      pn.webhook = "recusa";
      const r = await gerarUrl();
      expect(r.json.webhook).toMatchObject({ registradoEm: null, erro: "URL não aceita: •••" });
      expect((await fiscalDe("e1")).webhookRegistradoEm).toBeNull();
      pn.webhook = "ok";
      const r2 = await gerarUrl();
      expect(r2.json.webhook.erro).toBeNull();
      expect((await fiscalDe("e1")).webhookErro).toBeNull();
    });

    it("emitente em PRODUÇÃO (token próprio): a URL é cadastrada no PlugNotas de produção e guarda o ambiente", async () => {
      vi.stubEnv("PLUGNOTAS_API_TOKEN_PRODUCAO", TOKEN);
      vi.stubEnv("PLUGNOTAS_API_URL_PRODUCAO", BASE);
      await prisma.empresaFiscal.update({ where: { empresaId: "e1" }, data: { ambiente: "PRODUCAO", emitenteAmbiente: "PRODUCAO" } });
      const r = await gerarUrl();
      expect(r.json.webhook).toMatchObject({ ambiente: "PRODUCAO", desatualizado: false });
      expect((await fiscalDe("e1")).webhookAmbiente).toBe("PRODUCAO");
    });

    it("o emitente mudou de ambiente depois: a tela pede para gerar de novo", async () => {
      await gerarUrl();
      await prisma.empresaFiscal.update({ where: { empresaId: "e1" }, data: { emitenteAmbiente: "PRODUCAO" } });
      expect((await chamar("fiscal/emitente", "GET", "/api/fiscal/emitente")).json.webhook.desatualizado).toBe(true);
    });
  });

  describe("o aviso (webhook)", () => {
    it("sem segredo, fora do formato ou desconhecido: 401 e nada acontece", async () => {
      const n = await notaProcessando();
      pn.chamadas = [];
      expect((await aviso(null, { id: "pn0001" })).status).toBe(401);
      expect((await aviso("curto", { id: "pn0001" })).status).toBe(401);
      expect((await aviso("c".repeat(64), { id: "pn0001" })).status).toBe(401);
      expect(pn.chamadas).toEqual([]);
      expect((await nota(n.id)).eventos.map((e: any) => e.tipo)).toEqual(["ENVIO"]);
      expect((await fiscalDe("e1")).webhookRecebidoEm).toBeNull();
    });

    it("o corpo NUNCA muda a nota: diz 'autorizada' mas o PlugNotas ainda processa → continua PROCESSANDO", async () => {
      const segredo = segredoDe((await gerarUrl()).json.url);
      const n = await notaProcessando();
      pn.chamadas = [];
      const r = await aviso(segredo, { id: "pn0001", idIntegracao: n.id, situacao: "CONCLUIDO", numeroNfse: "999" });
      expect([r.status, r.json]).toEqual([200, { ok: true, consultadas: 1 }]);
      expect(consultasPn()).toEqual(["pn0001"]);
      const depois = await nota(n.id);
      expect([depois.status, depois.numero]).toEqual(["PROCESSANDO", null]);
      expect(depois.eventos.at(-1)).toMatchObject({ tipo: "CONSULTA", usuarioId: null, mensagem: "Aviso automático do PlugNotas recebido: consultando a situação." });
      expect((await fiscalDe("e1")).webhookRecebidoEm).toBeTruthy();
    });

    it("autorizada lá: o aviso consulta na hora (mesmo logo depois da tela) e aplica tudo — nº, NF na medição, conta liberada", async () => {
      const segredo = segredoDe((await gerarUrl()).json.url);
      const n = await notaProcessando();
      await prisma.notaFiscal.update({ where: { id: n.id }, data: { ultimaConsultaEm: new Date(Date.now() - 2_000) } }); // a tela acabou de consultar
      situar("pn0001", { situacao: "CONCLUIDO", numeroNfse: "4321", codigoVerificacao: "AB-12" });
      expect((await aviso(segredo, { id: "pn0001" })).json.consultadas).toBe(1);
      const d = await nota(n.id);
      expect([d.status, d.numero, d.codigoVerificacao, d.avisoVistoEm]).toEqual(["CONCLUIDO", "4321", "AB-12", null]);
      expect(d.eventos.map((e: any) => [e.tipo, e.status, e.usuarioId])).toEqual([["ENVIO", "PROCESSANDO", "u1"], ["CONSULTA", "PROCESSANDO", null], ["STATUS", "CONCLUIDO", null]]);
      const med = await prisma.medicao.findUnique({ where: { id: "m1" }, include: { nfs: true } });
      expect([med.status, med.nfNumero, med.nfs.map((x: any) => x.numero)]).toEqual(["NF_EMITIDA", "4321", ["4321"]]);
      expect((await prisma.contaReceber.findUnique({ where: { id: "cr1" } })).status).toBe("A_RECEBER");
      // novo aviso da mesma nota (o PlugNotas repete): já tem resultado, nada a consultar
      pn.chamadas = [];
      expect((await aviso(segredo, { id: "pn0001" })).json).toEqual({ ok: true, consultadas: 0 });
      expect(pn.chamadas).toEqual([]);
    });

    it("pelo nosso idIntegracao e com o segredo no cabeçalho Authorization", async () => {
      const segredo = segredoDe((await gerarUrl()).json.url);
      const n = await notaProcessando();
      situar("pn0001", { situacao: "REJEITADO", mensagem: "Código de serviço inválido" });
      const r = await aviso(null, [{ idIntegracao: n.id }], { Authorization: `Bearer ${segredo}` });
      expect(r.json).toEqual({ ok: true, consultadas: 1 });
      expect(await nota(n.id)).toMatchObject({ status: "REJEITADO", motivo: "Código de serviço inválido" });
    });

    it("o segredo de OUTRA empresa não alcança as notas desta (nem pelo id, nem pelo idIntegracao)", async () => {
      const n = await notaProcessando();
      logar(FISCAL, "e2");
      const daOutra = segredoDe((await gerarUrl()).json.url);
      situar("pn0001", { situacao: "CONCLUIDO", numeroNfse: "1" });
      pn.chamadas = [];
      expect((await aviso(daOutra, { id: "pn0001", idIntegracao: n.id })).json).toEqual({ ok: true, consultadas: 0 });
      // corpo sem referência: confere só as notas que esperam DA EMPRESA do segredo (a outra não tem nenhuma)
      expect((await aviso(daOutra, { evento: "nfse" })).json).toEqual({ ok: true, consultadas: 0 });
      expect(consultasPn()).toEqual([]);
      expect((await nota(n.id)).status).toBe("PROCESSANDO");
      expect((await nota(n.id)).eventos.map((e: any) => e.tipo)).toEqual(["ENVIO"]); // nem o histórico desta é tocado
      expect((await fiscalDe("e1")).webhookRecebidoEm).toBeNull();
    });

    it("corpo sem referência reconhecível (formato novo do PlugNotas): confere as notas da empresa que esperam resposta", async () => {
      const segredo = segredoDe((await gerarUrl()).json.url);
      const n = await notaProcessando();
      situar("pn0001", { situacao: "CONCLUIDO", numeroNfse: "77" });
      expect((await aviso(segredo, { evento: "nfse.atualizada" })).json).toEqual({ ok: true, consultadas: 1 });
      expect((await nota(n.id)).status).toBe("CONCLUIDO");
      // corpo que nem é JSON: idem (não quebra)
      expect((await chamar("webhooks/plugnotas", "POST", `/api/webhooks/plugnotas?token=${segredo}`, { bruto: "isto não é json" })).status).toBe(200);
    });

    it("referência desconhecida: 200 sem consultar nada (não revela o que existe)", async () => {
      const segredo = segredoDe((await gerarUrl()).json.url);
      await notaProcessando();
      pn.chamadas = [];
      expect((await aviso(segredo, { id: "pn9999" })).json).toEqual({ ok: true, consultadas: 0 });
      expect(pn.chamadas).toEqual([]);
    });

    it("o PlugNotas não responde a consulta: 503 (ele manda o aviso de novo) e a nota segue esperando", async () => {
      const segredo = segredoDe((await gerarUrl()).json.url);
      const n = await notaProcessando();
      pn.consulta = "erro500";
      const r = await aviso(segredo, { id: "pn0001" });
      expect([r.status, r.json]).toEqual([503, { ok: false, consultadas: 0 }]);
      expect((await nota(n.id)).status).toBe("PROCESSANDO");
    });

    it("corpo grande demais: 413 sem consultar; GET (validação da URL) = 200", async () => {
      const segredo = segredoDe((await gerarUrl()).json.url);
      await notaProcessando();
      pn.chamadas = [];
      const r = await chamar("webhooks/plugnotas", "POST", `/api/webhooks/plugnotas?token=${segredo}`, { bruto: JSON.stringify({ id: "pn0001", x: "a".repeat(256 * 1024) }) });
      expect(r.status).toBe(413);
      expect(pn.chamadas).toEqual([]);
      expect((await chamar("webhooks/plugnotas", "GET", "/api/webhooks/plugnotas")).status).toBe(200);
    });
  });

  describe("reconciliação das notas paradas", () => {
    it("consulta só as que esperam há mais de 2 min e cuja última consulta é antiga para a idade delas", async () => {
      const n = await notaProcessando();
      situar("pn0001", { situacao: "CONCLUIDO", numeroNfse: "88" });
      pn.chamadas = [];
      await envelhecer(n.id, 1);
      expect(await ws.reconciliarNotas()).toEqual({ consultadas: 0, falhas: 0 });
      await envelhecer(n.id, 60, 5); // 1 h de idade: de 10 em 10 min
      expect(await ws.reconciliarNotas()).toEqual({ consultadas: 0, falhas: 0 });
      expect(pn.chamadas).toEqual([]);
      await envelhecer(n.id, 60, 11);
      expect(await ws.reconciliarNotas()).toEqual({ consultadas: 1, falhas: 0 });
      expect(await nota(n.id)).toMatchObject({ status: "CONCLUIDO", numero: "88" });
    });

    it("erro numa nota não para o lote; o filtro por empresa não toca nas outras", async () => {
      const n = await notaProcessando();
      await envelhecer(n.id, 10);
      pn.consulta = "erro500";
      expect(await ws.reconciliarNotas({ empresaId: "e2" })).toEqual({ consultadas: 0, falhas: 0 });
      expect(await ws.reconciliarNotas({ empresaId: "e1" })).toEqual({ consultadas: 0, falhas: 1 });
    });

    it("cron: só com Authorization: Bearer CRON_SECRET (sem segredo configurado, desligado)", async () => {
      const n = await notaProcessando();
      await envelhecer(n.id, 10);
      situar("pn0001", { situacao: "CONCLUIDO", numeroNfse: "5" });
      expect((await cron()).status).toBe(401);
      expect((await cron("Bearer errado")).status).toBe(401);
      vi.stubEnv("CRON_SECRET", "");
      expect((await cron("Bearer ")).status).toBe(401);
      vi.stubEnv("CRON_SECRET", undefined);
      expect((await cron("Bearer undefined")).status).toBe(401);
      vi.stubEnv("CRON_SECRET", "cron-secreto");
      expect((await nota(n.id)).status).toBe("PROCESSANDO");
      const r = await cron("Bearer cron-secreto");
      expect([r.status, r.json]).toEqual([200, { ok: true, consultadas: 1, falhas: 0 }]);
      expect((await nota(n.id)).status).toBe("CONCLUIDO");
    });

    it("o sino puxa a reconciliação da empresa depois de responder, no máximo 1 rodada por minuto", async () => {
      const n = await notaProcessando();
      await envelhecer(n.id, 10);
      situar("pn0001", { situacao: "CONCLUIDO", numeroNfse: "6" });
      expect((await sino()).status).toBe(200);
      expect((await nota(n.id)).status).toBe("PROCESSANDO"); // ainda não: roda depois da resposta
      expect(depois.fila).toHaveLength(1);
      await rodarDepois();
      expect((await nota(n.id)).status).toBe("CONCLUIDO");
      // segunda abertura do sino no mesmo minuto: não reconcilia de novo
      await prisma.notaFiscal.update({ where: { id: n.id }, data: { status: "PROCESSANDO", criadoEm: new Date(Date.now() - 10 * MIN), ultimaConsultaEm: null } });
      pn.chamadas = [];
      await sino(); await rodarDepois();
      expect(consultasPn()).toEqual([]);
    });
  });

  describe("sino", () => {
    it("com Fiscal: autorizadas e não aceitas que ninguém viu, e paradas há 30 min — com o link da medição", async () => {
      const n = await notaProcessando();
      expect(await sino()).toMatchObject({ json: { nfseAutorizadas: 0, nfseRejeitadas: 0, nfseAguardando: 0, nfseAguardandoMedicaoId: null } });
      await envelhecer(n.id, 31, 0);
      const r = await sino();
      expect(r.json).toMatchObject({ nfseAguardando: 1, nfseAguardandoMedicaoId: "m1" });
      expect(r.json.total).toBeGreaterThanOrEqual(1);
      await prisma.notaFiscal.update({ where: { id: n.id }, data: { status: "CONCLUIDO" } });
      expect((await sino()).json).toMatchObject({ nfseAutorizadas: 1, nfseAutorizadaMedicaoId: "m1", nfseAguardando: 0, nfseRejeitadas: 0 });
      await listar(); // quem cuida do fiscal abriu: a autorizada sai do sino
      expect((await sino()).json).toMatchObject({ nfseAutorizadas: 0, nfseAutorizadaMedicaoId: null });
      await prisma.notaFiscal.update({ where: { id: n.id }, data: { avisoVistoEm: null } });
      await prisma.notaFiscal.update({ where: { id: n.id }, data: { status: "INTERROMPIDO" } });
      expect((await sino()).json).toMatchObject({ nfseAutorizadas: 0, nfseRejeitadas: 1, nfseRejeitadaMedicaoId: "m1" });
    });

    it("sem Fiscal: o sino não mostra NFS-e", async () => {
      const n = await notaProcessando();
      await prisma.notaFiscal.update({ where: { id: n.id }, data: { status: "REJEITADO" } });
      logar(SO_MEDICOES);
      expect((await sino()).json).toMatchObject({ nfseAutorizadas: 0, nfseRejeitadas: 0, nfseAguardando: 0, nfseRejeitadaMedicaoId: null });
    });

    it("abrir as notas com Fiscal tira o resultado do sino; só com Medições, não; nota ainda esperando não é marcada", async () => {
      const n = await notaProcessando();
      await listar();
      expect((await nota(n.id)).avisoVistoEm).toBeNull(); // esperando: nada a marcar
      await prisma.notaFiscal.update({ where: { id: n.id }, data: { status: "REJEITADO" } });
      logar(SO_MEDICOES);
      await listar();
      expect((await nota(n.id)).avisoVistoEm).toBeNull();
      logar(FISCAL);
      expect((await sino()).json.nfseRejeitadas).toBe(1);
      await listar();
      expect((await nota(n.id)).avisoVistoEm).toBeTruthy();
      expect((await sino()).json.nfseRejeitadas).toBe(0);
    });

    it("marcar vistos fica na empresa: o id de outra empresa não é marcado", async () => {
      const n = await notaProcessando();
      await prisma.notaFiscal.update({ where: { id: n.id }, data: { status: "CONCLUIDO" } });
      expect(await ws.marcarAvisosVistos("e2", [n.id])).toBe(0);
      expect(await ws.marcarAvisosVistos("e1", [])).toBe(0);
      expect(await ws.marcarAvisosVistos("e1", [n.id])).toBe(1);
      expect(await ws.marcarAvisosVistos("e1", [n.id])).toBe(0);
    });
  });
});
