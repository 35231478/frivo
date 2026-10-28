/**
 * NFS-e PR1 — rotas reais com o Prisma num PostgreSQL real e o PlugNotas FALSO (fetch):
 *  - GET mostra "não configurado" em homologação; só com Financeiro › Fiscal (403 sem);
 *  - salvar sem tudo = PENDENTE com a lista do que falta, sem chamar o PlugNotas;
 *  - certificado com senha errada / vencido / de outro CNPJ / formato errado: recusado e nada gravado;
 *  - completo: POST /certificado (arquivo + senha) → GET /empresa (404) → POST /empresa; ATIVO; no
 *    banco só referência + validade (nem senha nem arquivo), e nada disso no log nem na resposta;
 *  - salvar de novo: PATCH (sem reenviar o certificado); erro do PlugNotas: dados ficam, status ERRO;
 *  - Testar conexão: OK / emitente sumiu / certificado vencido lá; produção bloqueada sem token próprio;
 *    trocar de ambiente exige reenviar o certificado; cada empresa é um emitente separado;
 *  - município pelo endereço (ViaCEP), item de Configurações e a página com a permissão.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/nfse-emitente-pg
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { itemConfig, podeVerItemConfig } from "@/lib/navegacao/configuracoes";
import { gerarPfx } from "./helpers/pfx";
import { criarPlugNotasFalso, PRODUCAO, SANDBOX } from "./helpers/plugnotas-falso";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_nfse_emitente_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const SENHA = "Senha-Do-Certificado-123";

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/financeiro/fiscal", useSearchParams: () => new URLSearchParams(),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, redirect: (u: string) => { throw new Error(`NEXT_REDIRECT ${u}`); },
}));

const FISCAL = montarPermissoes({ financeiro: ["visualizar", "fiscal"] });
const logar = (permissoes: Permissoes = FISCAL, id = "uFin", empresaId = "e1", role = "OPERADOR") => {
  sessao.atual = { user: { id, name: id, email: `${id}@x.com`, empresaId, empresaNome: "Clima Total", role, permissoes } };
};

const plug = criarPlugNotasFalso();

async function chamar(rota: string, metodo: string, corpo?: FormData) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, body: corpo });
  const res: Response = await mod[metodo](req, { params: Promise.resolve({}) });
  const texto = await res.text();
  return { status: res.status, texto, json: (() => { try { return JSON.parse(texto); } catch { return null; } })() };
}
const CAMPOS = {
  inscricaoMunicipal: "1234567-8", regimeTributario: "SIMPLES_NACIONAL", regimeEspecial: "", incentivoFiscal: "false", incentivadorCultural: "false",
  ambiente: "HOMOLOGACAO", codigoMunicipio: "3550308", municipioNome: "São Paulo", municipioUf: "SP",
};
function formulario(campos: Partial<Record<keyof typeof CAMPOS, string>> = {}, cert?: { arquivo?: Buffer; nome?: string; senha?: string }) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ ...CAMPOS, ...campos })) f.append(k, v);
  if (cert) {
    f.append("certificado", new Blob([new Uint8Array(cert.arquivo ?? gerarPfx({ senha: SENHA }))]), cert.nome ?? "clima.pfx");
    f.append("senha", cert.senha ?? SENHA);
  }
  return f;
}
const salvar = (campos?: Parameters<typeof formulario>[0], cert?: Parameters<typeof formulario>[1]) => chamar("fiscal/emitente", "POST", formulario(campos, cert));
const testar = () => chamar("fiscal/emitente/testar", "POST");

describe.skipIf(!URL_PG)("NFS-e: dados fiscais e emitente no PlugNotas (PostgreSQL real + PlugNotas falso)", () => {
  let prisma: any;
  const fiscal = (empresaId = "e1") => prisma.empresaFiscal.findUnique({ where: { empresaId } });
  const logs: unknown[][] = [];

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["fiscal/emitente", "fiscal/emitente/testar", "fiscal/municipio"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total Refrigeração Ltda", nomeFantasia: "Clima Total", cnpj: "12345678000190", email: "fiscal@ct.com.br", telefone: "(11) 3333-4444",
        endereco: "Rua das Flores", numero: "100", bairro: "Centro", cidade: "São Paulo", estado: "SP", cep: "01001-000" },
      { id: "e2", nome: "Outra Empresa Ltda", cnpj: "98765432000110", email: "o@x.com", endereco: "Av. B", numero: "5", bairro: "Bela Vista", cidade: "Campinas", estado: "SP", cep: "13010-000" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uFin", empresaId: "e1", nome: "Fátima", email: "f@x.com", senha: "x" },
      { id: "uOutra", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x" },
    ] });
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });
  beforeEach(() => {
    // o PlugNotas falso guarda emitentes/certificados entre os testes (como o de verdade); zera só as chamadas e as falhas
    plug.estado.chamadas = []; plug.estado.falhas = {}; plug.estado.viacep = {};
    plug.instalar(); logar();
    logs.length = 0;
    for (const m of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a); });
  });
  afterEach(() => {
    // nenhum log com a senha ou o token (em nenhum teste)
    const tudo = JSON.stringify(logs);
    expect(tudo).not.toContain(SENHA);
    expect(tudo).not.toContain("token-sandbox");
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it("GET: não configurado, em homologação por padrão; sem Financeiro › Fiscal = 403 (GET, POST, testar, município)", async () => {
    const r = await chamar("fiscal/emitente", "GET");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      status: "NAO_CONFIGURADO", statusLabel: "Não configurado", emitente: null, certificado: null,
      dados: { ambiente: "HOMOLOGACAO", regimeTributario: null, inscricaoMunicipal: "" },
      ambientesDisponiveis: { HOMOLOGACAO: true, PRODUCAO: false },
    });
    expect(r.json.pendencias).toContain("Certificado digital A1 (.pfx) e a senha");
    logar(montarPermissoes({ financeiro: ["visualizar", "contasReceber", "fluxoCaixa"], configuracoes: ["visualizar", "gerenciar"] }));
    for (const [rota, m] of [["fiscal/emitente", "GET"], ["fiscal/emitente", "POST"], ["fiscal/emitente/testar", "POST"], ["fiscal/municipio", "GET"]] as const) {
      expect((await chamar(rota, m, m === "POST" && rota === "fiscal/emitente" ? formulario() : undefined)).status).toBe(403);
    }
    expect(await fiscal()).toBeNull();
    expect(plug.estado.chamadas).toEqual([]);
  });

  it("salvar sem certificado: grava os dados (e a IM na empresa), fica PENDENTE e não chama o PlugNotas", async () => {
    const r = await salvar({ inscricaoMunicipal: " 1234567-8 " });
    expect([r.status, r.json.sincronizado, r.json.pendencias]).toEqual([200, false, ["Certificado digital A1 (.pfx) e a senha"]]);
    expect(r.json.emitente).toMatchObject({ status: "PENDENTE", dados: { regimeTributario: "SIMPLES_NACIONAL", codigoMunicipio: "3550308", inscricaoMunicipal: "1234567-8" } });
    expect((await prisma.empresa.findUnique({ where: { id: "e1" } })).inscricaoMunicipal).toBe("1234567-8");
    expect(await fiscal()).toMatchObject({ status: "PENDENTE", ambiente: "HOMOLOGACAO", municipioUf: "SP", atualizadoPorId: "uFin", certificadoId: null });
    expect(plug.estado.chamadas).toEqual([]);
  });

  it("validação dos campos: IBGE com 7 dígitos, UF, regime e ambiente válidos", async () => {
    expect(await salvar({ codigoMunicipio: "35503" })).toMatchObject({ status: 400, json: { erro: "O código IBGE do município tem 7 dígitos." } });
    expect(await salvar({ municipioUf: "S1" })).toMatchObject({ status: 400, json: { erro: "UF inválida." } });
    expect((await salvar({ regimeTributario: "OUTRO" })).status).toBe(400);
    expect((await salvar({ ambiente: "TESTE" })).status).toBe(400);
    expect((await salvar({ inscricaoMunicipal: "9".repeat(31) })).json.erro).toBe("Inscrição municipal longa demais.");
    expect((await chamar("fiscal/emitente", "POST")).json.erro).toBe("Envie o formulário dos dados fiscais.");
  });

  it("certificado recusado aqui (senha, vencido, ainda não vale, outro CNPJ, formato, sem senha): nada muda no banco nem no PlugNotas", async () => {
    const antes = await fiscal();
    const casos: [Parameters<typeof formulario>[1], string][] = [
      [{ senha: "senha-errada" }, "Senha do certificado incorreta."],
      [{ arquivo: gerarPfx({ senha: SENHA, de: new Date("2024-01-01"), ate: new Date("2025-01-01T12:00:00Z") }) }, "Certificado vencido em 01/01/2025: renove o A1 e envie o novo."],
      [{ arquivo: gerarPfx({ senha: SENHA, de: new Date(Date.now() + 5 * 86_400_000) }) }, "Este certificado só passa a valer em"],
      [{ arquivo: gerarPfx({ senha: SENHA, cn: "OUTRA EMPRESA:98765432000110" }) }, "O certificado é do CNPJ 98.765.432/0001-10, mas a empresa é 12.345.678/0001-90. Envie o certificado desta empresa."],
      [{ nome: "certificado.cer" }, "Envie o certificado A1 no formato .pfx ou .p12."],
      [{ senha: "" }, "Informe a senha do certificado."],
      [{ arquivo: Buffer.from("lixo") }, "Arquivo inválido: envie o certificado A1 no formato .pfx ou .p12."],
    ];
    for (const [cert, msg] of casos) {
      const r = await salvar({ regimeTributario: "LUCRO_REAL" }, cert);
      expect(r.status).toBe(400);
      expect(r.json.erro).toContain(msg);
      expect(r.texto).not.toContain(SENHA);
    }
    expect(await fiscal()).toEqual(antes);
    expect(plug.estado.chamadas).toEqual([]);
    expect((await salvar({}, { arquivo: Buffer.alloc(100 * 1024 + 1, 1) })).json.erro).toBe("Arquivo grande demais para um certificado A1 (.pfx).");
  });

  it("completo: envia certificado, cadastra o emitente (POST) e fica ATIVO; banco/resposta/log sem senha nem arquivo", async () => {
    const r = await salvar({}, {});
    expect([r.status, r.json.sincronizado, r.json.mensagem]).toEqual([200, true, "Emitente cadastrado no PlugNotas (homologação (testes))."]);
    expect(plug.rotas()).toEqual(["POST /certificado", "GET /empresa/12345678000190", "POST /empresa"]);
    const [cert, , emp] = plug.estado.chamadas;
    expect(cert).toMatchObject({ base: SANDBOX, token: "token-sandbox", form: { campos: { senha: SENHA }, arquivo: { nome: "clima.pfx" } } });
    expect(emp.json).toMatchObject({
      cpfCnpj: "12345678000190", inscricaoMunicipal: "12345678", razaoSocial: "Clima Total Refrigeração Ltda", certificado: "cert-1",
      simplesNacional: true, regimeTributario: 1, endereco: { codigoCidade: "3550308", estado: "SP", cep: "01001000" }, nfse: { config: { producao: false } },
    });
    const f = await fiscal();
    expect(f).toMatchObject({
      status: "ATIVO", ultimoErro: null, certificadoId: "cert-1", certificadoTitular: "CLIMA TOTAL REFRIGERACAO LTDA", certificadoCnpj: "12345678000190",
      emitenteCnpj: "12345678000190", emitenteAmbiente: "HOMOLOGACAO",
    });
    expect(f.certificadoValidoAte).toBeInstanceOf(Date);
    expect(f.certificadoEnviadoEm).toBeInstanceOf(Date);
    const linhaInteira = JSON.stringify(await prisma.$queryRawUnsafe(`SELECT * FROM empresa_fiscal`)) + JSON.stringify(await prisma.$queryRawUnsafe(`SELECT * FROM empresas`));
    expect(linhaInteira).not.toContain(SENHA);
    expect(linhaInteira).not.toMatch(/MII|pkcs/i);
    expect(r.texto).not.toContain(SENHA);
    expect(r.json.emitente).toMatchObject({ status: "ATIVO", emitente: { cnpj: "12345678000190", ambiente: "HOMOLOGACAO" }, certificado: { titular: "CLIMA TOTAL REFRIGERACAO LTDA", vencido: false }, pendencias: [] });
  });

  it("salvar de novo sem certificado: atualiza (PATCH) usando o certificado que já está lá", async () => {
    const r = await salvar({ regimeTributario: "LUCRO_PRESUMIDO", incentivoFiscal: "true" });
    expect([r.status, r.json.mensagem]).toEqual([200, "Emitente atualizado no PlugNotas (homologação (testes))."]);
    expect(plug.rotas()).toEqual(["GET /empresa/12345678000190", "PATCH /empresa/12345678000190"]);
    expect(plug.estado.chamadas[1].json).toMatchObject({ certificado: "cert-1", simplesNacional: false, regimeTributario: 3, incentivoFiscal: true });
  });

  it("Testar conexão: OK com a validade; emitente sumido lá; certificado vencido lá; PlugNotas fora do ar", async () => {
    let r = await testar();
    expect(r.status).toBe(200);
    expect(r.json.mensagem).toBe("Conexão OK: emitente 12.345.678/0001-90 ativo no PlugNotas (homologação (testes)); certificado válido até 01/10/2027.");
    expect(await fiscal()).toMatchObject({ ultimoTesteOk: true, status: "ATIVO", certificadoValidoAte: new Date("2027-10-01T00:00:00.000Z") });
    expect(r.json.emitente.ultimoTeste).toMatchObject({ ok: true });

    plug.estado.vencimentoCertificado = new Date(Date.now() + 10 * 86_400_000).toISOString();
    plug.estado.certificados["cert-1"].vencimento = plug.estado.vencimentoCertificado;
    r = await testar();
    expect(r.json.mensagem).toMatch(/certificado válido até .* \(faltam 9 dias: providencie a renovação\)\.$/);

    plug.estado.certificados["cert-1"].vencimento = "2026-01-15T12:00:00.000Z";
    r = await testar();
    expect([r.status, r.json.ok, r.json.mensagem]).toEqual([502, false, "O certificado venceu em 15/01/2026: renove o A1 e envie o novo."]);
    expect(await fiscal()).toMatchObject({ status: "ERRO", ultimoTesteOk: false, ultimoErro: "O certificado venceu em 15/01/2026: renove o A1 e envie o novo." });

    delete plug.estado.empresas[`${SANDBOX}|12345678000190`];
    r = await testar();
    expect(r.json.mensagem).toBe("A empresa 12.345.678/0001-90 não está cadastrada no PlugNotas (homologação (testes)). Salve os dados fiscais de novo.");

    plug.estado.falhas["GET /empresa*"] = { status: 503, corpo: null };
    r = await testar();
    expect(r.json.mensagem).toBe("O PlugNotas está fora do ar ou com erro (503). Tente de novo mais tarde.");
    expect(r.json.emitente).toMatchObject({ status: "ERRO", ultimoTeste: { ok: false } });
  });

  it("erro do PlugNotas ao cadastrar: os dados ficam, status ERRO com a mensagem; certificado já enviado fica guardado", async () => {
    await prisma.empresaFiscal.update({ where: { empresaId: "e1" }, data: { certificadoId: null } });
    delete plug.estado.empresas[`${SANDBOX}|12345678000190`];
    plug.estado.falhas["POST /empresa"] = { status: 400, corpo: { error: { message: "Inscrição municipal inválida para o município", data: { inscricaoMunicipal: "x" } } } };
    const r = await salvar({ regimeTributario: "LUCRO_REAL" }, {});
    expect([r.status, r.json.sincronizado, r.json.erro]).toEqual([502, false, "Inscrição municipal inválida para o município Campos: inscricaoMunicipal."]);
    expect(await fiscal()).toMatchObject({ status: "ERRO", ultimoErro: "Inscrição municipal inválida para o município Campos: inscricaoMunicipal.", regimeTributario: "LUCRO_REAL", certificadoId: Object.keys(plug.estado.certificados).at(-1) }); // o que acabou de subir
    expect(r.json.emitente.statusLabel).toBe("Erro no PlugNotas");
    // corrige do lado de lá e salva de novo sem reenviar o arquivo
    delete plug.estado.falhas["POST /empresa"];
    expect((await salvar({ regimeTributario: "LUCRO_REAL" })).json.sincronizado).toBe(true);
    expect(plug.rotas().slice(-2)).toEqual(["GET /empresa/12345678000190", "POST /empresa"]);
  });

  it("servidor sem PLUGNOTAS_API_TOKEN: não chama nada, ERRO com a explicação", async () => {
    delete process.env.PLUGNOTAS_API_TOKEN;
    const r = await salvar({});
    expect(r.json.erro).toBe("A integração com o PlugNotas não está configurada neste servidor (falta PLUGNOTAS_API_TOKEN).");
    expect(plug.estado.chamadas).toEqual([]);
    expect((await fiscal()).status).toBe("ERRO");
    expect((await chamar("fiscal/emitente", "GET")).json.ambientesDisponiveis).toEqual({ HOMOLOGACAO: false, PRODUCAO: false });
  });

  it("produção: bloqueada sem o token de produção; trocar de ambiente exige reenviar o certificado; com tudo, vai à base de produção com producao=true", async () => {
    expect(await salvar({ ambiente: "PRODUCAO" })).toMatchObject({ status: 400, json: { erro: "Produção ainda não está liberada neste servidor. Mantenha em homologação." } });
    process.env.PLUGNOTAS_API_TOKEN_PRODUCAO = "token-producao";
    expect(await salvar({ ambiente: "PRODUCAO" })).toMatchObject({ status: 400, json: { erro: "Para mudar para produção, envie o certificado de novo (cada ambiente do PlugNotas tem o seu cadastro)." } });
    expect((await fiscal()).ambiente).toBe("HOMOLOGACAO");
    const r = await salvar({ ambiente: "PRODUCAO" }, {});
    expect(r.json.sincronizado).toBe(true);
    expect(plug.estado.chamadas.every((c) => c.base === PRODUCAO && c.token === "token-producao")).toBe(true);
    expect(plug.estado.chamadas.at(-1)!.json.nfse).toEqual({ ativo: true, tipoContrato: 0, config: { producao: true } });
    expect(await fiscal()).toMatchObject({ ambiente: "PRODUCAO", emitenteAmbiente: "PRODUCAO", status: "ATIVO" });
    // volta para homologação (reenviando) para os próximos testes
    expect((await salvar({ ambiente: "HOMOLOGACAO" }, {})).json.sincronizado).toBe(true);
  });

  it("multiempresa: cada empresa é um emitente; a outra empresa não vê nem testa o desta", async () => {
    logar(permissoesTotais(), "uOutra", "e2");
    expect((await chamar("fiscal/emitente", "GET")).json).toMatchObject({ status: "NAO_CONFIGURADO", emitente: null, empresa: { cnpj: "98765432000110" } });
    expect(await testar()).toMatchObject({ status: 400, json: { erro: "Salve os dados fiscais e o certificado primeiro: o emitente ainda não foi cadastrado no PlugNotas." } });
    const r = await salvar({ municipioNome: "Campinas", codigoMunicipio: "3509502" }, { arquivo: gerarPfx({ senha: SENHA, cn: "OUTRA EMPRESA LTDA:98765432000110" }) });
    expect(r.json.sincronizado).toBe(true);
    expect(plug.rotas()).toEqual(["POST /certificado", "GET /empresa/98765432000110", "POST /empresa"]);
    expect(await fiscal("e2")).toMatchObject({ emitenteCnpj: "98765432000110", certificadoCnpj: "98765432000110" });
    expect(await fiscal("e1")).toMatchObject({ emitenteCnpj: "12345678000190" });
  });

  it("município pelo endereço da empresa (ViaCEP); sem achar = 404 com a orientação", async () => {
    plug.estado.viacep["01001000"] = { ibge: "3550308", localidade: "São Paulo", uf: "SP" };
    expect((await chamar("fiscal/municipio", "GET")).json).toEqual({ codigo: "3550308", nome: "São Paulo", uf: "SP", fonte: "cep" });
    plug.estado.viacep = {};
    const r = await chamar("fiscal/municipio", "GET");
    expect([r.status, r.json.erro]).toEqual([404, "Não achei o código IBGE pelo endereço da empresa. Confira CEP, cidade e UF em Dados da empresa, ou digite o código."]);
  });

  it("Configurações e a página: o cartão e a tela só com Financeiro › Fiscal", async () => {
    const item = itemConfig("dados-fiscais")!;
    expect(item).toMatchObject({ aba: "financeiras", href: "/configuracoes/dados-fiscais", modulo: "financeiro", acao: "fiscal" });
    expect(podeVerItemConfig(item, FISCAL)).toBe(true);
    expect(podeVerItemConfig(item, montarPermissoes({ financeiro: ["visualizar", "fluxoCaixa"] }))).toBe(false);
    expect(podeVerItemConfig(item, montarPermissoes({}), "ADMIN")).toBe(true);
    expect(podeVerItemConfig(itemConfig("banco-inter")!, montarPermissoes({ configuracoes: ["visualizar"] }))).toBe(true);
    const { default: Pagina } = await import("@/app/(dashboard)/financeiro/fiscal/page");
    const { TelaDadosFiscais } = await import("@/components/config/telas/dados-fiscais");
    // a página de Financeiro é a mesma tela, voltando para /financeiro
    expect(Pagina()).toMatchObject({ type: TelaDadosFiscais, props: { voltar: "/financeiro" } });
    const h = renderToStaticMarkup(await TelaDadosFiscais({ voltar: "/financeiro" }));
    expect(h).toContain("Dados fiscais (NFS-e)");
    expect(h).toContain("data-situacao-emitente");
    expect(h).toContain('href="/financeiro"');
    expect(renderToStaticMarkup(await TelaDadosFiscais({}))).toContain('href="/configuracoes"');
    expect(h).not.toContain(SENHA);
    logar(montarPermissoes({ financeiro: ["visualizar"] }));
    await expect(TelaDadosFiscais({})).rejects.toThrow("NEXT_REDIRECT /sem-permissao");
  });
});
