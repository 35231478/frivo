/**
 * NFS-e PR1 — cliente do PlugNotas contra o PlugNotas FALSO (fetch): base e token por ambiente
 * (homologação = sandbox; produção bloqueada sem token próprio), x-api-key, multipart do
 * certificado (arquivo + senha), certificado repetido devolve o id que já existe, 404 = emitente não
 * cadastrado, POST × PATCH, rede/tempo esgotado e erros em português SEM o token, a senha ou o arquivo.
 * E a busca do código IBGE (ViaCEP pelo CEP; senão BrasilAPI pela UF + cidade).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ambienteDisponivel, consultarCertificado, consultarEmpresa, enviarCertificado, ErroPlugNotas, salvarEmpresa, semSegredos } from "@/lib/nfse/plugnotas";
import { buscarMunicipio, normalizarNome } from "@/lib/nfse/municipio";
import { criarPlugNotasFalso, PRODUCAO, SANDBOX } from "./helpers/plugnotas-falso";
import { corpoEmpresaPlugNotas } from "@/lib/nfse/regras";

const plug = criarPlugNotasFalso();
beforeEach(() => { plug.zerar(); plug.instalar(); });
afterEach(() => { vi.unstubAllGlobals(); });

const erroDe = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as ErroPlugNotas; } };
const PFX = Buffer.from("conteudo-binario-do-pfx");
/** Um corpo de empresa que passa na validação do JSON (o mesmo que o servidor monta) */
const corpoValido = (certificado: string) => corpoEmpresaPlugNotas(
  { cnpj: "12345678000190", nome: "Clima Total", endereco: "Rua A", numero: "1", bairro: "Centro", cep: "01001000", inscricaoMunicipal: "123" },
  { regimeTributario: "SIMPLES_NACIONAL", regimeEspecial: null, incentivoFiscal: false, incentivadorCultural: false, ambiente: "HOMOLOGACAO", codigoMunicipio: "3550308", municipioNome: "São Paulo", municipioUf: "SP" },
  certificado,
);

describe("ambiente e token", () => {
  it("homologação usa o sandbox com x-api-key; produção usa a base de produção com o token dela", async () => {
    await consultarEmpresa("HOMOLOGACAO", "12345678000190");
    expect(plug.estado.chamadas[0]).toMatchObject({ base: SANDBOX, caminho: "/empresa/12345678000190", metodo: "GET", token: "token-sandbox" });
    process.env.PLUGNOTAS_API_TOKEN_PRODUCAO = "token-producao";
    await consultarEmpresa("PRODUCAO", "12345678000190");
    expect(plug.estado.chamadas[1]).toMatchObject({ base: PRODUCAO, token: "token-producao" });
  });
  it("transporte: toda chamada recusa redirecionamento (o x-api-key e o .pfx não seguem para outro endereço)", async () => {
    plug.estado.falhas["POST /certificado"] = { status: 200, corpo: { data: { id: "cert-x" } } };
    await consultarEmpresa("HOMOLOGACAO", "1");
    await enviarCertificado("HOMOLOGACAO", PFX, "a.pfx", "s3nh@");
    await consultarCertificado("HOMOLOGACAO", "cert-x").catch(() => {});
    await salvarEmpresa("HOMOLOGACAO", corpoValido("cert-x"), false).catch(() => {});
    expect(plug.estado.chamadas.map((c) => c.redirect)).toEqual(["error", "error", "error", "error"]);
  });
  it("transporte: base sem https é recusada antes de qualquer envio (http só em localhost)", async () => {
    for (const url of ["http://api.sandbox.plugnotas.com.br", "http://10.0.0.5:8080", "ftp://x", "api.sandbox.plugnotas.com.br", "https//x"]) {
      process.env.PLUGNOTAS_API_URL = url;
      expect(ambienteDisponivel("HOMOLOGACAO")).toBe(true);
      const e = await erroDe(enviarCertificado("HOMOLOGACAO", PFX, "a.pfx", "s3nh@"));
      expect([e?.status, e?.message], url).toEqual([503, "O endereço do PlugNotas (PLUGNOTAS_API_URL) precisa começar com https://. Nada foi enviado."]);
    }
    process.env.PLUGNOTAS_API_TOKEN_PRODUCAO = "token-producao";
    process.env.PLUGNOTAS_API_URL_PRODUCAO = "http://api.plugnotas.com.br/";
    expect((await erroDe(consultarEmpresa("PRODUCAO", "1")))?.message).toBe("O endereço do PlugNotas (PLUGNOTAS_API_URL_PRODUCAO) precisa começar com https://. Nada foi enviado.");
    expect(plug.fetchMock).not.toHaveBeenCalled();
    // desenvolvimento: um simulador no próprio computador pode ser http
    for (const local of ["http://localhost:3999", "http://127.0.0.1:3999/", "http://[::1]:3999"]) {
      process.env.PLUGNOTAS_API_URL = local;
      await erroDe(consultarEmpresa("HOMOLOGACAO", "9"));
      expect(String(plug.fetchMock.mock.calls.at(-1)?.[0])).toBe(`${local.replace(/\/$/, "")}/empresa/9`);
    }
  });
  it("sem token: homologação e produção recusadas com mensagem clara; base sobrescrita por variável", async () => {
    expect(ambienteDisponivel("HOMOLOGACAO")).toBe(true);
    expect(ambienteDisponivel("PRODUCAO")).toBe(false);
    const p = await erroDe(consultarEmpresa("PRODUCAO", "1"));
    expect([p?.status, p?.message]).toEqual([503, "Produção ainda não está liberada neste servidor (falta PLUGNOTAS_API_TOKEN_PRODUCAO). Use homologação."]);
    process.env.PLUGNOTAS_API_TOKEN = "   ";
    expect(ambienteDisponivel("HOMOLOGACAO")).toBe(false);
    const h = await erroDe(consultarEmpresa("HOMOLOGACAO", "1"));
    expect(h?.message).toBe("A integração com o PlugNotas não está configurada neste servidor (falta PLUGNOTAS_API_TOKEN).");
    expect(plug.estado.chamadas).toEqual([]);
    process.env.PLUGNOTAS_API_TOKEN = "token-sandbox";
    // PLUGNOTAS_API_URL troca o host (barra final ignorada); aqui aponta para outro host conhecido do falso
    process.env.PLUGNOTAS_API_URL = `${PRODUCAO}/`;
    await erroDe(consultarEmpresa("HOMOLOGACAO", "9"));
    expect(plug.estado.chamadas[0].url).toBe(`${PRODUCAO}/empresa/9`);
  });
  it("token recusado (401): mensagem sem o token", async () => {
    process.env.PLUGNOTAS_API_TOKEN = "token-que-vazaria";
    const e = await erroDe(consultarEmpresa("HOMOLOGACAO", "1"));
    expect([e?.status, e?.message]).toEqual([422, "O PlugNotas recusou o acesso: o token da integração (PLUGNOTAS_API_TOKEN) é inválido ou não tem permissão."]);
    expect(e?.message).not.toContain("token-que-vazaria");
  });
});

describe("certificado", () => {
  it("POST /certificado multipart (arquivo + senha) → id; GET devolve o vencimento", async () => {
    const r = await enviarCertificado("HOMOLOGACAO", PFX, "empresa.pfx", "s3nh@");
    expect(r).toEqual({ id: "cert-1" });
    expect(plug.estado.chamadas[0]).toMatchObject({
      metodo: "POST", caminho: "/certificado",
      form: { campos: { senha: "s3nh@" }, arquivo: { nome: "empresa.pfx", tamanho: PFX.length, tipo: "application/x-pkcs12" } },
    });
    expect(await consultarCertificado("HOMOLOGACAO", "cert-1")).toEqual({ vencimento: new Date("2027-10-01T00:00:00.000Z") });
    expect(plug.estado.chamadas[1].caminho).toBe("/certificado/cert-1");
  });
  it("certificado que já estava lá (409 com o id): usa o id existente; sem nome vai como certificado.pfx", async () => {
    plug.estado.falhas["POST /certificado"] = { status: 409, corpo: { error: { message: "Certificado já cadastrado", data: { id: "cert-antigo" } } } };
    expect(await enviarCertificado("HOMOLOGACAO", PFX, "", "x")).toEqual({ id: "cert-antigo" });
    expect(plug.estado.chamadas[0].form?.arquivo?.nome).toBe("certificado.pfx");
  });
  it("mensagem do PlugNotas que ecoa a senha ou o token: os dois saem dela (e mensagem enorme é cortada em 600)", async () => {
    plug.estado.falhas["POST /certificado"] = { status: 400, corpo: { error: { message: "Falha ao abrir o arquivo com a chave 'Minha#Chave2026' (cliente token-sandbox)", data: { arquivo: "x" } } } };
    const e = await erroDe(enviarCertificado("HOMOLOGACAO", PFX, "a.pfx", "Minha#Chave2026"));
    expect([e?.status, e?.message]).toEqual([422, "Falha ao abrir o arquivo com a chave '•••' (cliente •••). Campos: arquivo."]);
    plug.estado.falhas["GET /empresa/1"] = { status: 422, corpo: { error: { message: `token-sandbox ${"x".repeat(900)}` } } };
    const longo = await erroDe(consultarEmpresa("HOMOLOGACAO", "1"));
    expect([longo?.message.length, longo?.message.startsWith("••• xxx"), longo?.message.endsWith("…")]).toEqual([600, true, true]);
    // segredo curto demais não é "procurado" (estragaria o texto); vazio/nulo não quebram
    expect(semSegredos("abc 123 abc", ["abc", "", null, undefined])).toBe("abc 123 abc");
    expect(semSegredos("abcd 1234 abcd", ["abcd"])).toBe("••• 1234 •••");
  });
  it("recusado (senha) ou sem id na resposta: erro em português, sem a senha", async () => {
    plug.estado.falhas["POST /certificado"] = { status: 400, corpo: { error: { message: "Senha do certificado incorreta" } } };
    const e = await erroDe(enviarCertificado("HOMOLOGACAO", PFX, "a.pfx", "SENHA-SECRETA"));
    expect([e?.status, e?.message]).toEqual([422, "O PlugNotas recusou o certificado: a senha não confere."]);
    expect(e?.message).not.toContain("SENHA-SECRETA");
    plug.estado.falhas["POST /certificado"] = { status: 200, corpo: { message: "ok" } };
    expect((await erroDe(enviarCertificado("HOMOLOGACAO", PFX, "a.pfx", "x")))?.message).toBe("O PlugNotas recusou os dados (200).");
    plug.estado.falhas["POST /certificado"] = { status: 409, corpo: { error: { message: "dup" } } };
    expect((await erroDe(enviarCertificado("HOMOLOGACAO", PFX, "a.pfx", "x")))?.message).toBe("dup");
  });
  it("vencimento: campo validade/dataValidade/data embrulhado; data inválida ou ausente = null; erro vira ErroPlugNotas", async () => {
    plug.estado.falhas["GET /certificado/a"] = { status: 200, corpo: { data: { validade: "2028-01-02T00:00:00Z" } } };
    expect(await consultarCertificado("HOMOLOGACAO", "a")).toEqual({ vencimento: new Date("2028-01-02T00:00:00Z") });
    plug.estado.falhas["GET /certificado/b"] = { status: 200, corpo: { dataValidade: "lixo" } };
    expect(await consultarCertificado("HOMOLOGACAO", "b")).toEqual({ vencimento: null });
    plug.estado.falhas["GET /certificado/c"] = { status: 200, corpo: { id: "c" } };
    expect(await consultarCertificado("HOMOLOGACAO", "c")).toEqual({ vencimento: null });
    expect((await erroDe(consultarCertificado("HOMOLOGACAO", "nao-existe")))?.message).toBe("Certificado não encontrado");
    await consultarCertificado("HOMOLOGACAO", "a/b").catch(() => null);
    expect(plug.estado.chamadas.at(-1)!.caminho).toBe("/certificado/a%2Fb");
  });
});

describe("empresa (emitente)", () => {
  it("404 = não cadastrado; POST cadastra; GET devolve; PATCH atualiza", async () => {
    expect(await consultarEmpresa("HOMOLOGACAO", "12345678000190")).toBeNull();
    const { id } = await enviarCertificado("HOMOLOGACAO", PFX, "a.pfx", "x");
    expect(await salvarEmpresa("HOMOLOGACAO", corpoValido(id), false)).toBe("cadastrado");
    expect(await consultarEmpresa("HOMOLOGACAO", "12345678000190")).toMatchObject({ cpfCnpj: "12345678000190" });
    expect(await salvarEmpresa("HOMOLOGACAO", { ...corpoValido(id), razaoSocial: "Nova" }, true)).toBe("atualizado");
    expect(plug.rotas()).toEqual(["GET /empresa/12345678000190", "POST /certificado", "POST /empresa", "GET /empresa/12345678000190", "PATCH /empresa/12345678000190"]);
    expect(plug.estado.empresas[`${SANDBOX}|12345678000190`]).toMatchObject({ razaoSocial: "Nova", certificado: id });
  });
  it("GET com erro (não 404), POST recusado e PATCH em quem não existe viram ErroPlugNotas (502 se o PlugNotas caiu)", async () => {
    plug.estado.falhas["GET /empresa*"] = { status: 500, corpo: null };
    expect((await erroDe(consultarEmpresa("HOMOLOGACAO", "1")))?.status).toBe(502);
    plug.zerar(); plug.instalar();
    const e = await erroDe(salvarEmpresa("HOMOLOGACAO", corpoValido("nao"), false));
    expect([e?.status, e?.message]).toEqual([422, "Certificado não encontrado. Campos: certificado."]);
    // corpo fora do schema: o detalhe de cada campo chega na mensagem (era só "Campos: fields")
    const fora = await erroDe(salvarEmpresa("HOMOLOGACAO", { ...corpoValido("c"), telefone: { ddd: "11" }, endereco: { ...corpoValido("c").endereco, tipoLogradouro: "" } } as any, false));
    expect([fora?.status, fora?.message]).toEqual([422, "Falha na validação do JSON de Empresa. Campos: telefone (Campo não permitido); endereco.tipoLogradouro (Campo obrigatório)."]);
    expect((await erroDe(salvarEmpresa("HOMOLOGACAO", { cpfCnpj: "2" } as any, true)))?.message).toBe("Empresa não encontrada");
  });
  it("senha da prefeitura que o PlugNotas ecoa no erro do cadastro sai da mensagem (como o token)", async () => {
    plug.estado.falhas["POST /empresa"] = { status: 400, corpo: { error: { message: "Prefeitura recusou o acesso com Pref-Chave-55 (token-sandbox)" } } };
    const corpo = corpoEmpresaPlugNotas(
      { cnpj: "12345678000190", nome: "Clima", endereco: "Rua A", numero: "1", bairro: "B", cep: "01001000", inscricaoMunicipal: "1" },
      { regimeTributario: "SIMPLES_NACIONAL", regimeEspecial: null, incentivoFiscal: false, incentivadorCultural: false, ambiente: "HOMOLOGACAO", codigoMunicipio: "3550308", municipioNome: "SP", municipioUf: "SP" },
      "c", { login: "clima", senha: "Pref-Chave-55" },
    );
    const e = await erroDe(salvarEmpresa("HOMOLOGACAO", corpo, false));
    expect([e?.status, e?.message]).toEqual([422, "Prefeitura recusou o acesso com ••• (•••)"]);
  });
  it("rede caída e tempo esgotado: mensagens próprias (504)", async () => {
    plug.estado.falhas["GET /empresa/1"] = "rede";
    expect(await erroDe(consultarEmpresa("HOMOLOGACAO", "1"))).toMatchObject({ status: 504, message: "Não foi possível falar com o PlugNotas (rede). Tente de novo." });
    plug.estado.falhas["GET /empresa/1"] = "tempo";
    expect(await erroDe(consultarEmpresa("HOMOLOGACAO", "1"))).toMatchObject({ status: 504, message: "O PlugNotas não respondeu a tempo. Tente de novo." });
  });
  it("JSON vai com Content-Type; GET sem corpo; resposta não-JSON não quebra", async () => {
    await salvarEmpresa("HOMOLOGACAO", { cpfCnpj: "3" } as any, true).catch(() => null);
    const init = plug.fetchMock.mock.calls.at(-1)![1] as RequestInit;
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    await consultarEmpresa("HOMOLOGACAO", "3");
    const get = plug.fetchMock.mock.calls.at(-1)![1] as RequestInit;
    expect([get.body, new Headers(get.headers).get("Content-Type")]).toEqual([undefined, null]);
    plug.fetchMock.mockImplementationOnce(async () => new Response("<html>oops</html>", { status: 502 }));
    expect((await erroDe(consultarEmpresa("HOMOLOGACAO", "4")))?.message).toBe("O PlugNotas está fora do ar ou com erro (502). Tente de novo mais tarde.");
  });
});

describe("município (código IBGE)", () => {
  it("pelo CEP no ViaCEP; senão pela UF + cidade (sem acento/maiúsculas); senão null", async () => {
    plug.estado.viacep["01001000"] = { ibge: "3550308", localidade: "São Paulo", uf: "sp" };
    expect(await buscarMunicipio({ cep: "01001-000", cidade: "x", uf: "RJ" })).toEqual({ codigo: "3550308", nome: "São Paulo", uf: "SP", fonte: "cep" });
    plug.estado.ibge.SP = [{ nome: "SANTO ANDRE", codigo_ibge: "3547809" }, { nome: "SAO PAULO", codigo_ibge: "3550308" }];
    expect(await buscarMunicipio({ cep: "99999-999", cidade: " São  Paulo ", uf: "sp" })).toEqual({ codigo: "3550308", nome: "São  Paulo", uf: "SP", fonte: "cidade" });
    expect(await buscarMunicipio({ cep: null, cidade: "Campinas", uf: "SP" })).toBeNull();
    expect(await buscarMunicipio({ cep: "123", cidade: "São Paulo", uf: "São Paulo" })).toBeNull();
    expect(await buscarMunicipio({ cidade: "", uf: "SP" })).toBeNull();
    // UF fora do formato nem é consultada (mesmo que alguém respondesse por ela)
    plug.estado.ibge.S1 = [{ nome: "SAO PAULO", codigo_ibge: "3550308" }];
    expect(await buscarMunicipio({ cidade: "São Paulo", uf: "S1" })).toBeNull();
    plug.estado.viacep["01001000"] = { ibge: "355", localidade: "São Paulo", uf: "SP" };
    expect(await buscarMunicipio({ cep: "01001000", cidade: "São Paulo", uf: "SP" })).toMatchObject({ fonte: "cidade" });
    plug.estado.ibge.MG = { message: "não é lista" };
    expect(await buscarMunicipio({ cidade: "BH", uf: "MG" })).toBeNull();
    expect(normalizarNome("São João d'Aliança")).toBe("sao joao d alianca");
  });
});
