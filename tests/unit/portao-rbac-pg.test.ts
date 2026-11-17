/**
 * O PORTÃO DE ACESSO com CONTAS DE VERDADE: as páginas reais, renderizadas sobre PostgreSQL, com
 * perfis não-administradores que só têm a permissão da ação.
 *
 * O que se prova, página por página:
 *  - ADMISSÕES: o RH que só tem "Admissão digital › Gerenciar" passa pelo portão, abre a lista, vê
 *    as ações e cria uma admissão pela rota; quem não tem a permissão continua em /sem-permissao —
 *    mesmo gerenciando colaboradores. O nome só vira link para a ficha para quem pode abrir a ficha;
 *  - CONFIGURAÇÕES: quem tem só a permissão de um item chega à página e vê SÓ o cartão dele; pedir a
 *    tela de outro item pela URL é recusado; quem não pode abrir nenhum vai para /sem-permissao;
 *  - APP DO COLABORADOR: "Configurações › Gerenciar" basta, sem "Equipes › Visualizar";
 *  - NOVO ENVIO pelo atalho: o cliente da URL é conferido contra a empresa, e o contrato só vale se
 *    for um contrato ATIVO daquele cliente.
 * Pula sem PG_TESTE_URL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, portaoBarra, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_portao_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/", useSearchParams: () => new URLSearchParams(),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, redirect: (u: string) => { throw new Error(`NEXT_REDIRECT ${u}`); },
}));
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("@/lib/email")>()), enviarEmail: vi.fn(async () => ({ ok: true })) }));
// O Novo envio é uma tela de navegador: aqui interessa o que a PÁGINA entrega a ela (o cliente e o
// contrato já conferidos), então a tela vira um espelho do que recebeu.
vi.mock("@/components/documentacao/novo-envio", () => ({
  NovoEnvio: (p: { inicial?: unknown }) => createElement("div", { "data-inicial": JSON.stringify(p.inicial ?? null) }),
}));

/** Uma conta comum (não é o administrador master) com exatamente estas permissões. */
const como = (permissoes: Permissoes, empresaId = "e1", id = "uRh") => {
  sessao.atual = { user: { id, name: "Rita do RH", email: "rita@climatotal.com", empresaId, empresaNome: "Clima Total", role: "OPERADOR", permissoes, tecnicoId: null } };
  return permissoes;
};
const RH = () => como(montarPermissoes({ admissao: ["gerenciar"] }));
const RH_COM_FICHA = () => como(montarPermissoes({ admissao: ["gerenciar"], equipes: ["visualizar", "gerenciar"] }));
const SO_EQUIPES = () => como(montarPermissoes({ equipes: ["visualizar", "gerenciar", "excluir"], documentos: ["criar", "gerenciar"] }));
const SEM_NADA = () => como(montarPermissoes({}));

/** O que o middleware faria com este endereço para a conta logada — a mesma função que ele usa. */
const barrado = (rota: string) => portaoBarra(rota, sessao.atual.user.permissoes, sessao.atual.user.role);

async function api(caminho: string, metodo: string, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/${caminho}/route`);
  const req = new NextRequest("https://app.exemplo.com/x", {
    method: metodo, headers: { "Content-Type": "application/json", "x-forwarded-for": "200.1.2.3" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve({}) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe.skipIf(!URL_PG)("O portão com contas não-administradoras (PostgreSQL real)", () => {
  let prisma: any;

  const paginaAdmissoes = async (sp: Record<string, string> = {}) => {
    const { default: Pagina } = await import("@/app/(dashboard)/admissoes/page");
    return renderToStaticMarkup(await Pagina({ searchParams: Promise.resolve(sp) }));
  };
  const paginaConfig = async (sp: Record<string, string> = {}) => {
    const { default: Pagina } = await import("@/app/(dashboard)/configuracoes/page");
    return renderToStaticMarkup(await Pagina({ searchParams: Promise.resolve(sp) }));
  };
  const paginaNovoEnvio = async (sp: Record<string, string> = {}) => {
    const { default: Pagina } = await import("@/app/(dashboard)/documentacao-equipe/novo/page");
    const html = renderToStaticMarkup(await Pagina({ searchParams: Promise.resolve(sp) }));
    return JSON.parse(/data-inicial="([^"]*)"/.exec(html)![1].replace(/&quot;/g, '"'));
  };

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total LTDA", nomeFantasia: "Clima Total", cnpj: "12.345.678/0001-90", email: "contato@climatotal.com" },
      { id: "e2", nome: "Outra Climatização", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uRh", empresaId: "e1", nome: "Rita do RH", email: "rita@climatotal.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto Dias", email: "beto@x.com", senha: "x" },
    ] });
    await prisma.cargo.createMany({ data: [{ id: "g1", empresaId: "e1", nome: "Técnico de refrigeração" }] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Shopping Ibirapuera S.A.", nomeFantasia: "Shopping Ibirapuera", cpfCnpj: "11.111.111/0001-11" },
      { id: "c2", empresaId: "e1", nome: "Hospital Santa Clara", cpfCnpj: "22.222.222/0001-22" },
      { id: "cX", empresaId: "e2", nome: "Cliente da outra empresa", cpfCnpj: "44.444.444/0001-44" },
    ] });
    const dataInicio = new Date("2026-01-01T12:00:00.000Z");
    await prisma.contrato.createMany({ data: [
      { id: "kAtivo", empresaId: "e1", clienteId: "c1", numero: "CT-1", tipo: "MANUTENCAO_PREVENTIVA", dataInicio, status: "ATIVO" },
      { id: "kEncerrado", empresaId: "e1", clienteId: "c1", numero: "CT-2", tipo: "MANUTENCAO_PREVENTIVA", dataInicio, status: "ENCERRADO" },
      { id: "kDoOutro", empresaId: "e1", clienteId: "c2", numero: "CT-3", tipo: "MANUTENCAO_PREVENTIVA", dataInicio, status: "ATIVO" },
    ] });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  beforeEach(async () => {
    await prisma.admissao.deleteMany({});
    await prisma.tecnico.deleteMany({});
  });

  /* ───────────────────────── admissões ───────────────────────── */

  it("o RH que só tem \"Admissão digital › Gerenciar\" passa pelo portão, cria a admissão e a vê na lista com as ações", async () => {
    RH();
    expect(barrado("/admissoes"), "antes: só o administrador master passava").toBe(false);

    const criada = await api("api/admissoes", "POST", { nome: "Marina Alves", cpf: "52998224725", cargoId: "g1", salario: 3200, telefone: "11988887777", email: "marina@exemplo.com" });
    expect(criada.status, JSON.stringify(criada.json)).toBe(201);

    const html = await paginaAdmissoes();
    expect(html).toContain("data-tabela-admissoes");
    expect(html).toContain("Marina Alves");
    expect((html.match(/data-admissao="/g) ?? []).length, "a linha (e o cartão do celular) da admissão").toBeGreaterThan(0);
    expect(html, "o ⋮ com as ações da linha").toContain('data-acao="menu"');
    expect(html, "o botão de convidar mais um").toContain("Nova admissão");
    expect((await api("api/admissoes", "GET")).status).toBe(200);
  });

  it("o nome só vira link para a ficha para quem pode abrir a ficha do colaborador", async () => {
    RH();
    await api("api/admissoes", "POST", { nome: "Marina Alves", cpf: "52998224725", cargoId: "g1", salario: 3200 });
    const colaborador = await prisma.tecnico.findFirst({ where: { empresaId: "e1" }, select: { id: true } });
    const link = `href="/colaboradores/${colaborador.id}/editar"`;

    expect(barrado(`/colaboradores/${colaborador.id}/editar`), "o RH puro não abre a ficha").toBe(true);
    const doRh = await paginaAdmissoes();
    expect(doRh).toContain("Marina Alves");
    expect(doRh, "sem link que levaria a \"sem permissão\"").not.toContain(link);

    // ver a lista de colaboradores não basta: a ficha exige "Equipes › Gerenciar" — o link seria um beco
    como(montarPermissoes({ admissao: ["gerenciar"], equipes: ["visualizar"] }));
    expect(await paginaAdmissoes(), "só visualizar equipes: sem link").not.toContain(link);
    como(montarPermissoes({ admissao: ["gerenciar"], equipes: ["gerenciar"] }));
    expect(await paginaAdmissoes(), "gerenciar sem visualizar: o portão barraria a ficha").not.toContain(link);

    RH_COM_FICHA();
    expect(barrado(`/colaboradores/${colaborador.id}/editar`)).toBe(false);
    expect(await paginaAdmissoes()).toContain(link);
  });

  it("quem não gerencia admissão continua em /sem-permissao — pela página, e a rota responde 403", async () => {
    RH();
    await api("api/admissoes", "POST", { nome: "Marina Alves", cpf: "52998224725", cargoId: "g1", salario: 3200 });

    for (const perfil of [SO_EQUIPES, SEM_NADA]) {
      perfil();
      expect(barrado("/admissoes"), "o portão não decide mais esta rota").toBe(false);
      await expect(paginaAdmissoes()).rejects.toThrow("NEXT_REDIRECT /sem-permissao");
      expect((await api("api/admissoes", "GET")).status).toBe(403);
      expect((await api("api/admissoes", "POST", { nome: "X", cpf: "11144477735", cargoId: "g1", salario: 1 })).status).toBe(403);
    }
    expect(await prisma.admissao.count(), "a recusa não criou nada").toBe(1);
  });

  it("a lista do RH é só da empresa dele", async () => {
    RH();
    await api("api/admissoes", "POST", { nome: "Marina Alves", cpf: "52998224725", cargoId: "g1", salario: 3200 });
    como(montarPermissoes({ admissao: ["gerenciar"] }), "e2", "uB");
    const outra = await paginaAdmissoes();
    expect(outra).not.toContain("Marina Alves");
    expect(outra).not.toContain('data-admissao="');
  });

  /* ───────────────────────── configurações ───────────────────────── */

  it("Configurações: o RH chega à página e vê SÓ o cartão da admissão — e a rota da tela aceita", async () => {
    RH();
    expect(barrado("/configuracoes")).toBe(false);
    expect(barrado("/configuracoes/admissao"), "a rota antiga do item redireciona para a página").toBe(false);

    const html = await paginaConfig({ aba: "conta" });
    expect(html).toContain("Admissão digital");
    for (const alheio of ["Usuários", "Perfis de acesso", "Tipos de OS", "Dados fiscais", "Modelos de documento"]) {
      expect(html, `${alheio} não é dele`).not.toContain(alheio);
    }
    expect((await api("api/admissoes/config", "GET")).status).toBe(200);
  });

  it("Configurações: pedir pela URL a tela de um item que não é dele é recusado", async () => {
    RH();
    expect(barrado("/configuracoes/usuarios"), "a rota do item comum continua atrás do portão").toBe(true);
    const { default: Pagina } = await import("@/app/(dashboard)/configuracoes/page");
    const arvore: any = await Pagina({ searchParams: Promise.resolve({ secao: "usuarios" }) });
    expect(arvore.props.secaoAberta, "a tela não é montada").toBeNull();
    expect(arvore.props.secaoNegada).toBe("usuarios");
    expect(arvore.props.children).toBeNull();
    expect(arvore.props.visiveis).toEqual(["admissao"]);

    const dele: any = await Pagina({ searchParams: Promise.resolve({ secao: "admissao" }) });
    expect(dele.props.secaoAberta).toBe("admissao");
    expect(dele.props.secaoNegada).toBeNull();
  });

  it("Configurações: quem não pode abrir nenhum item vai para /sem-permissao (antes era o portão; agora é a página)", async () => {
    for (const perfil of [SEM_NADA, SO_EQUIPES_SEM_MODELOS]) {
      perfil();
      expect(barrado("/configuracoes")).toBe(false);
      await expect(paginaConfig()).rejects.toThrow("NEXT_REDIRECT /sem-permissao");
    }
  });

  it("Configurações: quem já entrava continua entrando, com tudo o que tinha", async () => {
    como(montarPermissoes({ configuracoes: ["visualizar"] }));
    const html = await paginaConfig({ aba: "operacionais" });
    expect(html).toContain("Tipos de OS");
    expect(html, "o cartão do RH continua só para o RH").not.toContain("Admissão digital");
    como(permissoesTotais());
    expect(await paginaConfig({ aba: "conta" })).toContain("Admissão digital");
  });

  /* ───────────────────────── app do colaborador ───────────────────────── */

  it("App do colaborador: \"Configurações › Gerenciar\" basta — sem \"Equipes › Visualizar\"", async () => {
    const { default: Pagina } = await import("@/app/(dashboard)/equipes/app-colaborador/page");
    como(montarPermissoes({ configuracoes: ["gerenciar"] }));
    expect(barrado("/equipes/app-colaborador"), "antes o portão pedia Equipes › Visualizar").toBe(false);
    expect(barrado("/equipes"), "a lista de equipes continua fora do alcance dele").toBe(true);
    expect(await Pagina()).toBeTruthy();

    SO_EQUIPES();
    expect(barrado("/equipes/app-colaborador")).toBe(false);
    await expect(Pagina()).rejects.toThrow("NEXT_REDIRECT /sem-permissao");
  });

  /* ───────────────────────── novo envio pelo atalho ───────────────────────── */

  it("o atalho abre o Novo envio com o cliente (e o contrato ATIVO dele) já escolhidos", async () => {
    como(montarPermissoes({ documentos: ["enviar"] }));
    expect(await paginaNovoEnvio()).toBeNull();
    expect(await paginaNovoEnvio({ clienteId: "c1" })).toEqual({ clienteId: "c1", clienteNome: "Shopping Ibirapuera", contratoId: null });
    expect(await paginaNovoEnvio({ clienteId: "c2" }), "sem nome fantasia vai a razão social").toEqual({ clienteId: "c2", clienteNome: "Hospital Santa Clara", contratoId: null });
    expect(await paginaNovoEnvio({ clienteId: "c1", contratoId: "kAtivo" })).toEqual({ clienteId: "c1", clienteNome: "Shopping Ibirapuera", contratoId: "kAtivo" });
  });

  it("o que vem na URL é conferido: cliente de outra empresa, contrato encerrado e contrato de outro cliente são ignorados", async () => {
    como(montarPermissoes({ documentos: ["enviar"] }));
    expect(await paginaNovoEnvio({ clienteId: "cX" }), "cliente de outra empresa: abre vazio").toBeNull();
    expect(await paginaNovoEnvio({ clienteId: "nao-existe" })).toBeNull();
    expect((await paginaNovoEnvio({ clienteId: "c1", contratoId: "kEncerrado" })).contratoId, "contrato encerrado não estreita nada").toBeNull();
    expect((await paginaNovoEnvio({ clienteId: "c1", contratoId: "kDoOutro" })).contratoId, "contrato de outro cliente").toBeNull();
    expect(await paginaNovoEnvio({ contratoId: "kAtivo" }), "contrato sem cliente não escolhe ninguém").toBeNull();
  });

  it("o atalho não fura a permissão: sem \"Documentos › Enviar ao cliente\" a página manda para /sem-permissao", async () => {
    SO_EQUIPES();
    await expect(paginaNovoEnvio({ clienteId: "c1" })).rejects.toThrow("NEXT_REDIRECT /sem-permissao");
  });
});

/** Gerencia colaboradores, mas não os modelos de documento: nenhum cartão de Configurações é dele. */
function SO_EQUIPES_SEM_MODELOS() {
  return como(montarPermissoes({ equipes: ["visualizar", "gerenciar", "excluir"], documentos: ["criar", "enviar"] }));
}
