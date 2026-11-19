/**
 * ANOTAÇÕES INTERNAS — o Prisma real num PostgreSQL real e as rotas de verdade:
 *  - a TRAVA DO DONO no SERVIDOR: ADMIN e OPERADOR levam 403 em todas as rotas, mesmo sabendo a URL;
 *  - o ciclo da anotação: criar (com e sem print), listar, mudar status, descartar, excluir;
 *  - o print em tabela separada: a listagem não arrasta base64 e a imagem vem por rota própria;
 *  - **SUPER_ADMIN NÃO É CHAVE-MESTRA ENTRE EMPRESAS** — a trava que o ajuste de segurança pediu:
 *    o dono da empresa A não alcança NADA da empresa B, nem anotação nem dado do sistema (cliente,
 *    OS, equipamento, lista), e não alcança nem a anotação do outro dono da MESMA empresa.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/anotacoes-pg
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais, pode, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_anotacoes_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

/** 1x1 JPEG de verdade (o validador decide o tipo pelos BYTES, não pelo rótulo). */
const JPEG_1X1 =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof" +
  "Hh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDI0M//AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAA" +
  "AAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJ" +
  "ChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Sl" +
  "pqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAwDAQACEQMRAD8A/wD/2Q==";

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const logar = (o: { id: string; empresaId: string; role: string; permissoes?: Permissoes }) => {
  sessao.atual = {
    user: {
      id: o.id, name: o.id, email: `${o.id}@x.com`,
      empresaId: o.empresaId, role: o.role,
      permissoes: o.permissoes ?? permissoesTotais(), tecnicoId: null,
    },
  };
};
const deslogar = () => { sessao.atual = null; };

vi.setConfig({ testTimeout: 90_000 });

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}, busca = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${busca}`, {
    method: metodo, headers: { "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await (mod as any)[metodo](req, { params: Promise.resolve(params) });
  const tipo = res.headers.get("content-type") ?? "";
  return { status: res.status, json: tipo.includes("json") ? await res.json().catch(() => null) : null, tipo };
}

describe.skipIf(!URL_PG)("Anotações Internas (PostgreSQL real)", () => {
  let prisma: any;

  const NOVA = {
    tela: "/ordens/:id?aba=materiais",
    rota: "/ordens/os-1?aba=materiais",
    tituloTela: "OS-1001",
    ancora: "data-secao=materiais",
    ancoraIndice: 0,
    caminho: "ul>li:nth-of-type(2)>button",
    rotulo: "Separar",
    papel: "button",
    fx: 0.5, fy: 0.25, x: 320, y: 480, viewportW: 1440,
    texto: "O atalho de separar está escondido demais",
  };

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));

    // DUAS empresas, cada uma com o SEU dono: é o cenário da trava multiempresa
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e1@x.com" },
      { id: "e2", nome: "Refrigeração Norte", cnpj: "98765432000110", email: "e2@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uDono", empresaId: "e1", nome: "Zé do Frivo", email: "dono@x.com", senha: "x", role: "SUPER_ADMIN" },
      { id: "uDono2", empresaId: "e2", nome: "Outro Dono", email: "dono2@x.com", senha: "x", role: "SUPER_ADMIN" },
      { id: "uAdmin", empresaId: "e1", nome: "Gabi Gestora", email: "admin@x.com", senha: "x", role: "ADMIN" },
      { id: "uOp", empresaId: "e1", nome: "Caio Operador", email: "op@x.com", senha: "x", role: "OPERADOR" },
    ] });
    await prisma.configuracao.createMany({ data: [{ empresaId: "e1" }, { empresaId: "e2" }] });

    // massa do SISTEMA nas duas empresas, para provar o isolamento nas rotas de verdade
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "11222333000181" },
      { id: "c2", empresaId: "e2", nome: "Shopping do Norte", cpfCnpj: "44555666000199" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "u1", empresaId: "e1", clienteId: "c1", nome: "Bloco A" },
      { id: "u2", empresaId: "e2", clienteId: "c2", nome: "Praça central" },
    ] });
    await prisma.equipamento.createMany({ data: [
      { id: "eq1", empresaId: "e1", unidadeId: "u1", tipo: "AR_CONDICIONADO_SPLIT", marca: "Carrier", modelo: "42XQ" },
      { id: "eq2", empresaId: "e2", unidadeId: "u2", tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "S4" },
    ] });
    await prisma.ordemServico.createMany({ data: [
      { id: "os1", empresaId: "e1", numero: "OS-1001", clienteId: "c1", criadoPorId: "uDono", descricao: "Preventiva" },
      { id: "os2", empresaId: "e2", numero: "OS-2001", clienteId: "c2", criadoPorId: "uDono2", descricao: "Corretiva" },
    ] });

    logar({ id: "uDono", empresaId: "e1", role: "SUPER_ADMIN" });
  }, 180_000);

  afterEach(async () => {
    await prisma.anotacaoInterna.deleteMany({});
    logar({ id: "uDono", empresaId: "e1", role: "SUPER_ADMIN" });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const criar = (over: Record<string, unknown> = {}) => chamar("anotacoes", "POST", { ...NOVA, ...over });
  const listar = (busca = "") => chamar("anotacoes", "GET", undefined, {}, busca);

  /* ═════════ a trava do dono, no servidor ═════════ */

  describe("Só o dono do Frivo passa — e a trava é de servidor", () => {
    it("o dono cria e lista", async () => {
      expect((await criar()).status).toBe(201);
      const r = await listar();
      expect(r.status).toBe(200);
      expect(r.json.anotacoes).toHaveLength(1);
    });

    it("o ADMIN da empresa (o administrador do CLIENTE) leva 403 em todas as rotas", async () => {
      const criada = await criar();
      logar({ id: "uAdmin", empresaId: "e1", role: "ADMIN" });
      expect(await listar()).toMatchObject({ status: 403 });
      expect(await criar()).toMatchObject({ status: 403 });
      expect(await chamar("anotacoes/[id]", "PATCH", { status: "feita" }, { id: criada.json.id })).toMatchObject({ status: 403 });
      expect(await chamar("anotacoes/[id]", "DELETE", undefined, { id: criada.json.id })).toMatchObject({ status: 403 });
      expect(await chamar("anotacoes/[id]/print", "GET", undefined, { id: criada.json.id })).toMatchObject({ status: 403 });
    });

    it("o OPERADOR com todas as permissões do perfil também leva 403 (não é questão de permissão)", async () => {
      logar({ id: "uOp", empresaId: "e1", role: "OPERADOR", permissoes: permissoesTotais() });
      expect(await listar()).toMatchObject({ status: 403 });
      expect(await criar()).toMatchObject({ status: 403 });
    });

    it("sem sessão: 401", async () => {
      deslogar();
      expect(await listar()).toMatchObject({ status: 401 });
      expect(await criar()).toMatchObject({ status: 401 });
    });
  });

  /* ═════════ SUPER_ADMIN NÃO É CHAVE-MESTRA (o ajuste de segurança) ═════════ */

  describe("SUPER_ADMIN não é chave-mestra entre empresas", () => {
    it("o dono de e1 NÃO lê, NÃO muda e NÃO exclui anotação de e2", async () => {
      // a anotação nasce na e2, pelo dono da e2
      logar({ id: "uDono2", empresaId: "e2", role: "SUPER_ADMIN" });
      const daOutra = await criar({ texto: "Anotação da outra empresa" });
      expect(daOutra.status).toBe(201);

      // agora o dono da e1 tenta alcançar pelo id
      logar({ id: "uDono", empresaId: "e1", role: "SUPER_ADMIN" });
      const lista = await listar();
      expect(lista.json.anotacoes).toHaveLength(0); // nem aparece

      expect(await chamar("anotacoes/[id]", "PATCH", { status: "feita" }, { id: daOutra.json.id })).toMatchObject({ status: 404 });
      expect(await chamar("anotacoes/[id]", "DELETE", undefined, { id: daOutra.json.id })).toMatchObject({ status: 404 });
      expect(await chamar("anotacoes/[id]/print", "GET", undefined, { id: daOutra.json.id })).toMatchObject({ status: 404 });

      // e nada foi tocado no banco da outra empresa
      const intacta = await prisma.anotacaoInterna.findUnique({ where: { id: daOutra.json.id } });
      expect(intacta).toMatchObject({ empresaId: "e2", usuarioId: "uDono2", status: "aberta" });
    });

    it("um dono não alcança a anotação do OUTRO dono da mesma empresa (cada um vê as suas)", async () => {
      await prisma.usuario.create({ data: { id: "uDono1b", empresaId: "e1", nome: "Sócio", email: "socio@x.com", senha: "x", role: "SUPER_ADMIN" } });
      logar({ id: "uDono1b", empresaId: "e1", role: "SUPER_ADMIN" });
      const doSocio = await criar({ texto: "Anotação do sócio" });

      logar({ id: "uDono", empresaId: "e1", role: "SUPER_ADMIN" });
      expect((await listar()).json.anotacoes).toHaveLength(0);
      expect(await chamar("anotacoes/[id]", "PATCH", { status: "feita" }, { id: doSocio.json.id })).toMatchObject({ status: 404 });
      await prisma.usuario.delete({ where: { id: "uDono1b" } }); // a anotação cai com o usuário (cascade)
    });

    it("o dono de e1 NÃO alcança CLIENTE, OS nem EQUIPAMENTO de e2 pelas rotas do sistema", async () => {
      logar({ id: "uDono", empresaId: "e1", role: "SUPER_ADMIN" });
      // o que é da própria empresa, ele vê
      expect((await chamar("clientes/[id]", "GET", undefined, { id: "c1" })).status).toBe(200);
      expect((await chamar("ordens/[id]", "GET", undefined, { id: "os1" })).status).toBe(200);
      expect((await chamar("equipamentos/[id]", "GET", undefined, { id: "eq1" })).status).toBe(200);
      // o da outra empresa, não — o papel não abre porta nenhuma aqui
      expect((await chamar("clientes/[id]", "GET", undefined, { id: "c2" })).status).toBe(404);
      expect((await chamar("ordens/[id]", "GET", undefined, { id: "os2" })).status).toBe(404);
      expect((await chamar("equipamentos/[id]", "GET", undefined, { id: "eq2" })).status).toBe(404);
    });

    it("e as LISTAS do sistema também ficam na empresa dele (nada da vizinha vaza)", async () => {
      logar({ id: "uDono", empresaId: "e1", role: "SUPER_ADMIN" });
      const equipamentos = await chamar("equipamentos", "GET");
      expect(equipamentos.status).toBe(200);
      const ids = equipamentos.json.map((e: any) => e.id);
      expect(ids).toContain("eq1");
      expect(ids).not.toContain("eq2");

      const clientes = await chamar("clientes", "GET");
      const nomes = JSON.stringify(clientes.json);
      expect(nomes).toContain("Hospital Santa Luzia");
      expect(nomes).not.toContain("Shopping do Norte");
    });

    it("e vale para os dois lados: o dono de e2 não alcança nada de e1", async () => {
      logar({ id: "uDono2", empresaId: "e2", role: "SUPER_ADMIN" });
      expect((await chamar("clientes/[id]", "GET", undefined, { id: "c1" })).status).toBe(404);
      expect((await chamar("ordens/[id]", "GET", undefined, { id: "os1" })).status).toBe(404);
      expect((await chamar("equipamentos/[id]", "GET", undefined, { id: "eq1" })).status).toBe(404);
    });

    it("as duas chaves são exigidas JUNTAS: empresa de uma com usuário de outra não alcança nada", async () => {
      // Por que este caso existe: nas rotas, o par (empresa, usuário) vem SEMPRE da mesma sessão, e
      // um usuário pertence a uma empresa só — então o filtro de usuário, por si, já esconde o dado
      // da vizinha. O filtro de EMPRESA é a segunda tranca, para o caso de uma sessão velha ou
      // adulterada trazer um par que não combina. Aqui ela é cobrada diretamente no servidor.
      const servidor = await import("@/lib/anotacoes/servidor");
      logar({ id: "uDono", empresaId: "e1", role: "SUPER_ADMIN" });
      const minha = await criar({ print: { conteudo: JPEG_1X1, largura: 10, altura: 10 } });
      expect(minha.status).toBe(201);

      const parTorto = { empresaId: "e2", usuarioId: "uDono" }; // usuário da e1 com a empresa da e2
      expect(await servidor.listarAnotacoes(parTorto)).toEqual([]);
      expect(await servidor.printDaAnotacao(parTorto, minha.json.id)).toBeNull();
      expect(await servidor.atualizarAnotacao(parTorto, minha.json.id, { status: "feita" })).toMatchObject({ ok: false });
      expect(await servidor.excluirAnotacao(parTorto, minha.json.id)).toMatchObject({ ok: false });

      // e o par CERTO continua alcançando (a tranca não trancou o dono fora)
      const certo = { empresaId: "e1", usuarioId: "uDono" };
      expect(await servidor.listarAnotacoes(certo)).toHaveLength(1);
      expect(await servidor.printDaAnotacao(certo, minha.json.id)).toContain("data:image/jpeg");
      // nada foi mudado nem apagado pelas tentativas com o par torto
      expect(await prisma.anotacaoInterna.findUnique({ where: { id: minha.json.id } })).toMatchObject({ status: "aberta" });
    });

    it("promover a SUPER_ADMIN não amplia a permissão dentro da própria empresa (é igual a ADMIN)", async () => {
      // `pode()` já tratava os dois do mesmo jeito ANTES desta leva: o papel só abre a ferramenta
      for (const modulo of ["financeiro", "ordens", "equipamentos", "configuracoes"]) {
        expect(pode(undefined, modulo, "visualizar", "SUPER_ADMIN")).toBe(pode(undefined, modulo, "visualizar", "ADMIN"));
      }
    });
  });

  /* ═════════ o ciclo da anotação ═════════ */

  describe("O ciclo: criar, listar, mudar status, excluir", () => {
    it("nasce aberta, com a âncora inteira gravada e sem data de resolução", async () => {
      const r = await criar();
      expect(r.status).toBe(201);
      const a = await prisma.anotacaoInterna.findUnique({ where: { id: r.json.id } });
      expect(a).toMatchObject({
        empresaId: "e1", usuarioId: "uDono", status: "aberta", resolvidoEm: null,
        tela: NOVA.tela, rota: NOVA.rota, tituloTela: "OS-1001",
        ancora: "data-secao=materiais", ancoraIndice: 0, caminho: NOVA.caminho,
        rotulo: "Separar", papel: "button", fx: 0.5, fy: 0.25, x: 320, y: 480, viewportW: 1440,
      });
    });

    it("feita carimba a data; reabrir limpa o carimbo", async () => {
      const r = await criar();
      expect((await chamar("anotacoes/[id]", "PATCH", { status: "feita" }, { id: r.json.id })).status).toBe(200);
      expect((await prisma.anotacaoInterna.findUnique({ where: { id: r.json.id } })).resolvidoEm).toBeInstanceOf(Date);
      await chamar("anotacoes/[id]", "PATCH", { status: "aberta" }, { id: r.json.id });
      expect((await prisma.anotacaoInterna.findUnique({ where: { id: r.json.id } })).resolvidoEm).toBeNull();
    });

    it("descartar NÃO apaga (o registro fica); excluir apaga de vez", async () => {
      const r = await criar();
      await chamar("anotacoes/[id]", "PATCH", { status: "descartada" }, { id: r.json.id });
      expect(await prisma.anotacaoInterna.count()).toBe(1);
      expect((await chamar("anotacoes/[id]", "DELETE", undefined, { id: r.json.id })).status).toBe(200);
      expect(await prisma.anotacaoInterna.count()).toBe(0);
    });

    it("o filtro por status e por tela funciona na listagem", async () => {
      const a = await criar({ texto: "primeira" });
      await criar({ texto: "segunda", tela: "/equipamentos", rota: "/equipamentos" });
      await chamar("anotacoes/[id]", "PATCH", { status: "feita" }, { id: a.json.id });

      expect((await listar("?status=aberta")).json.anotacoes).toHaveLength(1);
      expect((await listar("?status=feita")).json.anotacoes).toHaveLength(1);
      expect((await listar("?tela=/equipamentos")).json.anotacoes).toHaveLength(1);
      expect((await listar()).json.anotacoes).toHaveLength(2);
    });

    it("texto vazio e status inventado são recusados", async () => {
      expect((await criar({ texto: "   " })).status).toBe(400);
      const r = await criar();
      expect((await chamar("anotacoes/[id]", "PATCH", { status: "resolvida" }, { id: r.json.id })).status).toBe(400);
    });

    it("id que não existe: 404, sem estourar", async () => {
      expect((await chamar("anotacoes/[id]", "PATCH", { status: "feita" }, { id: "nao-existe" })).status).toBe(404);
      expect((await chamar("anotacoes/[id]", "DELETE", undefined, { id: "nao-existe" })).status).toBe(404);
    });
  });

  /* ═════════ o print ═════════ */

  describe("O print fica em tabela separada e nunca bloqueia o salvar", () => {
    const comPrint = { conteudo: JPEG_1X1, largura: 720, altura: 450, printFx: 0.4, printFy: 0.6 };

    it("guarda o print com as frações do alvo, e a LISTAGEM não traz o base64", async () => {
      const r = await criar({ print: comPrint });
      expect(r.status).toBe(201);
      expect(r.json.avisoPrint).toBeUndefined();

      const p = await prisma.anotacaoPrint.findUnique({ where: { anotacaoId: r.json.id } });
      expect(p).toMatchObject({ largura: 720, altura: 450, printFx: 0.4, printFy: 0.6 });
      expect(p.bytes).toBeGreaterThan(0);

      // a lista diz que EXISTE print, sem trafegar a imagem
      const lista = await listar();
      const item = lista.json.anotacoes[0];
      expect(item.print).toMatchObject({ largura: 720, altura: 450 });
      expect(JSON.stringify(item)).not.toContain("data:image");
    });

    it("a imagem vem por rota própria, como anexo", async () => {
      const r = await criar({ print: comPrint });
      const img = await chamar("anotacoes/[id]/print", "GET", undefined, { id: r.json.id });
      expect(img.status).toBe(200);
      expect(img.tipo).toContain("image/jpeg");
    });

    it("print grande demais: a ANOTAÇÃO salva e o aviso volta (nunca o contrário)", async () => {
      const enorme = `data:image/jpeg;base64,${"A".repeat(600 * 1024)}`;
      const r = await criar({ print: { ...comPrint, conteudo: enorme } });
      expect(r.status).toBe(201);
      expect(r.json.avisoPrint).toContain("print");
      expect(await prisma.anotacaoInterna.count()).toBe(1);
      expect(await prisma.anotacaoPrint.count()).toBe(0);
    });

    it("print que não é imagem de verdade (HTML disfarçado): recusado, anotação salva", async () => {
      const falso = `data:image/jpeg;base64,${Buffer.from("<html><script>alert(1)</script></html>").toString("base64")}`;
      const r = await criar({ print: { ...comPrint, conteudo: falso } });
      expect(r.status).toBe(201);
      expect(r.json.avisoPrint).toBeTruthy();
      expect(await prisma.anotacaoPrint.count()).toBe(0);
    });

    it("sem print: a anotação existe e a rota do print devolve 404", async () => {
      const r = await criar();
      expect(await prisma.anotacaoPrint.count()).toBe(0);
      expect((await chamar("anotacoes/[id]/print", "GET", undefined, { id: r.json.id })).status).toBe(404);
    });

    it("excluir a anotação leva o print junto (cascade)", async () => {
      const r = await criar({ print: comPrint });
      expect(await prisma.anotacaoPrint.count()).toBe(1);
      await chamar("anotacoes/[id]", "DELETE", undefined, { id: r.json.id });
      expect(await prisma.anotacaoPrint.count()).toBe(0);
    });
  });
});
