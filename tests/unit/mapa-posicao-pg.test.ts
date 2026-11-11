/**
 * Mapa dos técnicos (Operações › Mapa) — rotas reais com o Prisma real num PostgreSQL real (schema
 * descartável via `prisma db push`):
 *  - CONSENTIMENTO: com "Rastrear localização dos técnicos" desligado (o padrão) nada é gravado, mesmo
 *    que o app envie, e o mapa não devolve posição nenhuma — nem as que já estavam guardadas;
 *  - ligado: fica a ÚLTIMA posição por técnico (uma linha); leitura antiga que chega depois não
 *    sobrescreve a nova; relógio errado do aparelho não engana; bateria ausente fica vazia;
 *  - cada um só envia a PRÓPRIA posição; quem não é técnico não entra no mapa;
 *  - só a gestão (Equipes › Gerenciar) lê o mapa: técnico e quem só visualiza equipes, não;
 *  - a OS em que o técnico está; a lista "sem localização"; multiempresa;
 *  - pronto para o nativo: lote com origem NATIVO alimenta a mesma tabela e o mesmo mapa.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/mapa-posicao-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_mapa_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const MIN = 60_000;

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const comoEscritorio = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: "uA", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
const comoTecnico = (tecnicoId: string | null = "t1", id = "uT", email = "joao@x.com") => {
  sessao.atual = { user: { id, name: "João", email, empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId } };
};

async function chamar(rota: string, metodo: string, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve({}) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null };
}
/** Uma leitura do aparelho; `em` = relógio do aparelho na hora da leitura */
const leitura = (extra: Record<string, unknown> = {}, em: number = Date.now()) => ({ lat: -23.5505, lng: -46.6333, precisao: 12, bateria: 82, carregando: false, em: new Date(em).toISOString(), motivo: "ABRIU_APP", ...extra });
/** Um envio do app: `agora` = relógio do aparelho na hora do envio */
const enviar = (posicoes: unknown[], extra: Record<string, unknown> = {}, agora: number = Date.now()) => chamar("tecnico/posicao", "POST", { posicoes, agora: new Date(agora).toISOString(), ...extra });
const mapa = async () => (await chamar("mapa/posicoes", "GET")).json;

describe.skipIf(!URL_PG)("Mapa: última posição dos técnicos (PostgreSQL real)", () => {
  let prisma: any;
  const linhas = (tecnicoId?: string) => prisma.tecnicoPosicao.findMany({ where: tecnicoId ? { tecnicoId } : {}, orderBy: { tecnicoId: "asc" } });
  const rastrear = (ligado: boolean, empresaId = "e1") => prisma.configuracao.upsert({ where: { empresaId }, create: { empresaId, appRastrearLocalizacao: ligado }, update: { appRastrearLocalizacao: ligado } });
  const noMapa = async (id: string) => { comoEscritorio(); return (await mapa()).tecnicos.find((t: any) => t.id === id); };

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["tecnico/posicao", "mapa/posicoes", "configuracoes"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uT", empresaId: "e1", nome: "João Silva", email: "joao@x.com", senha: "x", role: "TECNICO" },
      { id: "uT2", empresaId: "e1", nome: "Bia Reis", email: "bia@x.com", senha: "x", role: "TECNICO" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@x.com" },
      { id: "t2", empresaId: "e1", nome: "Bia Reis", cpf: "2", telefone: "2", email: "bia@x.com" },
      { id: "t3", empresaId: "e1", nome: "Caio Lima", cpf: "3", telefone: "3", email: "caio@x.com" },                       // nunca enviou posição
      { id: "tAdm", empresaId: "e1", nome: "Dora do escritório", cpf: "4", telefone: "4", tipoEquipe: "ADMINISTRATIVO" },   // não é de campo
      { id: "tFora", empresaId: "e1", nome: "Edu inativo", cpf: "5", telefone: "5", ativo: false },
      { id: "tE2", empresaId: "e2", nome: "Zeca de outra empresa", cpf: "6", telefone: "6", email: "zeca@x.com" },
    ] });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia Ltda", nomeFantasia: "Hospital Santa Luzia", cpfCnpj: "1" } });
    await prisma.ordemServico.createMany({ data: [
      { id: "os1", empresaId: "e1", numero: "OS-0101", clienteId: "c1", criadoPorId: "uA", descricao: "Preventiva" },
      { id: "os2", empresaId: "e1", numero: "OS-0102", clienteId: "c1", criadoPorId: "uA", descricao: "Corretiva" },
    ] });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  beforeEach(async () => {
    await prisma.tecnicoPosicao.deleteMany({});
    await prisma.atividadeOs.deleteMany({});
    await prisma.configuracao.deleteMany({});
    comoTecnico();
  });

  /* ───────── consentimento ───────── */
  it("DESLIGADO é o padrão (empresa sem configuração): o app envia e NADA é gravado; o mapa vem vazio", async () => {
    const r = await enviar([leitura()]);
    expect(r).toMatchObject({ status: 200, json: { rastreio: false, gravada: false } });
    expect(await linhas()).toEqual([]);
    comoEscritorio();
    expect(await mapa()).toMatchObject({ rastreio: false, tecnicos: [] });
  });

  it("a empresa DESLIGA depois de ter usado: nada novo entra e o que estava guardado não sai do servidor", async () => {
    await rastrear(true);
    expect((await enviar([leitura()])).json).toEqual({ rastreio: true, gravada: true });
    await rastrear(false);
    expect((await enviar([leitura({ lat: -22.9 })])).json).toEqual({ rastreio: false, gravada: false });
    expect((await linhas("t1"))[0].latitude).toBe(-23.5505); // a leitura nova não entrou
    comoEscritorio();
    const m = await mapa();
    expect(m).toMatchObject({ rastreio: false, tecnicos: [] });
    expect(JSON.stringify(m)).not.toMatch(/-23\.55|João/);
  });

  it("a permissão é salva pela tela de configurações (PUT /api/configuracoes) e nasce DESLIGADA", async () => {
    comoEscritorio();
    expect((await chamar("configuracoes", "GET")).json.appRastrearLocalizacao).toBe(false);
    expect((await chamar("configuracoes", "PUT", { appRastrearLocalizacao: true })).status).toBe(200);
    expect((await prisma.configuracao.findUnique({ where: { empresaId: "e1" } })).appRastrearLocalizacao).toBe(true);
    expect((await mapa()).rastreio).toBe(true);
    // "Exigir localização" é outra chave: ligá-la não liga o rastreamento
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { appRastrearLocalizacao: false, appExigirLocalizacao: true } });
    expect((await mapa()).rastreio).toBe(false);
  });

  /* ───────── a última posição ───────── */
  it("LIGADO: grava a posição do técnico logado, com precisão, bateria, horário da leitura e o que a disparou", async () => {
    await rastrear(true);
    const lida = Date.now() - 2 * MIN;
    expect((await enviar([leitura({ motivo: "CHEGUEI", carregando: true }, lida)])).json).toEqual({ rastreio: true, gravada: true });
    const [l] = await linhas();
    expect(l).toMatchObject({ empresaId: "e1", tecnicoId: "t1", latitude: -23.5505, longitude: -46.6333, precisaoM: 12, bateria: 82, carregando: true, motivo: "CHEGUEI", origem: "PWA", usuarioId: "uT" });
    expect(Math.abs(l.registradoEm.getTime() - lida)).toBeLessThan(2000); // o horário é o da leitura, não o do envio
    const t = await noMapa("t1");
    expect(t).toMatchObject({ nome: "João Silva", os: null, posicao: { lat: -23.5505, lng: -46.6333, precisaoM: 12, bateria: 82, carregando: true, motivo: "CHEGUEI", origem: "PWA" } });
    expect(t.posicao.registradoEm).toBe(l.registradoEm.toISOString());
  });

  it("bateria e precisão que o aparelho não informa (iPhone) ficam VAZIAS — nunca um número inventado", async () => {
    await rastrear(true);
    const { bateria: _b, carregando: _c, precisao: _p, ...semExtras } = leitura();
    await enviar([semExtras]);
    expect((await linhas())[0]).toMatchObject({ bateria: null, carregando: null, precisaoM: null });
    expect((await noMapa("t1")).posicao).toMatchObject({ bateria: null, carregando: null, precisaoM: null });
    await enviar([leitura({ bateria: null, carregando: null, precisao: null }, Date.now() + 1000)]);
    expect((await linhas())[0].bateria).toBeNull();
  });

  it("UMA linha por técnico: a leitura mais nova substitui; a mais antiga que chega depois (fila de quem estava sem sinal) não sobrescreve", async () => {
    await rastrear(true);
    const agora = Date.now();
    await enviar([leitura({ lat: -23.1 }, agora - 10 * MIN)]);
    expect((await enviar([leitura({ lat: -23.2 }, agora - 5 * MIN)])).json.gravada).toBe(true);
    expect((await enviar([leitura({ lat: -23.9 }, agora - 30 * MIN)])).json).toEqual({ rastreio: true, gravada: false }); // velha: fica a de 5 min atrás
    const todas = await linhas("t1");
    expect(todas).toHaveLength(1);
    expect(todas[0].latitude).toBe(-23.2);
  });

  it("lote com várias leituras, fora de ordem: fica a mais nova", async () => {
    await rastrear(true);
    const agora = Date.now();
    await enviar([leitura({ lat: -23.3, motivo: "PERIODICO" }, agora - 8 * MIN), leitura({ lat: -23.7, motivo: "CONCLUSAO" }, agora - MIN), leitura({ lat: -23.5, motivo: "INICIO" }, agora - 4 * MIN)]);
    expect((await linhas())[0]).toMatchObject({ latitude: -23.7, motivo: "CONCLUSAO" });
  });

  it("relógio do aparelho 3 h ADIANTADO: o atraso é medido pelo próprio aparelho — a posição não vai para o futuro", async () => {
    await rastrear(true);
    const adiantado = Date.now() + 180 * MIN;
    await enviar([leitura({}, adiantado - 4 * MIN)], {}, adiantado); // lida 4 min antes do envio, no relógio errado
    const [l] = await linhas();
    expect(Math.abs(l.registradoEm.getTime() - (Date.now() - 4 * MIN))).toBeLessThan(3000);
    // app antigo, sem o relógio do envio: leitura "no futuro" conta como agora
    await prisma.tecnicoPosicao.deleteMany({});
    await chamar("tecnico/posicao", "POST", { posicoes: [leitura({}, adiantado)] });
    expect((await linhas())[0].registradoEm.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  /* ───────── quem envia ───────── */
  it("cada um só envia a PRÓPRIA posição: o corpo não escolhe o técnico", async () => {
    await rastrear(true);
    comoTecnico("t2", "uT2", "bia@x.com");
    expect((await chamar("tecnico/posicao", "POST", { posicoes: [leitura()], tecnicoId: "t1" })).status).toBe(400); // campo estranho: recusado
    await enviar([leitura({ lat: -22.9 })]);
    expect((await linhas()).map((l: any) => [l.tecnicoId, l.latitude, l.usuarioId])).toEqual([["t2", -22.9, "uT2"]]);
  });

  it("usuário sem técnico ligado (escritório abrindo o app) não entra no mapa; sem sessão, 401", async () => {
    await rastrear(true);
    comoEscritorio();
    expect((await enviar([leitura()])).json).toEqual({ rastreio: false, gravada: false });
    expect(await linhas()).toEqual([]);
    sessao.atual = null;
    expect((await enviar([leitura()])).status).toBe(401);
    expect((await chamar("mapa/posicoes", "GET")).status).toBe(401);
  });

  it("leitura inválida é recusada (400) e nada é gravado: coordenada fora da Terra, motivo desconhecido, lote vazio ou grande demais", async () => {
    await rastrear(true);
    for (const ruim of [[leitura({ lat: 91 })], [leitura({ lng: -181 })], [leitura({ motivo: "QUALQUER" })], [leitura({ bateria: 140 })], [], Array.from({ length: 201 }, () => leitura())]) {
      expect((await enviar(ruim)).status).toBe(400);
    }
    expect((await chamar("tecnico/posicao", "POST", { nada: true })).status).toBe(400);
    expect(await linhas()).toEqual([]);
  });

  /* ───────── quem vê ───────── */
  it("só a GESTÃO lê o mapa (Equipes › Gerenciar): técnico e quem só visualiza equipes recebem 403", async () => {
    await rastrear(true);
    await enviar([leitura()]);
    comoTecnico();
    expect((await chamar("mapa/posicoes", "GET")).status).toBe(403);
    comoEscritorio(montarPermissoes({ equipes: ["visualizar"], ordens: ["visualizar", "editar"] }));
    expect((await chamar("mapa/posicoes", "GET")).status).toBe(403);
    comoEscritorio(PRESETS.FINANCEIRO);
    expect((await chamar("mapa/posicoes", "GET")).status).toBe(403);
    comoEscritorio(PRESETS.SUPERVISOR);
    expect((await chamar("mapa/posicoes", "GET")).status).toBe(200);
    comoEscritorio(montarPermissoes({ equipes: ["visualizar", "gerenciar"] }));
    expect((await mapa()).tecnicos.find((t: any) => t.id === "t1").posicao.lat).toBe(-23.5505);
  });

  it("multiempresa: a posição de uma empresa não aparece no mapa da outra, nem com o rastreamento das duas ligado", async () => {
    await rastrear(true); await rastrear(true, "e2");
    await enviar([leitura()]);
    await prisma.tecnicoPosicao.create({ data: { empresaId: "e2", tecnicoId: "tE2", latitude: -10, longitude: -40, registradoEm: new Date(), motivo: "ABRIU_APP" } });
    comoEscritorio();
    expect((await mapa()).tecnicos.map((t: any) => t.id)).not.toContain("tE2");
    comoEscritorio(permissoesTotais(), "e2");
    const outra = await mapa();
    expect(outra.tecnicos.map((t: any) => t.id)).toEqual(["tE2"]);
    expect(JSON.stringify(outra)).not.toContain("João");
  });

  /* ───────── o que o mapa mostra ───────── */
  it("a lista traz os técnicos de CAMPO ativos: com posição (vão para o mapa) e sem (lista 'sem localização'); administrativo e inativo ficam de fora", async () => {
    await rastrear(true);
    await enviar([leitura()]);
    comoEscritorio();
    const { tecnicos } = await mapa();
    expect(tecnicos.map((t: any) => [t.id, !!t.posicao])).toEqual([["t2", false], ["t3", false], ["t1", true]]); // por nome: Bia, Caio, João
    expect(tecnicos.map((t: any) => t.id)).not.toEqual(expect.arrayContaining(["tAdm", "tFora"]));
  });

  it("a OS em que o técnico está: a EM ANDAMENTO dele (responsável ou na equipe); sem ela, a que ele chegou hoje; senão, nenhuma", async () => {
    await rastrear(true);
    await enviar([leitura()]);
    await prisma.atividadeOs.create({ data: { id: "aAnd", empresaId: "e1", ordemServicoId: "os1", titulo: "Preventiva mensal", tecnicoId: "t1", status: "EM_ANDAMENTO", tecnicosEquipe: { create: [{ tecnicoId: "t2" }] } } });
    const hoje = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }));
    await prisma.atividadeOs.create({ data: { id: "aChegou", empresaId: "e1", ordemServicoId: "os2", titulo: "Corretiva", tecnicoId: "t3", status: "AGENDADA", avisosCliente: { create: [{ empresaId: "e1", evento: "CHEGOU", dia: hoje, registradoEm: new Date(), usuarioId: "uT" }] } } });
    // agendada sem chegada, e concluída: não contam
    await prisma.atividadeOs.createMany({ data: [
      { id: "aFut", empresaId: "e1", ordemServicoId: "os2", titulo: "Outra", tecnicoId: "t1", status: "AGENDADA" },
      { id: "aFeita", empresaId: "e1", ordemServicoId: "os2", titulo: "Feita", tecnicoId: "t3", status: "CONCLUIDA" },
    ] });
    comoEscritorio();
    const { tecnicos } = await mapa();
    const os = (id: string) => tecnicos.find((t: any) => t.id === id).os;
    expect(os("t1")).toEqual({ osId: "os1", numero: "OS-0101", atividadeId: "aAnd", titulo: "Preventiva mensal", cliente: "Hospital Santa Luzia", situacao: "EM_ANDAMENTO" });
    expect(os("t2")).toMatchObject({ numero: "OS-0101", situacao: "EM_ANDAMENTO" }); // na composição da atividade
    expect(os("t3")).toMatchObject({ numero: "OS-0102", atividadeId: "aChegou", situacao: "NO_LOCAL" }); // sem posição, mas com a OS
    await prisma.atividadeOs.update({ where: { id: "aAnd" }, data: { status: "CONCLUIDA" } });
    expect((await mapa()).tecnicos.find((t: any) => t.id === "t1").os).toBeNull();
  });

  /* ───────── pronto para o app nativo ───────── */
  it("PRONTO PARA O NATIVO: um lote em segundo plano (origem NATIVO) entra pelo MESMO envio e aparece no MESMO mapa", async () => {
    await rastrear(true);
    const agora = Date.now();
    await enviar([leitura({ lat: -23.4 }, agora - 20 * MIN)]); // o app web, ao abrir
    const lote = Array.from({ length: 60 }, (_, i) => leitura({ lat: -23.4 - i / 1000, motivo: "SEGUNDO_PLANO" }, agora - (60 - i) * 10_000)); // o nativo: uma leitura a cada 10 s
    expect((await enviar(lote, { origem: "NATIVO" })).json).toEqual({ rastreio: true, gravada: true });
    expect(await linhas()).toHaveLength(1); // continua uma linha por técnico
    const t = await noMapa("t1");
    expect(t.posicao).toMatchObject({ motivo: "SEGUNDO_PLANO", origem: "NATIVO" });
    expect(t.posicao.lat).toBeCloseTo(-23.459, 5);
    expect((await enviar([leitura()], { origem: "SATELITE" })).status).toBe(400); // origem desconhecida
  });
});
