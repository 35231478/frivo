/**
 * Proposta corporativa (parte 1) — rotas reais com o Prisma real num PostgreSQL real:
 *  - numeração: maior número do ano por empresa (nunca total+1 nem ordem de texto); leads também;
 *  - padrões de Configurações (validade, garantias, não incluso, normas) e RT padrão da empresa:
 *    o orçamento novo nasce com eles; campo enviado vence; edição mantém o que não veio;
 *  - destinatário (unidade e contato A/C) só do cliente do orçamento; rota de opções por orçamentos;
 *  - anexos: upload (tipo pelos bytes), fotos copiadas SÓ das OS vinculadas, só em rascunho,
 *    RBAC e empresa da sessão, link público pelo token;
 *  - documento (impressão pública): timbre, Nº formal, "Para:", condições com garantias, não
 *    incluso, RT/ART, normas, fotos e anexos; ISS embutido; orçamento antigo sem nenhum bloco novo.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/proposta-corporativa-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { chaveHojeBR } from "@/lib/fuso";
import { validadePadrao } from "@/lib/orcamentos/calculo";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_proposta_corp_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", id = "u1") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes } };
};

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null), res };
}
async function enviarArquivo(orcId: string, nome: string, bytes: Uint8Array, tipo: string) {
  const mod = await import("@/app/api/orcamentos/[id]/anexos/route");
  const fd = new FormData();
  fd.append("arquivo", new File([Buffer.from(bytes)], nome, { type: tipo }));
  const res = await mod.POST(new NextRequest("http://localhost/api/x", { method: "POST", body: fd }), { params: Promise.resolve({ id: orcId }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function baixarPublico(token: string, anexoId: string) {
  const mod = await import("@/app/api/publico/orcamentos/[token]/anexos/[anexoId]/route");
  return mod.GET(new NextRequest("http://localhost/x?inline=1"), { params: Promise.resolve({ token, anexoId }) });
}
const texto = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");

const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));
const PNG_URL = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const ANO = Number(chaveHojeBR().slice(0, 4));
const ITEM = { descricao: "Limpeza de split", quantidade: 1, valorUnitario: 400 };

describe.skipIf(!URL_PG)("Proposta corporativa: numeração, padrões, destinatário, anexos e documento (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([
      "orcamentos", "orcamentos/[id]", "orcamentos/form-dados", "orcamentos/destinatario", "orcamentos/[id]/anexos",
      "orcamentos/[id]/anexos/[anexoId]", "orcamentos/[id]/anexos/fotos-os", "publico/orcamentos/[token]/anexos/[anexoId]", "empresa", "configuracoes",
    ].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total Refrigeração Ltda", nomeFantasia: "Clima Total", cnpj: "12345678000190", email: "contato@ct.com.br", telefone: "1133334444", endereco: "Av. Paulista", numero: "1000", cidade: "São Paulo", estado: "SP" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" },
      { id: "u2", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "rt1", empresaId: "e1", nome: "Eng. Roberto Mendes", cpf: "1", telefone: "1", tipo: "RESPONSAVEL_TECNICO", crea: "5012345-D/SP" },
      { id: "tc1", empresaId: "e1", nome: "Técnico de campo", cpf: "2", telefone: "2" },
      { id: "rt2", empresaId: "e2", nome: "RT da outra", cpf: "3", telefone: "3", tipo: "RESPONSAVEL_TECNICO" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Clara S/A", nomeFantasia: "Hospital Santa Clara", cpfCnpj: "22101333000111", inscricaoEstadual: "ISENTO", cidade: "Belo Horizonte", estado: "MG" },
      { id: "c2", empresaId: "e1", nome: "Padaria", cpfCnpj: "22333444000190" },
      { id: "c9", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "33444555000100" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz", logradouro: "Av. Afonso Pena", numero: "2300", cidade: "Belo Horizonte", estado: "MG" },
      { id: "un2", empresaId: "e1", clienteId: "c2", nome: "Loja" },
    ] });
    await prisma.contatoCliente.createMany({ data: [
      { id: "ct1", empresaId: "e1", clienteId: "c1", nome: "Juliana Ramos", cargo: "Compras", email: "compras@hsc.com.br", principal: true },
      { id: "ct2", empresaId: "e1", clienteId: "c2", nome: "Dono da padaria" },
    ] });
    await prisma.equipamento.create({ data: { id: "eq1", empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", marca: "Samsung", modelo: "WindFree 18k" } });
    await prisma.tipoOs.create({ data: { id: "t1", empresaId: "e1", nome: "Manutenção Corretiva" } });
    await prisma.ordemServico.createMany({ data: [
      { id: "os1", empresaId: "e1", numero: "OS-2026-0001", clienteId: "c1", unidadeId: "un1", criadoPorId: "u1", descricao: "Não gela" },
      { id: "os2", empresaId: "e1", numero: "OS-2026-0002", clienteId: "c1", criadoPorId: "u1", descricao: "Outra OS (não vinculada)" },
    ] });
    await prisma.atividadeOs.create({ data: { id: "a1", empresaId: "e1", ordemServicoId: "os1", tipoOsId: "t1", titulo: "Visita" } });
    await prisma.fotoAtendimento.create({ data: { id: "fa1", empresaId: "e1", atividadeId: "a1", equipamentoId: "eq1", url: PNG_URL, momento: "ANTES" } });
    await prisma.osAnexo.createMany({ data: [
      { id: "oa1", ordemServicoId: "os1", nome: "foto.png", tipo: "image/png", tamanho: PNG.length, conteudo: PNG_URL, legenda: "Condensadora", equipamentoId: "eq1" },
      { id: "oa2", ordemServicoId: "os2", nome: "outra.png", tipo: "image/png", tamanho: PNG.length, conteudo: PNG_URL, legenda: "De outra OS" },
    ] });
    logar();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const criarDireto = (empresaId: string, codigo: string, extra: Record<string, unknown> = {}) => prisma.orcamento.create({ data: {
    empresaId, codigo, nome: codigo, clienteId: empresaId === "e1" ? "c1" : "c9", criadoPorId: empresaId === "e1" ? "u1" : "u2",
    tokenPublico: `tok-${codigo}`, ...extra,
  } });

  it("numeração: maior número do ano (não a ordem de texto do código), por empresa; excluir não faz reusar", async () => {
    await criarDireto("e1", `ORC-${ANO}-0003`);
    await criarDireto("e1", `ORC-${ANO}-9999`);
    await criarDireto("e1", `ORC-${ANO - 1}-20000`); // ano passado não conta (mesmo maior)
    let r = await chamar("orcamentos", "POST", { clienteId: "c2", servicos: [ITEM], produtos: [] });
    expect(r.status).toBe(201);
    expect(r.json.codigo).toBe(`ORC-${ANO}-10000`);
    r = await chamar("orcamentos", "POST", { clienteId: "c2", servicos: [ITEM], produtos: [] });
    expect(r.json.codigo).toBe(`ORC-${ANO}-10001`);
    // Outra empresa começa do 1
    logar(permissoesTotais(), "e2", "u2");
    r = await chamar("orcamentos", "POST", { clienteId: "c9", servicos: [ITEM], produtos: [] });
    expect(r.json.codigo).toBe(`ORC-${ANO}-0001`);
    logar();
    // Excluir o do meio (o maior continua) não faz o número voltar
    await prisma.orcamento.delete({ where: { codigo_empresaId: { codigo: `ORC-${ANO}-9999`, empresaId: "e1" } } });
    r = await chamar("orcamentos", "POST", { clienteId: "c2", servicos: [ITEM], produtos: [] });
    expect(r.json.codigo).toBe(`ORC-${ANO}-10002`);
  });

  it("Configurações › Orçamentos: salva os padrões normalizados; validade fora de 1–365 recusada; sem gerenciar = 403", async () => {
    let r = await chamar("configuracoes", "PUT", {
      orcamentoValidadeDias: "15", orcamentoGarantiaServico: " 120 dias ", orcamentoGarantiaPecas: "",
      orcamentoNaoIncluso: "- Obra civil\n\nobra civil\nAndaimes", orcamentoNormas: ["PMOC", "XPTO", "NBR_16401"],
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ orcamentoValidadeDias: 15, orcamentoGarantiaServico: "120 dias", orcamentoGarantiaPecas: null, orcamentoNaoIncluso: "Obra civil\nAndaimes", orcamentoNormas: ["NBR_16401", "PMOC"] });
    r = await chamar("configuracoes", "PUT", { orcamentoValidadeDias: 0 });
    expect([r.status, r.json.erro]).toEqual([400, "A validade vai de 1 a 365 dias"]);
    logar(montarPermissoes({ configuracoes: ["visualizar"], orcamentos: ["visualizar", "criar", "editar"] }));
    expect((await chamar("configuracoes", "PUT", { orcamentoValidadeDias: 30 })).status).toBe(403);
    logar();
    // Outra empresa mantém os padrões de fábrica
    const cfg2 = await prisma.configuracao.create({ data: { empresaId: "e2" } });
    expect([cfg2.orcamentoValidadeDias, cfg2.orcamentoGarantiaServico, cfg2.orcamentoGarantiaPecas, cfg2.orcamentoNormas]).toEqual([10, "90 dias", "Conforme garantia do fabricante", []]);
  });

  it("empresa: IE/IM e RT padrão (só responsável técnico ativo DESTA empresa)", async () => {
    let r = await chamar("empresa", "PUT", { inscricaoEstadual: " 123.456.789.110 ", inscricaoMunicipal: "", responsavelTecnicoId: "rt1" });
    expect(r.status).toBe(200);
    expect((await chamar("empresa", "GET")).json).toMatchObject({ inscricaoEstadual: "123.456.789.110", inscricaoMunicipal: null, responsavelTecnicoId: "rt1" });
    r = await chamar("empresa", "PUT", { responsavelTecnicoId: "rt2" }); // de outra empresa
    expect(r.status).toBe(400);
    r = await chamar("empresa", "PUT", { responsavelTecnicoId: "tc1" }); // técnico de campo
    expect(r.status).toBe(400);
    expect((await chamar("empresa", "GET")).json.responsavelTecnicoId).toBe("rt1");
  });

  let orcId = "";
  let token = "";
  it("orçamento novo sem os campos: nasce com os padrões, o RT padrão, a unidade da OS e o contato principal", async () => {
    const r = await chamar("orcamentos", "POST", { clienteId: "c1", ordensServicoIds: ["os1"], servicos: [ITEM], produtos: [] });
    expect(r.status).toBe(201);
    orcId = r.json.id; token = r.json.tokenPublico;
    expect(r.json).toMatchObject({
      garantiaServico: "120 dias", garantiaPecas: null, naoIncluso: "Obra civil\nAndaimes", normas: ["NBR_16401", "PMOC"],
      responsavelTecnicoId: "rt1", unidadeId: "un1", contatoClienteId: "ct1",
    });
    expect(new Date(r.json.validadeEm).toISOString().slice(0, 10)).toBe(validadePadrao(chaveHojeBR(), 15));
    // A tela recebe os mesmos padrões e o mesmo destinatário sugerido
    const f = await chamar("orcamentos/form-dados", "GET", undefined, {}, "?osId=os1");
    expect(f.json.padroes).toMatchObject({ validadeDias: 15, garantiaServico: "120 dias", normas: ["NBR_16401", "PMOC"], responsavelTecnicoId: "rt1" });
    expect(f.json.destinatarioInicial).toEqual({ unidadeId: "un1", contatoClienteId: "ct1" });
  });

  it("RT padrão que deixou de valer (inativo ou não é mais RT) não entra no orçamento novo", async () => {
    await prisma.tecnico.update({ where: { id: "rt1" }, data: { ativo: false } });
    let r = await chamar("orcamentos", "POST", { clienteId: "c1", servicos: [ITEM], produtos: [] });
    expect(r.json.responsavelTecnicoId).toBeNull();
    await prisma.tecnico.update({ where: { id: "rt1" }, data: { ativo: true, tipo: "TECNICO_CAMPO" } });
    r = await chamar("orcamentos", "POST", { clienteId: "c1", servicos: [ITEM], produtos: [] });
    expect(r.json.responsavelTecnicoId).toBeNull();
    await prisma.tecnico.update({ where: { id: "rt1" }, data: { tipo: "RESPONSAVEL_TECNICO" } });
  });

  it("o que vem no corpo vence o padrão (inclusive vazio = apagado)", async () => {
    const r = await chamar("orcamentos", "POST", {
      clienteId: "c1", servicos: [ITEM], produtos: [], validadeEm: null, garantiaServico: " 6 meses ", garantiaPecas: "", naoIncluso: null, normas: [],
      responsavelTecnicoId: null, unidadeId: null, contatoClienteId: null,
    });
    expect(r.json).toMatchObject({ validadeEm: null, garantiaServico: "6 meses", garantiaPecas: null, naoIncluso: null, normas: [], responsavelTecnicoId: null, unidadeId: null, contatoClienteId: null });
  });

  it("destinatário só do cliente do orçamento; opções pela permissão de orçamentos; outra empresa não vê", async () => {
    expect((await chamar("orcamentos", "POST", { clienteId: "c1", servicos: [ITEM], produtos: [], unidadeId: "un2" })).status).toBe(400);
    expect((await chamar("orcamentos", "POST", { clienteId: "c1", servicos: [ITEM], produtos: [], contatoClienteId: "ct2" })).status).toBe(400);
    logar(montarPermissoes({ orcamentos: ["visualizar", "criar", "editar"] })); // sem acesso a Clientes
    const o = await chamar("orcamentos/destinatario", "GET", undefined, {}, "?clienteId=c1");
    expect(o.status).toBe(200);
    expect(o.json.unidades.map((u: any) => u.nome)).toEqual(["Matriz"]);
    expect(o.json.contatos.map((c: any) => [c.nome, c.cargo, c.principal])).toEqual([["Juliana Ramos", "Compras", true]]);
    expect(Object.keys(o.json.contatos[0]).sort()).toEqual(["cargo", "email", "id", "nome", "principal"]); // sem dados do portal
    logar(permissoesTotais(), "e2", "u2");
    expect((await chamar("orcamentos/destinatario", "GET", undefined, {}, "?clienteId=c1")).json).toEqual({ unidades: [], contatos: [] });
    logar(montarPermissoes({ clientes: ["visualizar"] }));
    expect((await chamar("orcamentos/destinatario", "GET", undefined, {}, "?clienteId=c1")).status).toBe(403);
    logar();
  });

  it("edição: o que não veio fica como estava; trocar de cliente solta unidade e contato", async () => {
    let r = await chamar("orcamentos/[id]", "PUT", { clienteId: "c1", ordensServicoIds: ["os1"], servicos: [ITEM], produtos: [], garantiaPecas: "12 meses" }, { id: orcId });
    expect(r.json).toMatchObject({ garantiaServico: "120 dias", garantiaPecas: "12 meses", naoIncluso: "Obra civil\nAndaimes", normas: ["NBR_16401", "PMOC"], unidadeId: "un1", contatoClienteId: "ct1" });
    const outro = await chamar("orcamentos", "POST", { clienteId: "c1", servicos: [ITEM], produtos: [] });
    r = await chamar("orcamentos/[id]", "PUT", { clienteId: "c2", servicos: [ITEM], produtos: [] }, { id: outro.json.id });
    expect([r.json.unidadeId, r.json.contatoClienteId]).toEqual([null, null]);
  });

  it("anexos: arquivo pelo conteúdo (PDF = ARQUIVO, PNG = FOTO, HTML disfarçado recusado)", async () => {
    let r = await enviarArquivo(orcId, "Datasheet WindFree.pdf", PDF, "application/pdf");
    expect([r.status, r.json.tipo, r.json.mime]).toEqual([201, "ARQUIVO", "application/pdf"]);
    r = await enviarArquivo(orcId, "foto.png", PNG, "image/png");
    expect([r.status, r.json.tipo]).toEqual([201, "FOTO"]);
    r = await enviarArquivo(orcId, "golpe.png", new TextEncoder().encode("<html><script>alert(1)</script></html>"), "image/png");
    expect(r.status).toBe(400);
  });

  it("fotos da OS: lista só das OS vinculadas; copia (congelada) com a legenda e a OS de origem; foto de OS não vinculada recusada", async () => {
    const g = await chamar("orcamentos/[id]/anexos/fotos-os", "GET", undefined, { id: orcId });
    expect(g.json.map((x: any) => x.os.numero)).toEqual(["OS-2026-0001"]);
    expect(g.json[0].fotos.map((f: any) => `${f.origem}:${f.id}`).sort()).toEqual(["ANEXO:oa1", "EXECUCAO:fa1"]);
    let r = await chamar("orcamentos/[id]/anexos/fotos-os", "POST", { fotos: [{ origem: "EXECUCAO", id: "fa1" }, { origem: "ANEXO", id: "oa1" }] }, { id: orcId });
    expect(r.status).toBe(201);
    expect(r.json.map((a: any) => [a.tipo, a.legenda, a.origem])).toEqual([["FOTO", "Antes do serviço", "OS-2026-0001"], ["FOTO", "Condensadora", "OS-2026-0001"]]);
    r = await chamar("orcamentos/[id]/anexos/fotos-os", "POST", { fotos: [{ origem: "ANEXO", id: "oa2" }] }, { id: orcId });
    expect(r.status).toBe(400);
    // A cópia fica: apagar a foto da OS não muda a proposta
    await prisma.osAnexo.delete({ where: { id: "oa1" } });
    expect(await prisma.orcamentoAnexo.count({ where: { orcamentoId: orcId, tipo: "FOTO" } })).toBe(3);
    const lista = await chamar("orcamentos/[id]/anexos", "GET", undefined, { id: orcId });
    expect(lista.json.map((a: any) => a.tipo)).toEqual(["FOTO", "FOTO", "FOTO", "ARQUIVO"]); // fotos primeiro
    expect(lista.json[0]).not.toHaveProperty("conteudo");
  });

  it("anexos: RBAC (ver ≠ editar), empresa da sessão, só em rascunho e no máximo 12", async () => {
    logar(montarPermissoes({ orcamentos: ["visualizar"] }));
    expect((await enviarArquivo(orcId, "x.pdf", PDF, "application/pdf")).status).toBe(403);
    expect((await chamar("orcamentos/[id]/anexos", "GET", undefined, { id: orcId })).status).toBe(200);
    logar(montarPermissoes({ orcamentos: ["visualizar", "editar"] })); // sem ver OS: não lista fotos da OS
    expect((await chamar("orcamentos/[id]/anexos/fotos-os", "GET", undefined, { id: orcId })).status).toBe(403);
    logar(permissoesTotais(), "e2", "u2");
    expect((await chamar("orcamentos/[id]/anexos", "GET", undefined, { id: orcId })).status).toBe(404);
    expect((await enviarArquivo(orcId, "x.pdf", PDF, "application/pdf")).status).toBe(404);
    logar();
    // Limite
    const extra = await chamar("orcamentos", "POST", { clienteId: "c1", servicos: [ITEM], produtos: [] });
    for (let i = 0; i < 12; i++) expect((await enviarArquivo(extra.json.id, `f${i}.pdf`, PDF, "application/pdf")).status).toBe(201);
    expect((await enviarArquivo(extra.json.id, "f13.pdf", PDF, "application/pdf")).json.erro).toBe("A proposta aceita até 12 anexos (fotos e arquivos).");
    // Enviado: não muda mais
    await prisma.orcamento.update({ where: { id: extra.json.id }, data: { status: "ENVIADO" } });
    const um = await prisma.orcamentoAnexo.findFirst({ where: { orcamentoId: extra.json.id } });
    expect((await chamar("orcamentos/[id]/anexos/[anexoId]", "DELETE", undefined, { id: extra.json.id, anexoId: um.id })).status).toBe(409);
    await prisma.orcamento.update({ where: { id: orcId }, data: { status: "ENVIADO" } });
    const bloqueado = await enviarArquivo(orcId, "x.pdf", PDF, "application/pdf");
    expect([bloqueado.status, bloqueado.json.erro]).toEqual([409, "Os anexos só mudam com o orçamento em rascunho (o documento enviado fica como foi enviado)."]);
    expect((await chamar("orcamentos/[id]/anexos/fotos-os", "POST", { fotos: [{ origem: "EXECUCAO", id: "fa1" }] }, { id: orcId })).status).toBe(409);
    await prisma.orcamento.update({ where: { id: orcId }, data: { status: "RASCUNHO" } });
    await prisma.orcamento.update({ where: { id: extra.json.id }, data: { status: "RASCUNHO" } });
    expect((await chamar("orcamentos/[id]/anexos/[anexoId]", "DELETE", undefined, { id: extra.json.id, anexoId: um.id })).status).toBe(200);
    // Anexo de um orçamento não sai pela rota de outro
    expect((await chamar("orcamentos/[id]/anexos/[anexoId]", "DELETE", undefined, { id: orcId, anexoId: (await prisma.orcamentoAnexo.findFirst({ where: { orcamentoId: extra.json.id } })).id })).status).toBe(404);
  });

  it("link público: serve o anexo do PRÓPRIO orçamento pelo token (bytes reais, nosniff); outro token ou cancelado = 404", async () => {
    const foto = await prisma.orcamentoAnexo.findFirst({ where: { orcamentoId: orcId, tipo: "FOTO" } });
    let res = await baixarPublico(token, foto.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(PNG))).toBe(true);
    res = await baixarPublico(`tok-ORC-${ANO}-0003`, foto.id);
    expect(res.status).toBe(404);
    await prisma.orcamento.update({ where: { id: orcId }, data: { status: "CANCELADO" } });
    expect((await baixarPublico(token, foto.id)).status).toBe(404);
    await prisma.orcamento.update({ where: { id: orcId }, data: { status: "RASCUNHO" } });
  });

  const imprimir = async (tk: string) => {
    const { default: P } = await import("@/app/(publico)/orcamento/[token]/imprimir/page");
    return renderToStaticMarkup(await P({ params: Promise.resolve({ token: tk }) }));
  };

  it("documento do cliente: timbre, Nº formal, Para: com A/C e unidade, condições com garantias, não incluso, RT/ART, normas, fotos e anexos", async () => {
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { issAliquota: 5 } });
    await chamar("orcamentos/[id]", "PUT", {
      clienteId: "c1", ordensServicoIds: ["os1"], servicos: [ITEM], produtos: [], atualizarIss: true, prazoExecucao: "5 dias úteis", formaPagamento: "PIX",
      observacao: "Cliente pediu desconto — não mostrar",
    }, { id: orcId });
    const o = await prisma.orcamento.findUnique({ where: { id: orcId } });
    const h = await imprimir(token);
    const t = texto(h);
    expect(t).toContain("Clima Total");
    expect(t).toContain("CNPJ 12.345.678/0001-90 · IE 123.456.789.110");
    expect(t).toContain(`Orçamento Nº ${o.codigo.replace("ORC-", "")}`);
    expect(t).toContain("Para Hospital Santa Clara S/A");
    expect(t).toContain("CNPJ 22.101.333/0001-11 · IE ISENTO");
    expect(t).toContain("A/C Juliana Ramos (Compras)");
    expect(t).toContain("Matriz — Av. Afonso Pena, 2300 — Belo Horizonte/MG");
    expect(t).toContain("Garantia dos serviços 120 dias");
    expect(t).toContain("Garantia das peças 12 meses");
    expect(t).toContain("Prazo de execução dos serviços 5 dias úteis");
    expect(h).toContain("data-nao-incluso-documento");
    expect(t).toContain("Não incluso Obra civil Andaimes");
    expect(t).toContain("Responsável técnico Eng. Roberto Mendes CREA 5012345-D/SP ART emitida após aprovação");
    expect(t).toContain("ABNT NBR 16401");
    expect(t).toContain("PMOC — Lei nº 13.589/2018");
    expect(h).not.toContain('data-norma-documento="NBR_13971"');
    expect((h.match(/data-foto-documento=/g) ?? []).length).toBe(3);
    expect(h).toContain(`/api/publico/orcamentos/${token}/anexos/`);
    expect(t).toContain("Anexos Datasheet WindFree.pdf");
    // ISS embutido (sem linha própria) e observação interna fora do documento do cliente
    expect(t).not.toMatch(/ISS/);
    expect(t).toContain("R$ 420,00");
    expect(t).not.toContain("Cliente pediu desconto");
    expect(h).not.toContain("tfoot");
  });

  it("ART preenchida aparece com o número; sem RT nem normas, o bloco some", async () => {
    await prisma.orcamento.update({ where: { id: orcId }, data: { artNumero: "2620261234567" } });
    expect(texto(await imprimir(token))).toContain("ART nº 2620261234567");
    await prisma.orcamento.update({ where: { id: orcId }, data: { responsavelTecnicoId: null, normas: [] } });
    const h = await imprimir(token);
    expect(h).not.toContain("data-rt-documento");
    expect(h).not.toContain("data-normas-documento");
  });

  it("orçamento antigo (sem nenhum campo novo) sai como antes: nenhum bloco novo, cliente pelo cadastro", async () => {
    const antigo = await criarDireto("e1", "ORC-2025-0001", {
      totalServicos: 100, totalProdutos: 0, totalGeral: 100,
      servicos: { create: [{ descricao: "Serviço antigo", quantidade: 1, valorUnitario: 100, valorTotal: 100, ordem: 0 }] },
    });
    const h = await imprimir(antigo.tokenPublico);
    for (const bloco of ["data-condicoes-documento", "data-nao-incluso-documento", "data-rt-documento", "data-normas-documento", "data-fotos-documento", "data-arquivos-documento", "data-para-ac"]) {
      expect(h, bloco).not.toContain(bloco);
    }
    const t = texto(h);
    expect(t).toContain("Orçamento Nº 2025-0001");
    expect(t).toContain("Serviço antigo");
    expect(t).toContain("R$ 100,00");
    expect(t).toContain("Belo Horizonte/MG"); // endereço do cadastro do cliente
  });
});
