/**
 * Leva 1 de segurança — rotas reais, Prisma real, PostgreSQL real (schema descartável via `db push`).
 * Prova:
 *  - foto de equipamento/veículo, avatar (colaborador, perfil) e logo validados pelos BYTES ao gravar
 *    (HTML/SVG disfarçado de imagem é recusado; o que grava é o data URL com o MIME real);
 *  - o serviço de foto nunca executa nem redireciona: valor antigo malicioso (HTML, URL) vira 404 e
 *    foto boa sai com o tipo real + nosniff + CSP sandbox;
 *  - anexos de cliente e de contrato saem como BINÁRIO (tipo pelos bytes, nosniff; HTML antigo vira
 *    download inofensivo), não mais como JSON com data URL para a tela abrir;
 *  - Inter: o GET nunca devolve o webhookSecret; a URL só aparece UMA vez ao (re)gerar; o webhook
 *    só baixa depois de CONFIRMAR a situação na API do Inter, e nunca mexe em conta cancelada/recebida;
 *  - o SQL de limpeza (prisma/sql/2026-10-22_limpeza_fotos_senha.sql) tira do banco fotos que não são
 *    imagem e as senhas provisórias em texto, é idempotente e preserva os pares foto×rótulo do veículo;
 *  - os cabeçalhos globais de segurança estão configurados (nosniff, frame-ancestors, referrer).
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/leva-seguranca
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais, PRESETS } from "@/lib/permissoes";
import { HTML, JPEG, PDF, PNG, SVG, dataUrl } from "./arquivos-exemplo";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_seguranca_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
// O webhook NUNCA confia no corpo: a baixa depende do que ESTA consulta responder
const inter = vi.hoisted(() => ({ consultar: vi.fn() }));
vi.mock("@/lib/inter-api", () => ({ consultarBoletoInter: inter.consultar, testarConexaoInter: vi.fn(), configurarWebhookInter: vi.fn() }));

const comoAdmin = () => { sessao.atual = { user: { id: "uA", name: "Ana", email: "ana@x.com", empresaId: "e1", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } }; };
const comoTecnico = () => { sessao.atual = { user: { id: "uT", name: "João", email: "j@x.com", empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: null } }; };

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const tipo = res.headers.get("content-type") ?? "";
  return { status: res.status, tipo, headers: res.headers, json: tipo.includes("json") ? await res.json() : null, res };
}
async function chamarForm(rota: string, metodo: string, params: Record<string, string>, form: FormData) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x`, { method: metodo, body: form });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const FOTO_PNG = dataUrl("image/png", PNG);
const FOTO_JPEG = dataUrl("image/jpeg", JPEG);
/** HTML com script DISFARÇADO de imagem: o prefixo mente, os bytes não */
const HTML_DISFARCADO = dataUrl("image/png", HTML);
const SVG_DISFARCADO = dataUrl("image/jpeg", SVG);

const EQ_BASE = { unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", marca: "Daikin", modelo: "FTX" };
const TEC_BASE = { nome: "Novo Colaborador", cpf: "390.533.447-05", telefone: "31 99999-0000" };

describe.skipIf(!URL_PG)("Leva 1 de segurança: fotos pelos bytes, anexos binários, Inter e limpeza (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "11.111.111/0001-11" } });
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João", cpf: "111.111.111-11", telefone: "31 98888-0000" } });
    await prisma.usuario.create({ data: { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x", role: "ADMIN" } });
  }, 240_000);

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  // ───────────────────────── Fotos: gravação validada pelos bytes ─────────────────────────

  it("foto de equipamento: HTML disfarçado de image/png é recusado; PNG real entra NORMALIZADO e sai com o tipo real + nosniff", async () => {
    comoAdmin();
    const ruim = await chamar("equipamentos", "POST", {}, { ...EQ_BASE, fotos: [HTML_DISFARCADO] });
    expect(ruim.status).toBe(400);
    expect(ruim.json.erro).toContain("Foto 1");

    const ok = await chamar("equipamentos", "POST", {}, { ...EQ_BASE, fotos: [FOTO_PNG] });
    expect(ok.status).toBe(201);
    const eq = await prisma.equipamento.findUnique({ where: { id: ok.json.id } });
    expect(eq.fotos[0].startsWith("data:image/png;base64,")).toBe(true);

    const foto = await chamar("equipamentos/[id]/foto", "GET", { id: ok.json.id });
    expect(foto.status).toBe(200);
    expect(foto.tipo).toContain("image/png");
    expect(foto.headers.get("x-content-type-options")).toBe("nosniff");
    expect(foto.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("valor antigo malicioso no banco (HTML, URL externa) NUNCA é servido nem vira redirect: 404", async () => {
    comoAdmin();
    const eq = await prisma.equipamento.create({ data: {
      empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", marca: "X", modelo: "Y",
      fotos: [dataUrl("text/html", HTML), "https://evil.example/rouba-sessao"],
    } });
    const f0 = await chamar("equipamentos/[id]/foto", "GET", { id: eq.id });
    expect(f0.status).toBe(404);
    const f1 = await chamar("equipamentos/[id]/foto", "GET", { id: eq.id }, undefined, "?i=1");
    expect(f1.status).toBe(404);
    expect(f1.res.headers.get("location")).toBeNull(); // sem redirect aberto
  });

  it("veículo: SVG com script disfarçado de image/jpeg é recusado na criação; documento HTML também", async () => {
    comoAdmin();
    const r = await chamar("veiculos", "POST", {}, { placa: "ABC1D23", modelo: "Fiorino", fotos: [SVG_DISFARCADO], fotosRotulos: ["FRENTE"] });
    expect(r.status).toBe(400);
    const r2 = await chamar("veiculos", "POST", {}, {
      placa: "ABC1D23", modelo: "Fiorino",
      documentos: [{ tipo: "CRLV", nome: "crlv.pdf", arquivoUrl: dataUrl("application/pdf", HTML) }],
    });
    expect(r2.status).toBe(400);
    expect(r2.json.erro).toContain("crlv.pdf");
    const ok = await chamar("veiculos", "POST", {}, {
      placa: "ABC1D23", modelo: "Fiorino", fotos: [FOTO_JPEG], fotosRotulos: ["FRENTE"],
      documentos: [{ tipo: "CRLV", nome: "crlv.pdf", arquivoUrl: dataUrl("application/pdf", PDF) }],
    });
    expect(ok.status).toBe(201);
    const foto = await chamar("veiculos/[id]/foto", "GET", { id: ok.json.id });
    expect(foto.tipo).toContain("image/jpeg");
    expect(foto.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("avatar do colaborador: recusado quando não é imagem de verdade; plantado no banco não é servido", async () => {
    comoAdmin();
    const r = await chamar("tecnicos", "POST", {}, { ...TEC_BASE, avatar: HTML_DISFARCADO });
    expect(r.status).toBe(400);
    expect(r.json.erro).toContain("Foto do colaborador");

    await prisma.tecnico.update({ where: { id: "t1" }, data: { avatar: dataUrl("image/png", HTML) } });
    const av = await chamar("tecnicos/[id]/avatar", "GET", { id: "t1" });
    expect(av.status).toBe(404); // bytes não são imagem → não serve

    await prisma.tecnico.update({ where: { id: "t1" }, data: { avatar: FOTO_JPEG } });
    const ok = await chamar("tecnicos/[id]/avatar", "GET", { id: "t1" });
    expect(ok.status).toBe(200);
    expect(ok.tipo).toContain("image/jpeg");
  });

  it("avatar do próprio usuário (perfil): bytes conferidos e data URL normalizado", async () => {
    comoAdmin();
    const ruim = await chamar("perfil/avatar", "POST", {}, { imagem: HTML_DISFARCADO });
    expect(ruim.status).toBe(400);
    const ok = await chamar("perfil/avatar", "POST", {}, { imagem: dataUrl("application/octet-stream", PNG) });
    expect(ok.status).toBe(200);
    expect(ok.json.avatar.startsWith("data:image/png;base64,")).toBe(true); // MIME real, não o declarado
  });

  it("logo (empresa e cliente): SVG é recusado pelos bytes; PNG entra normalizado", async () => {
    comoAdmin();
    const formSvg = new FormData();
    formSvg.append("logo", new File([SVG], "logo.svg", { type: "image/svg+xml" }));
    expect((await chamarForm("empresa/logo", "PUT", {}, formSvg)).status).toBe(400);

    const formPng = new FormData();
    formPng.append("logo", new File([PNG], "logo.png", { type: "application/octet-stream" }));
    const ok = await chamarForm("empresa/logo", "PUT", {}, formPng);
    expect(ok.status).toBe(200);
    expect(ok.json.logo.startsWith("data:image/png;base64,")).toBe(true);

    const formCli = new FormData();
    formCli.append("logo", new File([SVG], "logo.svg", { type: "image/png" })); // prefixo mente
    expect((await chamarForm("clientes/[id]/logo", "PUT", { id: "c1" }, formCli)).status).toBe(400);
  });

  // ───────────────────────── Anexos de cliente e contrato: binário seguro ─────────────────────────

  it("anexo de cliente sai como binário (tipo pelos bytes + nosniff); HTML antigo vira download inofensivo", async () => {
    comoAdmin();
    const bom = await prisma.anexoCliente.create({ data: {
      empresaId: "e1", clienteId: "c1", nome: "laudo.pdf", tipo: "application/pdf",
      tamanho: PDF.length, conteudo: dataUrl("application/pdf", PDF),
    } });
    const r = await chamar("clientes/[id]/anexos/[anexoId]", "GET", { id: "c1", anexoId: bom.id }, undefined, "?inline=1");
    expect(r.status).toBe(200);
    expect(r.tipo).toContain("application/pdf");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-disposition")).toContain("inline");

    // Registro antigo malicioso: prefixo diz "image/png", bytes são HTML com script
    const mau = await prisma.anexoCliente.create({ data: {
      empresaId: "e1", clienteId: "c1", nome: "foto.png", tipo: "image/png",
      tamanho: HTML.length, conteudo: dataUrl("image/png", HTML),
    } });
    const r2 = await chamar("clientes/[id]/anexos/[anexoId]", "GET", { id: "c1", anexoId: mau.id }, undefined, "?inline=1");
    expect(r2.status).toBe(200);
    expect(r2.tipo).toContain("application/octet-stream"); // nunca text/html
    expect(r2.headers.get("content-disposition")).toContain("attachment");
    expect(r2.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("anexo de contrato idem — e a resposta é o arquivo, não JSON com base64", async () => {
    comoAdmin();
    const contrato = await prisma.contrato.create({ data: {
      id: "ct1", empresaId: "e1", clienteId: "c1", numero: "CT-2026-001", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: new Date(),
    } });
    const anexo = await prisma.anexoContrato.create({ data: {
      empresaId: "e1", contratoId: contrato.id, nome: "contrato.pdf", tipo: "application/pdf",
      tamanho: PDF.length, conteudo: dataUrl("application/pdf", PDF), categoria: "ANEXO",
    } });
    const r = await chamar("contratos/[id]/anexos/[anexoId]", "GET", { id: contrato.id, anexoId: anexo.id });
    expect(r.status).toBe(200);
    expect(r.tipo).toContain("application/pdf");
    expect(r.json).toBeNull(); // binário, não JSON
    expect(r.headers.get("content-disposition")).toContain("attachment"); // sem ?inline=1 baixa
  });

  // ───────────────────────── Inter: segredo e confirmação ─────────────────────────

  it("GET da integração nunca devolve o webhookSecret; a URL aparece UMA vez ao gerar e o segredo gira", async () => {
    comoAdmin();
    const antes = await chamar("integracoes/inter", "GET", {});
    expect(JSON.stringify(antes.json)).not.toContain("webhookSecret");
    expect(antes.json.temWebhookSecret).toBe(false);

    const gera = await chamar("integracoes/inter", "PUT", {}, { regerarWebhook: true });
    expect(gera.status).toBe(200);
    expect(gera.json.webhookUrl).toMatch(/\/api\/webhooks\/inter\?token=[0-9a-f]{64}$/);
    const secret1 = gera.json.webhookUrl.split("token=")[1];

    const depois = await chamar("integracoes/inter", "GET", {});
    expect(depois.json.temWebhookSecret).toBe(true);
    expect(JSON.stringify(depois.json)).not.toContain(secret1);

    // Salvar a configuração SEM pedir regeração não gira nem expõe o segredo
    const salva = await chamar("integracoes/inter", "PUT", {}, { ativo: false });
    expect(salva.json.webhookUrl).toBeUndefined();
    const reg = await prisma.integracaoInter.findUnique({ where: { empresaId: "e1" } });
    expect(reg.webhookSecret).toBe(secret1);

    // Regerar de novo revoga o anterior
    const gera2 = await chamar("integracoes/inter", "PUT", {}, { regerarWebhook: true });
    const secret2 = gera2.json.webhookUrl.split("token=")[1];
    expect(secret2).not.toBe(secret1);
  });

  it("webhook: corpo forjado NÃO baixa nada — a baixa só acontece com a situação CONFIRMADA no Inter", async () => {
    comoAdmin();
    const reg = await prisma.integracaoInter.findUnique({ where: { empresaId: "e1" } });
    const conta = await prisma.contaReceber.create({ data: {
      empresaId: "e1", clienteId: "c1", numero: "CR-2026-0001", descricao: "Mensalidade",
      valor: 1200, dataVencimento: new Date(), status: "A_RECEBER", boletoId: "cod-solic-1", boletoStatus: "EMITIDO",
    } });
    const corpo = [{ codigoSolicitacao: "cod-solic-1", situacao: "PAGO" }];

    // token errado → 401
    expect((await chamar("webhooks/inter", "POST", {}, corpo, "?token=errado")).status).toBe(401);

    // Inter diz que a cobrança está EM ABERTO → o aviso forjado é ignorado
    inter.consultar.mockResolvedValueOnce({ cobranca: { situacao: "A_RECEBER" } });
    const forjado = await chamar("webhooks/inter", "POST", {}, corpo, `?token=${reg.webhookSecret}`);
    expect(forjado.json.processados).toBe(0);
    expect((await prisma.contaReceber.findUnique({ where: { id: conta.id } })).status).toBe("A_RECEBER");

    // Inter fora do ar (consulta falha) → também não baixa
    inter.consultar.mockRejectedValueOnce(new Error("timeout"));
    expect((await chamar("webhooks/inter", "POST", {}, corpo, `?token=${reg.webhookSecret}`)).json.processados).toBe(0);

    // Inter CONFIRMA o pagamento → baixa
    inter.consultar.mockResolvedValueOnce({ cobranca: { situacao: "RECEBIDO" } });
    const ok = await chamar("webhooks/inter", "POST", {}, corpo, `?token=${reg.webhookSecret}`);
    expect(ok.json.processados).toBe(1);
    expect((await prisma.contaReceber.findUnique({ where: { id: conta.id } })).status).toBe("RECEBIDO");
  });

  it("webhook nunca mexe em conta CANCELADA (mesmo com o Inter confirmando) e exige o código da cobrança", async () => {
    const reg = await prisma.integracaoInter.findUnique({ where: { empresaId: "e1" } });
    const cancelada = await prisma.contaReceber.create({ data: {
      empresaId: "e1", clienteId: "c1", numero: "CR-2026-0002", descricao: "Cancelada",
      valor: 50, dataVencimento: new Date(), status: "CANCELADO", boletoId: "cod-solic-2",
    } });
    inter.consultar.mockResolvedValue({ cobranca: { situacao: "RECEBIDO" } });
    const r = await chamar("webhooks/inter", "POST", {}, [{ codigoSolicitacao: "cod-solic-2", situacao: "PAGO" }], `?token=${reg.webhookSecret}`);
    expect(r.json.processados).toBe(0);
    expect((await prisma.contaReceber.findUnique({ where: { id: cancelada.id } })).status).toBe("CANCELADO");

    // Conta sem boletoId (não emitida pela integração): não há como confirmar → não baixa
    const semCodigo = await prisma.contaReceber.create({ data: {
      empresaId: "e1", clienteId: "c1", numero: "CR-2026-0003", descricao: "Sem código",
      valor: 70, dataVencimento: new Date(), status: "A_RECEBER", boletoNossoNumero: "NN-123",
    } });
    const r2 = await chamar("webhooks/inter", "POST", {}, [{ nossoNumero: "NN-123", situacao: "PAGO" }], `?token=${reg.webhookSecret}`);
    expect(r2.json.processados).toBe(0);
    expect((await prisma.contaReceber.findUnique({ where: { id: semCodigo.id } })).status).toBe("A_RECEBER");
    inter.consultar.mockReset();
  });

  // ───────────────────────── RBAC das mudanças ─────────────────────────

  it("técnico não lê a configuração do Inter nem gera webhook; logo exige gerenciar", async () => {
    comoTecnico();
    expect((await chamar("integracoes/inter", "GET", {})).status).toBe(403);
    expect((await chamar("integracoes/inter", "PUT", {}, { regerarWebhook: true })).status).toBe(403);
    const form = new FormData();
    form.append("logo", new File([PNG], "logo.png", { type: "image/png" }));
    expect((await chamarForm("empresa/logo", "PUT", {}, form)).status).toBe(403);
  });

  // ───────────────────────── SQL de limpeza 🔵 ─────────────────────────

  it("SQL de limpeza: tira fotos que não são imagem (mantendo os pares foto×rótulo), zera avatares ruins e senha_provisoria; rodar 2× não muda nada", async () => {
    comoAdmin();
    const eqSujo = await prisma.equipamento.create({ data: {
      empresaId: "e1", unidadeId: "un1", tipo: "VRF", marca: "M", modelo: "Z",
      fotos: [FOTO_PNG, dataUrl("text/html", HTML), "https://evil.example/x", FOTO_JPEG],
    } });
    const veicSujo = await prisma.veiculo.create({ data: {
      empresaId: "e1", placa: "SUJ0A00", modelo: "Kombi",
      fotos: [SVG_DISFARCADO.replace("data:image/jpeg", "data:image/svg+xml"), FOTO_PNG],
      fotosRotulos: ["FRENTE", "TRASEIRA"],
    } });
    await prisma.tecnico.update({ where: { id: "t1" }, data: { avatar: "https://evil.example/a" } });
    await prisma.usuario.update({ where: { id: "uA" }, data: { avatar: dataUrl("text/html", HTML) } });
    const contato = await prisma.contatoCliente.create({ data: {
      empresaId: "e1", clienteId: "c1", nome: "Contato", email: "ct@x.com", senhaProvisoria: "segredo-em-texto",
    } });

    const rodar = () => execFileSync("psql", [URL_PG!, "-v", "ON_ERROR_STOP=1", "-q",
      "-f", path.join(RAIZ, "prisma/sql/2026-10-22_limpeza_fotos_senha.sql")], {
      env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, stdio: "pipe",
    });
    rodar();

    const eq = await prisma.equipamento.findUnique({ where: { id: eqSujo.id } });
    expect(eq.fotos).toEqual([FOTO_PNG, FOTO_JPEG]); // só as imagens, na ordem
    const veic = await prisma.veiculo.findUnique({ where: { id: veicSujo.id } });
    expect(veic.fotos).toEqual([FOTO_PNG]);
    expect(veic.fotosRotulos).toEqual(["TRASEIRA"]); // o rótulo acompanhou a foto que ficou
    expect((await prisma.tecnico.findUnique({ where: { id: "t1" } })).avatar).toBeNull();
    expect((await prisma.usuario.findUnique({ where: { id: "uA" } })).avatar).toBeNull();
    expect((await prisma.contatoCliente.findUnique({ where: { id: contato.id } })).senhaProvisoria).toBeNull();

    rodar(); // idempotente
    const eq2 = await prisma.equipamento.findUnique({ where: { id: eqSujo.id } });
    expect(eq2.fotos).toEqual([FOTO_PNG, FOTO_JPEG]);
    const veic2 = await prisma.veiculo.findUnique({ where: { id: veicSujo.id } });
    expect(veic2.fotosRotulos).toEqual(["TRASEIRA"]);
  });

  // ───────────────────────── Cabeçalhos globais ─────────────────────────

  it("next.config define os cabeçalhos de segurança para todas as rotas", async () => {
    const config: any = (await import("../../next.config")).default;
    const grupos = await config.headers();
    const todas = grupos.find((g: any) => g.source === "/:path*");
    expect(todas).toBeTruthy();
    const mapa = Object.fromEntries(todas.headers.map((h: any) => [h.key, h.value]));
    expect(mapa["X-Content-Type-Options"]).toBe("nosniff");
    expect(mapa["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(mapa["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
    expect(mapa["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });
});
