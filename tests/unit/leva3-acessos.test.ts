/**
 * Leva 3 — Acessos internos. Rotas e páginas reais, PostgreSQL real (schema descartável).
 * Prova:
 *  - I5: alterar configurações/empresa/QR exige a PERMISSÃO configuracoes.gerenciar (não mais o
 *    role ADMIN); pode() reconhece SUPER_ADMIN;
 *  - T1/I3: /compras e /leads-site entram no mapa de módulos do middleware; o link de Checklists
 *    da Frota pede "veiculos" (não "configuracoes"); páginas do financeiro conferem a SUB-permissão
 *    (contas a receber, medições, fluxo de caixa); detalhe do pedido usa a regra da API; a ficha
 *    completa do colaborador exige equipes.gerenciar (CA9); o sino só conta o que o usuário pode ver;
 *  - CO10: lead público não cai na "empresa mais antiga" quando há várias, e lead recorrente não
 *    renomeia um cliente existente;
 *  - S7: callbackUrl do login só aceita caminho local;
 *  - S9: trocar o e-mail de login exige a senha atual, grava em minúsculas e o 409 não confirma
 *    e-mails de outras contas;
 *  - S10: o cron de lembretes só aceita Authorization: Bearer (sessão de admin e ?secret= não valem);
 *  - S6: a tentativa de login conta ANTES do bcrypt (paralelas não furam o limite) e o sucesso
 *    apaga os registros da própria requisição (não conta contra o IP do escritório).
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/leva3-acessos
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, permissoesVazias, PRESETS, pode, moduloDaRota } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva3_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

process.env.AUTH_SECRET = "segredo-de-teste-leva3-acessos-com-32-caracteres";
process.env.CRON_SECRET = "cron-segredo-de-teste";

const sessao = vi.hoisted(() => ({ atual: null as any }));
// O espião do S6 conta as tentativas JÁ REGISTRADAS no instante em que o bcrypt roda
const espiao = vi.hoisted(() => ({ ativo: false, contagens: [] as number[] }));
// O sino (/api/alertas) agenda a reconciliação das NFS-e com after(), que só existe numa requisição do Next: aqui não roda
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  auth: vi.fn(async () => sessao.atual),
}));
vi.mock("bcryptjs", async (orig) => {
  const mod = await orig<any>();
  const real = mod.default ?? mod;
  const compare = async (a: string, b: string) => {
    if (espiao.ativo) {
      const { prisma } = await import("@/lib/prisma");
      espiao.contagens.push(await prisma.tentativaAcesso.count({ where: { tipo: "LOGIN" } }));
    }
    return real.compare(a, b);
  };
  const api = { ...real, compare };
  return { ...api, default: api };
});
// E-mail falso (o lead público tenta avisar por e-mail)
vi.mock("@/lib/email", () => ({
  enviarEmail: vi.fn(async () => ({ ok: true })),
  enviarLembreteOrcamento: vi.fn(async () => ({ ok: true })),
}));
// As páginas usam <Link> fora do router nos testes
vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: ({ href, children, ...rest }: any) => React.createElement("a", { href: String(href), ...rest }, children) };
});

const comoAdmin = () => { sessao.atual = { user: { id: "uA", name: "Ana", email: "ana@x.com", empresaId: "e1", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } }; };
const comoComum = (permissoes: any) => { sessao.atual = { user: { id: "uB", name: "Bia", email: "bia@x.com", empresaId: "e1", role: "OPERADOR", permissoes, tecnicoId: null } }; };

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, headers: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x`, {
    method: metodo, headers: { "Content-Type": "application/json", ...headers }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json().catch(() => null) : null };
}

/** Páginas protegidas: redirect("/sem-permissao") vira um erro NEXT_REDIRECT. */
const esperaSemPermissao = async (fn: () => Promise<unknown>) => {
  await expect(fn()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
};

const QR_CFG = {
  paginaPublicaAtiva: true, mostrarHistorico: true, mostrarProximaManutencao: true, mostrarDadosEquipamento: true,
  mostrarLocalizacao: true, botaoWhatsapp: false, botaoOrcamento: false, botaoChamado: true,
  whatsappNumero: "", linkSite: "", mensagemBoasVindas: "", chamadoSomenteLogado: false, historicoSomenteLogado: false, orcamentoSomenteLogado: false,
};

const LEAD = {
  nome: "João do Site", whatsapp: "31999990000", email: "joao@lead.com", cidade: "BH", tipoUso: "residencial",
  ambientes: [{ nome: "Sala", areaM2: 20, btuCalculado: 12000, btuRecomendado: 12000, tipoEquipamento: "SPLIT", justificativa: "padrão" }],
  preOrcamento: { totalMin: 3000, totalMax: 4000 },
};

vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!URL_PG)("Leva 3 — acessos internos (PostgreSQL real)", () => {
  let prisma: any;
  let bcrypt: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    bcrypt = (await import("bcryptjs")).default;

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: await bcrypt.hash("Senha-da-ana1", 4), role: "ADMIN" },
      { id: "uB", empresaId: "e1", nome: "Bia", email: "bia@x.com", senha: await bcrypt.hash("Senha-da-bia1", 4), role: "OPERADOR" },
      { id: "uC", empresaId: "e2", nome: "Caio", email: "caio@outra.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "11.111.111/0001-11" } });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João", cpf: "111.111.111-11", telefone: "31 98888-0000" } });
    // Dados para o sino: 1 pedido pendente + 1 boleto pago hoje
    await prisma.pedidoCompraInterno.create({ data: { id: "pc1", empresaId: "e1", numero: "PC-0001", status: "SOLICITADO", solicitanteId: "uA" } });
    await prisma.contaReceber.create({ data: {
      id: "cr1", empresaId: "e1", clienteId: "c1", numero: "CR-0001", descricao: "Boleto",
      valor: 100, dataVencimento: new Date(), status: "RECEBIDO", boletoStatus: "PAGO", dataRecebimento: new Date(),
    } });
  }, 240_000);

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  beforeEach(() => { espiao.ativo = false; espiao.contagens = []; });

  // ═══════════════ I5 — configurações por permissão (e SUPER_ADMIN) ═══════════════

  it("I5: PUT configurações/empresa/QR aceita quem tem configuracoes.gerenciar e nega quem não tem (não é mais por role)", async () => {
    comoComum(montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] }));
    expect((await chamar("configuracoes", "PUT", {}, {})).status).toBe(200);
    expect((await chamar("empresa", "PUT", {}, { nomeFantasia: "Clima Total LTDA" })).status).toBe(200);
    expect((await chamar("configuracoes/qr-code", "PUT", {}, QR_CFG)).status).toBe(200);

    comoComum(montarPermissoes({ configuracoes: ["visualizar"] })); // só visualizar: não gerencia
    expect((await chamar("configuracoes", "PUT", {}, {})).status).toBe(403);
    expect((await chamar("empresa", "PUT", {}, { nomeFantasia: "X" })).status).toBe(403);
    expect((await chamar("configuracoes/qr-code", "PUT", {}, QR_CFG)).status).toBe(403);
  });

  it("I5/T1/I3: pode() reconhece SUPER_ADMIN; compras/leads-site/checklists da frota entram no mapa do middleware", () => {
    expect(pode(permissoesVazias(), "financeiro", "contasReceber", "SUPER_ADMIN")).toBe(true);
    expect(moduloDaRota("/compras/pedidos")).toBe("compras");
    expect(moduloDaRota("/leads-site")).toBe("orcamentos");
    expect(moduloDaRota("/configuracoes/checklists-veiculo")).toBe("veiculos");
    expect(moduloDaRota("/configuracoes")).toBe("configuracoes");
  });

  // ═══════════════ T1 — páginas do financeiro com sub-permissão ═══════════════

  it("T1: contas a receber e fluxo de caixa exigem a SUB-permissão na página (a API já negava)", async () => {
    const { default: ContasReceber } = await import("@/app/(dashboard)/financeiro/contas-receber/page");
    const { default: FluxoCaixa } = await import("@/app/(dashboard)/financeiro/fluxo-caixa/page");

    comoComum(montarPermissoes({ financeiro: ["visualizar"] })); // sem contasReceber/fluxoCaixa
    await esperaSemPermissao(() => ContasReceber({ searchParams: Promise.resolve({}) }));
    await esperaSemPermissao(() => FluxoCaixa({ searchParams: Promise.resolve({}) }));

    comoComum(montarPermissoes({ financeiro: ["visualizar", "contasReceber"] }));
    await expect(ContasReceber({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
  });

  it("CA9: a ficha completa do colaborador exige equipes.gerenciar na página", async () => {
    const { default: EditarColab } = await import("@/app/(dashboard)/colaboradores/[id]/editar/page");
    comoComum(montarPermissoes({ equipes: ["visualizar"] }));
    await esperaSemPermissao(() => EditarColab({ params: Promise.resolve({ id: "t1" }) }));
    comoComum(montarPermissoes({ equipes: ["visualizar", "gerenciar"] }));
    await expect(EditarColab({ params: Promise.resolve({ id: "t1" }) })).resolves.toBeTruthy();
  });

  it("T1: o detalhe do pedido de compra segue a regra da API (comprador designado entra; sem vínculo nenhum, não)", async () => {
    const { default: PedidoPage } = await import("@/app/(dashboard)/compras/pedidos/[id]/page");
    comoComum(permissoesVazias()); // nem financeiro, nem origem, nem comprador
    await esperaSemPermissao(() => PedidoPage({ params: Promise.resolve({ id: "pc1" }) }));

    await prisma.pedidoCompraInterno.update({ where: { id: "pc1" }, data: { compradorId: "uB" } });
    comoComum(permissoesVazias()); // sem permissão nenhuma, mas é o comprador designado
    await expect(PedidoPage({ params: Promise.resolve({ id: "pc1" }) })).resolves.toBeTruthy();
    await prisma.pedidoCompraInterno.update({ where: { id: "pc1" }, data: { compradorId: null } });
  });

  // ═══════════════ T1 — sino filtrado ═══════════════

  it("T1: o sino não conta compras nem boletos para quem não pode vê-los", async () => {
    comoComum(PRESETS.TECNICO ?? montarPermissoes({ ordens: ["visualizar"] }));
    const tecnico = await chamar("alertas", "GET");
    expect(tecnico.status).toBe(200);
    expect(tecnico.json.pedidosPendentes).toBe(0);
    expect(tecnico.json.boletosPagos).toBe(0);

    comoAdmin();
    const admin = await chamar("alertas", "GET");
    expect(admin.json.pedidosPendentes).toBe(1);
    expect(admin.json.boletosPagos).toBe(1);
  });

  // ═══════════════ CO10 — lead público ═══════════════

  it("CO10: com 2 empresas ativas e sem TERMOFRIO_EMPRESA_ID, o lead é recusado; com a env, entra e o lead recorrente NÃO renomeia o cliente", async () => {
    process.env.SITE_API_TOKEN = "token-site-teste";
    const antes = process.env.TERMOFRIO_EMPRESA_ID;
    delete process.env.TERMOFRIO_EMPRESA_ID;
    const recusado = await chamar("publico/leads", "POST", {}, LEAD, { "x-site-token": "token-site-teste" });
    expect(recusado.status).toBe(500); // não cai na empresa "mais antiga"

    process.env.TERMOFRIO_EMPRESA_ID = "e1";
    const r1 = await chamar("publico/leads", "POST", {}, LEAD, { "x-site-token": "token-site-teste" });
    expect([200, 201]).toContain(r1.status);
    const cliente1 = await prisma.cliente.findFirst({ where: { empresaId: "e1", email: "joao@lead.com" } });
    expect(cliente1.nome).toBe("João do Site");

    // O mesmo WhatsApp volta com outro nome: o cadastro NÃO é renomeado
    const r2 = await chamar("publico/leads", "POST", {}, { ...LEAD, nome: "Impostor Renomeado", email: "outro@lead.com" }, { "x-site-token": "token-site-teste" });
    expect([200, 201]).toContain(r2.status);
    const aposSegundo = await prisma.cliente.findUnique({ where: { id: cliente1.id } });
    expect(aposSegundo.nome).toBe("João do Site");
    if (antes) process.env.TERMOFRIO_EMPRESA_ID = antes; else delete process.env.TERMOFRIO_EMPRESA_ID;
  });

  // ═══════════════ S7 — redirect do login ═══════════════

  it("S7: destinoPosLogin só aceita caminho local", async () => {
    const { destinoPosLogin } = await import("@/components/auth/login-form");
    expect(destinoPosLogin("/ordens/123")).toBe("/ordens/123");
    expect(destinoPosLogin("https://evil.example/phish")).toBe("/dashboard");
    expect(destinoPosLogin("//evil.example")).toBe("/dashboard");
    expect(destinoPosLogin(null)).toBe("/dashboard");
  });

  // ═══════════════ S9 — troca de e-mail de login ═══════════════

  it("S9: trocar o e-mail exige a senha atual, grava em minúsculas e não confirma e-mail alheio; só o nome não exige senha", async () => {
    await prisma.tentativaAcesso.deleteMany({});
    sessao.atual = { user: { id: "uB", name: "Bia", email: "bia@x.com", empresaId: "e1", role: "OPERADOR", permissoes: permissoesVazias() } };

    // Sem a senha atual → 400 (e conta tentativa)
    const semSenha = await chamar("perfil", "PATCH", {}, { email: "Nova.Bia@X.com", confirmacaoEmail: "nova.bia@x.com" });
    expect(semSenha.status).toBe(400);
    const comSenhaErrada = await chamar("perfil", "PATCH", {}, { email: "Nova.Bia@X.com", confirmacaoEmail: "nova.bia@x.com", senhaAtual: "errada" });
    expect(comSenhaErrada.status).toBe(400);
    expect(await prisma.tentativaAcesso.count({ where: { tipo: "TROCA_SENHA" } })).toBeGreaterThan(0);

    // E-mail de OUTRO usuário (outra empresa): resposta genérica, sem "em uso"
    const alheio = await chamar("perfil", "PATCH", {}, { email: "CAIO@outra.com", confirmacaoEmail: "caio@outra.com", senhaAtual: "Senha-da-bia1" });
    expect(alheio.status).toBe(409);
    expect(alheio.json.erro.toLowerCase()).not.toContain("em uso");

    // Com a senha certa → grava MINÚSCULO
    const ok = await chamar("perfil", "PATCH", {}, { email: "Nova.Bia@X.com", confirmacaoEmail: "nova.bia@x.com", senhaAtual: "Senha-da-bia1" });
    expect(ok.status).toBe(200);
    expect((await prisma.usuario.findUnique({ where: { id: "uB" } })).email).toBe("nova.bia@x.com");
    await prisma.usuario.update({ where: { id: "uB" }, data: { email: "bia@x.com" } });

    // Só o nome: sem senha, segue funcionando
    expect((await chamar("perfil", "PATCH", {}, { nome: "Bia Nova" })).status).toBe(200);
  });

  // ═══════════════ S10 — cron só por Bearer ═══════════════

  it("S10: o cron de lembretes recusa sessão de ADMIN e ?secret= na URL; só o header Bearer entra", async () => {
    comoAdmin(); // sessão de admin NÃO basta mais
    const mod = await import("@/app/api/email/processar-lembretes/route");
    const semHeader: Response = await mod.GET(new NextRequest("http://localhost/api/email/processar-lembretes?secret=cron-segredo-de-teste"));
    expect(semHeader.status).toBe(401);

    const errado: Response = await mod.GET(new NextRequest("http://localhost/api/x", { headers: { authorization: "Bearer outro" } }));
    expect(errado.status).toBe(401);

    const certo: Response = await mod.GET(new NextRequest("http://localhost/api/x", { headers: { authorization: "Bearer cron-segredo-de-teste" } }));
    expect(certo.status).toBe(200);
  });

  // ═══════════════ S6 — tentativa conta antes do bcrypt ═══════════════

  it("S6: a tentativa já está registrada QUANDO o bcrypt roda, e o login certo não deixa rastro", async () => {
    await prisma.tentativaAcesso.deleteMany({});
    const { handlers } = await import("@/lib/auth");
    const entrar = async (email: string, senha: string) => {
      const c = await handlers.GET(new NextRequest("http://localhost/api/auth/csrf"));
      const { csrfToken } = await c.json();
      const cookie = c.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
      return handlers.POST(new NextRequest("http://localhost/api/auth/callback/credentials", {
        method: "POST",
        body: new URLSearchParams({ email, senha, csrfToken, callbackUrl: "http://localhost/dashboard" }),
        headers: { "content-type": "application/x-www-form-urlencoded", "x-auth-return-redirect": "1", cookie, "x-forwarded-for": "10.9.9.9" },
      }));
    };

    espiao.ativo = true;
    await entrar("ana@x.com", "senha-errada-1");
    espiao.ativo = false;
    // No instante do bcrypt a tentativa desta requisição JÁ contava (paralelas não furam o limite)
    expect(Math.max(...espiao.contagens)).toBeGreaterThan(0);

    // Senha certa: os registros da própria requisição somem (sucesso não conta contra o IP)
    await prisma.tentativaAcesso.deleteMany({});
    await entrar("ana@x.com", "Senha-da-ana1");
    expect(await prisma.tentativaAcesso.count()).toBe(0);
  });
});
