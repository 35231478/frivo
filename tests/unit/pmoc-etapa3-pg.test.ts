/**
 * PMOC — Etapa 3 (documento, ART, alertas de vencimento e envio ao cliente): rotas reais com o Prisma
 * real num PostgreSQL real (schema descartável via `prisma db push`), relógio parado em 12/11/2026.
 *  - o documento em PDF: gerado no servidor a partir do cadastro, com o cronograma já substituído, o
 *    texto técnico da empresa e a ART anexada; só para quem vê o PMOC;
 *  - a ART: tipo decidido pelo conteúdo, até 3 MB, mudanças no histórico; a cópia do plano NÃO leva a ART;
 *  - o envio: WhatsApp (wa.me), e-mail (Resend ou o programa do usuário) e link; cada envio no histórico;
 *    o link público abre sem login e só enquanto o plano está publicado e ativo;
 *  - os avisos de vencimento: pela data e pela antecedência da empresa; registrados UMA vez (mesmo com
 *    várias consultas ao mesmo tempo); a ciência tira do sino; expirar e mudar a validade são avisos novos;
 *  - configuração por empresa, histórico e RBAC (visualizar × editar; sem o módulo e técnico do app: 403).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/pmoc-etapa3-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Acao, type Permissoes } from "@/lib/permissoes";
import { DESCRICAO_PADRAO_PMOC } from "@/lib/pmoc";
import { PNG, dataUrl, paginasDe, pdfDeTeste, textoDoPdf } from "./pmoc-pdf-util";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pmoc3_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
/** 12/11/2026, 12:00 em Brasília */
const AGORA = new Date("2026-11-12T15:00:00.000Z");
const dia = (iso: string) => new Date(`${iso}T00:00:00Z`);

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
// O sino registra os avisos DEPOIS de responder (after): aqui as tarefas ficam guardadas e o teste as roda
const depois = vi.hoisted(() => ({ tarefas: [] as (() => unknown)[] }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: (fn: () => unknown) => { depois.tarefas.push(fn); } }));
vi.mock("@/lib/nfse/webhook-server", async (orig) => ({ ...(await orig<object>()), reconciliarEmpresa: vi.fn(async () => {}) }));
// O e-mail da empresa (Resend) é trocado por um dublê: nada sai de verdade
const email = vi.hoisted(() => ({ ativa: false, enviar: null as any }));
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<object>()), emailConfigAtiva: vi.fn(async () => email.ativa), enviarEmail: (...a: unknown[]) => email.enviar(...a) }));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", extra: Record<string, unknown> = {}) => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, empresaNome: empresaId === "e1" ? "Clima Total" : "Outra Climatização", role: "OPERADOR", permissoes, tecnicoId: null, ...extra } };
};
const comPmoc = (acoes: Acao[], extra: Record<string, Acao[]> = {}) => como(montarPermissoes({ pmoc: acoes, ...extra }));
const semModulo = () => como(montarPermissoes({ ordens: ["visualizar", "criar", "editar", "excluir"], equipamentos: ["visualizar"] }));
const tecnicoDoApp = () => como(PRESETS.TECNICO, "e1", { role: "TECNICO", tecnicoId: "t1" });

const ROTAS = {
  plano: "api/pmocs/[id]", lista: "api/pmocs", copia: "api/pmocs/[id]/copia", art: "api/pmocs/[id]/art", documento: "api/pmocs/[id]/documento",
  enviar: "api/pmocs/[id]/enviar", aviso: "api/pmocs/[id]/aviso", historico: "api/pmocs/[id]/historico", config: "api/pmocs/configuracao",
  publico: "(publico)/relatorio/pmoc/[token]", alertas: "api/alertas",
} as const;
async function chamar(rota: keyof typeof ROTAS, metodo: string, op: { id?: string; token?: string; corpo?: unknown; query?: string } = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/${ROTAS[rota]}/route`);
  const req = new NextRequest(`https://app.exemplo.com/x${op.query ? `?${op.query}` : ""}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: op.corpo === undefined ? undefined : JSON.stringify(op.corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve({ id: op.id ?? "", token: op.token ?? "" }) });
  const tipo = res.headers.get("content-type") ?? "";
  return {
    status: res.status, tipo, headers: res.headers,
    json: tipo.includes("json") ? await res.json() : null,
    bytes: tipo.includes("pdf") ? new Uint8Array(await res.arrayBuffer()) : null,
    texto: tipo.includes("text/plain") ? await res.text() : null,
  };
}
const RT = { rtNome: "Eng. Paula Reis", rtCrea: "SP-5061234567", artNumero: "28027230241234567" };
const corpoPlano = (extra: Record<string, unknown> = {}) => ({ nome: "PMOC 2027 — Hospital", clienteId: "c1", unidadeId: "u1", dataInicio: "2026-11-12", dataExpiracao: "2027-11-11", status: "PUBLICADO", ...RT, ...extra });

describe.skipIf(!URL_PG)("PMOC — Etapa 3: documento, ART, alertas e envio (PostgreSQL real)", () => {
  let prisma: any;
  /** Plano publicado, com q1 e q2 e o cronograma em camadas: leve mensal + química semestral a partir de abril/2027 */
  const plano = async (extra: Record<string, unknown> = {}, empresaId = "e1") => {
    const e1 = empresaId === "e1";
    return (await prisma.pmoc.create({ data: {
      empresaId, clienteId: e1 ? "c1" : "cE2", unidadeId: e1 ? "u1" : "uE2", nome: e1 ? "PMOC 2027 — Hospital" : "PMOC da outra empresa", status: "PUBLICADO", ...RT,
      dataInicio: dia("2026-11-12"), dataExpiracao: dia("2027-11-11"),
      equipamentos: { create: (e1 ? ["q1", "q2"] : ["qE2"]).map((equipamentoId) => ({ equipamentoId })) },
      cronograma: { create: e1 ? [
        { tipoOsId: "toLeve", dataInicio: dia("2026-11-12"), intervaloMeses: 1, diaExecucao: 25, fimSemana: "POSTERGAR", criadoEm: new Date("2026-11-01T12:00:00Z") },
        { tipoOsId: "toQuimica", dataInicio: dia("2027-04-01"), intervaloMeses: 6, diaExecucao: 25, fimSemana: "POSTERGAR", criadoEm: new Date("2026-11-02T12:00:00Z") },
      ] : [] },
      ...extra,
    }, select: { id: true } })).id as string;
  };
  const historico = async (id: string) => (await prisma.pmocHistorico.findMany({ where: { pmocId: id }, orderBy: [{ criadoEm: "asc" }, { id: "asc" }] })).map((h: any) => [h.acao, h.detalhes, h.usuarioId]);
  const sino = async () => (await chamar("alertas", "GET")).json;
  /** Roda o que o sino deixou para depois de responder (o registro dos avisos) */
  const rodarDepois = async () => { const t = depois.tarefas.splice(0); await Promise.all(t.map((f) => f())); };
  const em = (iso: string) => vi.setSystemTime(new Date(`${iso}T15:00:00.000Z`));

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(Object.values(ROTAS).map((r) => import(/* @vite-ignore */ `@/app/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total Serviços Ltda", nomeFantasia: "Clima Total", cnpj: "12.345.678/0001-90", email: "contato@climatotal.com.br", telefone: "(11) 4000-1000", cidade: "São Paulo", estado: "SP" },
      { id: "e2", nome: "Outra Climatização", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara", cpfCnpj: "11222333000181", email: "adm@hospital.com.br", celular: "(11) 98888-0000" },
      { id: "cE2", empresaId: "e2", nome: "Cliente da outra empresa", cpfCnpj: "3" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "u1", empresaId: "e1", clienteId: "c1", nome: "Matriz", logradouro: "Rua das Flores", numero: "250", cidade: "São Paulo", estado: "SP" },
      { id: "uE2", empresaId: "e2", clienteId: "cE2", nome: "Sede" },
    ] });
    await prisma.tipoOs.createMany({ data: [
      { id: "toLeve", empresaId: "e1", nome: "Manutenção Preventiva" }, { id: "toQuimica", empresaId: "e1", nome: "Limpeza Química" },
    ] });
    await prisma.tipoEquipamentoCustom.createMany({ data: [
      { id: "teSplit", empresaId: "e1", nome: "Split", chaveEnum: "AR_CONDICIONADO_SPLIT" },
      { id: "teE2", empresaId: "e2", nome: "Split da outra empresa", chaveEnum: "AR_CONDICIONADO_SPLIT" },
    ] });
    const eq = (id: string, unidadeId: string, extra: Record<string, unknown> = {}) => ({ id, empresaId: unidadeId === "uE2" ? "e2" : "e1", unidadeId, tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "S4", tipoEquipamentoId: unidadeId === "uE2" ? "teE2" : "teSplit", ...extra });
    await prisma.equipamento.createMany({ data: [
      eq("q1", "u1", { patrimonio: "AC-001", nome: "Split da recepção", capacidade: "48000", setor: "Térreo", localizacao: "Recepção" }),
      eq("q2", "u1", { patrimonio: "AC-002", nome: "Split UTI 1", capacidade: "36000 BTU/h", setor: "2º andar", localizacao: "UTI 1" }),
      eq("qE2", "uE2", { patrimonio: "ZZ-900", nome: "Equipamento secreto da outra empresa" }),
    ] });
    await prisma.checklistTipoItem.createMany({ data: [
      { empresaId: "e1", tipoEquipamentoId: "teSplit", texto: "Limpar os filtros de ar", ordem: 1 },
      { empresaId: "e1", tipoEquipamentoId: "teSplit", texto: "Verificar o dreno de condensado", ordem: 2 },
      { empresaId: "e1", tipoEquipamentoId: "teSplit", texto: "Item que foi excluído do checklist", ordem: 3, ativo: false },
      { empresaId: "e2", tipoEquipamentoId: "teE2", texto: "Checklist secreto da outra empresa", ordem: 1 },
    ] });
  }, 180_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    await prisma.pmoc.deleteMany({});
    await prisma.pmocConfiguracao.deleteMany({});
    await prisma.contatoCliente.deleteMany({});
    depois.tarefas.length = 0;
    email.ativa = false;
    email.enviar = vi.fn(async () => ({ ok: true }));
    como();
  });

  /* ───────── documento ───────── */
  it("DOCUMENTO: PDF gerado no servidor com os dados reais do plano — e o cronograma já com a substituição e o fim de semana", async () => {
    const id = await plano();
    const r = await chamar("documento", "GET", { id });
    expect(r).toMatchObject({ status: 200, tipo: "application/pdf" });
    // o nome vai duas vezes: sem acento (para o navegador que não lê UTF-8) e completo
    expect(r.headers.get("content-disposition")).toBe(`attachment; filename="PMOC 2027 - Hospital.pdf"; filename*=UTF-8''${encodeURIComponent("PMOC 2027 — Hospital.pdf")}`);
    const { nomeAscii } = await import("@/lib/pmoc-documento-server");
    expect(nomeAscii('PMOC São "João" — 日本.pdf')).toBe("PMOC Sao _Joao_ - __.pdf");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(r.bytes!.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(r.bytes!.length).toBeLessThan(80_000);
    const texto = await textoDoPdf(r.bytes!);
    for (const t of [
      "PMOC 2027 — Hospital", "Vigente · 12/11/2026 a 11/11/2027", "Hospital Santa Clara (Hospital Santa Clara Ltda)", "11.222.333/0001-81", "Rua das Flores, 250 — São Paulo/SP",
      "Eng. Paula Reis", "SP-5061234567", "28027230241234567", "Clima Total", "CNPJ 12.345.678/0001-90",
      "AC-001", "Split da recepção", "48.000 BTU/h", "36.000 BTU/h", "Matriz · 2º andar · UTI 1",
      "Manutenção Preventiva", "Limpeza Química", "Postergar para segunda-feira", "26/04", "Limpar os filtros de ar", "Verificar o dreno de condensado",
    ]) expect(texto, t).toContain(t);
    for (const norma of ["13.589/2018", "3.523/GM/MS", "RE nº 09/2003", "NBR 13971", "NBR 16401"]) expect(texto, norma).toContain(norma);
    // O serviço que vale em cada mês: 10 meses da leve e 2 da química, por equipamento — nunca os dois no mesmo mês
    const vezes = (codigo: string) => texto.split("\n").filter((l) => l === codigo).length;
    expect([vezes("MP"), vezes("LQ")]).toEqual([20 + 2, 4 + 2]); // células + a linha do serviço + a legenda
    expect(texto).toContain("24 execuções previstas na vigência do plano.");
    expect(texto).not.toContain("25/04"); // 25/04/2027 é domingo: a data já vem ajustada (26/04)
    expect(texto).not.toContain("Item que foi excluído do checklist");
    expect(texto).not.toMatch(/secret[oa] da outra empresa|ZZ-900/);
    // ?inline=1 abre no navegador
    expect((await chamar("documento", "GET", { id, query: "inline=1" })).headers.get("content-disposition")).toMatch(/^inline;/);
  });

  it("DOCUMENTO: o texto técnico é o do plano; sem ele, o padrão da EMPRESA; sem ele, o do sistema", async () => {
    const id = await plano({ descricao: null });
    expect(await textoDoPdf((await chamar("documento", "GET", { id })).bytes!)).toContain("Lei Federal nº 13.589/2018");
    await prisma.pmocConfiguracao.create({ data: { empresaId: "e1", textoPadrao: "Texto técnico próprio da Clima Total, com a base legal revisada." } });
    await prisma.pmocConfiguracao.create({ data: { empresaId: "e2", textoPadrao: "Texto da OUTRA empresa." } });
    const daEmpresa = await textoDoPdf((await chamar("documento", "GET", { id })).bytes!);
    expect(daEmpresa).toContain("Texto técnico próprio da Clima Total, com a base legal revisada.");
    expect(daEmpresa).not.toContain("Texto da OUTRA empresa.");
    expect(daEmpresa).not.toContain("Lei Federal nº 13.589/2018");
    await prisma.pmoc.update({ where: { id }, data: { descricao: "Texto escrito só para este plano." } });
    const doPlano = await textoDoPdf((await chamar("documento", "GET", { id })).bytes!);
    expect(doPlano).toContain("Texto escrito só para este plano.");
    expect(doPlano).not.toContain("Texto técnico próprio da Clima Total");
  });

  it("DOCUMENTO — RBAC: quem vê o PMOC baixa (inclusive rascunho); sem o módulo e técnico do app: 403; sem sessão: 401; outra empresa: 404", async () => {
    const id = await plano({ status: "RASCUNHO" });
    comPmoc(["visualizar"]);
    const r = await chamar("documento", "GET", { id });
    expect(r.status).toBe(200);
    expect(await textoDoPdf(r.bytes!)).toContain("Rascunho · 12/11/2026 a 11/11/2027");
    semModulo();
    expect(await chamar("documento", "GET", { id })).toMatchObject({ status: 403, bytes: null });
    for (const preset of [PRESETS.FINANCEIRO, PRESETS.AUXILIAR]) { como(preset); expect((await chamar("documento", "GET", { id })).status).toBe(403); }
    tecnicoDoApp();
    expect((await chamar("documento", "GET", { id })).status).toBe(403);
    sessao.atual = null;
    expect((await chamar("documento", "GET", { id })).status).toBe(401);
    como(permissoesTotais(), "e2");
    expect(await chamar("documento", "GET", { id })).toMatchObject({ status: 404, json: { erro: "PMOC não encontrado" } });
    expect((await chamar("documento", "GET", { id: "nao-existe" })).status).toBe(404);
  });

  /* ───────── ART ───────── */
  it("ART: o arquivo entra no fim do documento; anexar, trocar e excluir ficam no histórico do plano", async () => {
    const id = await plano();
    const semArt = (await paginasDe((await chamar("documento", "GET", { id })).bytes!)).length;
    const art = dataUrl(await pdfDeTeste(2), "application/pdf");
    expect((await chamar("plano", "PUT", { id, corpo: corpoPlano({ artArquivo: art, artArquivoNome: "ART 2027.pdf" }) })).status).toBe(200);
    const comArt = await paginasDe((await chamar("documento", "GET", { id })).bytes!);
    expect(comArt).toHaveLength(semArt + 2);
    expect(comArt.slice(-2)).toEqual([[300, 400], [300, 400]]); // as páginas da ART, como são
    // trocar por uma imagem: vira UMA página do documento
    expect((await chamar("plano", "PUT", { id, corpo: corpoPlano({ artArquivo: dataUrl(PNG, "image/png"), artArquivoNome: "art.png" }) })).status).toBe(200);
    const comImagem = await chamar("documento", "GET", { id });
    expect(await paginasDe(comImagem.bytes!)).toHaveLength(semArt + 1);
    expect(await textoDoPdf(comImagem.bytes!)).toContain("Anexo — ART nº 28027230241234567");
    // excluir
    expect((await chamar("plano", "PUT", { id, corpo: corpoPlano({ removerArt: true }) })).status).toBe(200);
    expect(await paginasDe((await chamar("documento", "GET", { id })).bytes!)).toHaveLength(semArt);
    expect(await historico(id)).toEqual([
      ["Arquivo da ART anexado", "ART 2027.pdf", "uA"], ["Arquivo da ART trocado", "art.png", "uA"], ["Arquivo da ART excluído", "art.png", "uA"],
    ]);
    // salvar sem mexer na ART não escreve nada; excluir sem ter arquivo também não
    await chamar("plano", "PUT", { id, corpo: corpoPlano() });
    await chamar("plano", "PUT", { id, corpo: corpoPlano({ removerArt: true }) });
    expect(await historico(id)).toHaveLength(3);
  });

  it("ART: o tipo é decidido pelo CONTEÚDO (HTML disfarçado de PDF é recusado); até 3 MB; anexar exige 'PMOC › Editar'", async () => {
    const id = await plano();
    const html = `data:application/pdf;base64,${Buffer.from("<html><script>alert(1)</script></html>").toString("base64")}`;
    expect(await chamar("plano", "PUT", { id, corpo: corpoPlano({ artArquivo: html, artArquivoNome: "ART.pdf" }) })).toMatchObject({ status: 400, json: { erro: "A ART deve ser PDF, JPG ou PNG." } });
    // um PNG que diz ser PDF é gravado como o que É (imagem)
    expect((await chamar("plano", "PUT", { id, corpo: corpoPlano({ artArquivo: dataUrl(PNG, "application/pdf"), artArquivoNome: "ART.pdf" }) })).status).toBe(200);
    expect(await prisma.pmoc.findUnique({ where: { id }, select: { artArquivoTipo: true, artArquivoTamanho: true } })).toEqual({ artArquivoTipo: "image/png", artArquivoTamanho: PNG.length });
    const grande = new Uint8Array(3 * 1024 * 1024 + 10); grande.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-" e mais de 3 MB
    expect(await chamar("plano", "PUT", { id, corpo: corpoPlano({ artArquivo: dataUrl(grande, "application/pdf") }) })).toMatchObject({ status: 413, json: { erro: "Arquivo da ART acima de 3 MB." } });
    comPmoc(["visualizar"]);
    expect((await chamar("plano", "PUT", { id, corpo: corpoPlano({ artArquivo: dataUrl(PNG, "image/png") }) })).status).toBe(403);
    expect((await chamar("art", "GET", { id })).status).toBe(200); // quem vê o plano baixa a ART
    semModulo();
    expect((await chamar("art", "GET", { id })).status).toBe(403);
  });

  it("CRIAR CÓPIA: a ART NÃO vai junto (número e arquivo são de cada plano), nem o link público nem os avisos; a cópia nasce com o seu histórico", async () => {
    const id = await plano({ artArquivo: dataUrl(await pdfDeTeste(1), "application/pdf"), artArquivoNome: "ART.pdf", artArquivoTipo: "application/pdf", artArquivoTamanho: 900, tokenPublico: "token-do-plano-original-0123456789" });
    await prisma.pmocAviso.create({ data: { pmocId: id, tipo: "VENCENDO", dataExpiracao: dia("2027-11-11") } });
    const copia = await chamar("copia", "POST", { id });
    expect(copia.status).toBe(201);
    const c = await prisma.pmoc.findUnique({ where: { id: copia.json.id }, include: { avisos: true, equipamentos: true } });
    expect(c).toMatchObject({ status: "RASCUNHO", nome: "Cópia de PMOC 2027 — Hospital", rtNome: "Eng. Paula Reis", artNumero: null, artArquivo: null, artArquivoNome: null, tokenPublico: null, avisos: [] });
    expect(c.equipamentos).toHaveLength(2);
    expect(await historico(copia.json.id)).toEqual([["Plano criado como cópia", "De: PMOC 2027 — Hospital. A ART não é copiada.", "uA"]]);
    expect(await textoDoPdf((await chamar("documento", "GET", { id: copia.json.id })).bytes!)).toContain("Não informada"); // a ART do plano novo ainda não foi informada
  });

  /* ───────── envio e link público ───────── */
  it("ENVIAR POR WHATSAPP: link wa.me com a mensagem e o link público do documento; o envio fica no histórico; o link abre SEM login", async () => {
    await prisma.contatoCliente.create({ data: { empresaId: "e1", clienteId: "c1", nome: "Maria Lima", whatsapp: "(11) 97777-1234", email: "maria@hospital.com.br", principal: true } });
    const id = await plano();
    const r = await chamar("enviar", "POST", { id, corpo: { canal: "WHATSAPP" } });
    expect(r.status).toBe(200);
    const { tokenPublico } = await prisma.pmoc.findUnique({ where: { id }, select: { tokenPublico: true } });
    expect(tokenPublico).toMatch(/^[A-Za-z0-9_-]{32}$/); // 24 bytes aleatórios
    expect(r.json).toMatchObject({ canal: "WHATSAPP", publicUrl: `https://app.exemplo.com/relatorio/pmoc/${tokenPublico}`, para: "(11) 97777-1234", emailEnviado: false });
    const url = new URL(r.json.whatsappUrl);
    expect(`${url.origin}${url.pathname}`).toBe("https://wa.me/5511977771234"); // o WhatsApp do contato principal, com o DDI
    expect(url.searchParams.get("text")).toBe(`Prezado(a) Maria,\n\nSegue o documento do PMOC 2027 — Hospital (vigência: 12/11/2026 a 11/11/2027):\n${r.json.publicUrl}\n\nAtenciosamente,\nClima Total`);
    expect(await historico(id)).toEqual([["Documento enviado por WhatsApp", "Maria Lima · (11) 97777-1234", "uA"]]);

    // enviar de novo: o MESMO link (o token nasce uma vez); mais uma linha no histórico
    const de_novo = await chamar("enviar", "POST", { id, corpo: { canal: "WHATSAPP" } });
    expect(de_novo.json.publicUrl).toBe(r.json.publicUrl);
    expect(await historico(id)).toHaveLength(2);

    // o cliente abre o link sem sessão: o PDF do plano
    sessao.atual = null;
    const publico = await chamar("publico", "GET", { token: tokenPublico });
    expect(publico).toMatchObject({ status: 200, tipo: "application/pdf" });
    expect(publico.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(publico.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await textoDoPdf(publico.bytes!)).toContain("Hospital Santa Clara (Hospital Santa Clara Ltda)");
  });

  it("ENVIAR: sem contato principal vale o cadastro do cliente; sem telefone nenhum, o contato é escolhido no WhatsApp", async () => {
    const id = await plano();
    const doCliente = await chamar("enviar", "POST", { id, corpo: { canal: "WHATSAPP" } });
    expect(doCliente.json.whatsappUrl).toMatch(/^https:\/\/wa\.me\/5511988880000\?text=Prezados/);
    expect((await historico(id))[0]).toEqual(["Documento enviado por WhatsApp", "(11) 98888-0000", "uA"]);
    // contato inativo ou não principal não vale; o de outra empresa também não
    await prisma.contatoCliente.createMany({ data: [
      { empresaId: "e1", clienteId: "c1", nome: "Inativo", whatsapp: "(11) 91111-1111", principal: true, ativo: false },
      { empresaId: "e1", clienteId: "c1", nome: "Secundário", whatsapp: "(11) 92222-2222", principal: false },
    ] });
    expect((await chamar("enviar", "POST", { id, corpo: { canal: "WHATSAPP" } })).json.para).toBe("(11) 98888-0000");
    await prisma.cliente.update({ where: { id: "c1" }, data: { celular: null, telefone: null } });
    const semNumero = await chamar("enviar", "POST", { id, corpo: { canal: "WHATSAPP" } });
    expect(semNumero.json).toMatchObject({ para: null });
    expect(semNumero.json.whatsappUrl).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect((await historico(id)).at(-1)).toEqual(["Documento enviado por WhatsApp", "Sem WhatsApp no cadastro do cliente: o contato é escolhido na conversa.", "uA"]);
    await prisma.cliente.update({ where: { id: "c1" }, data: { celular: "(11) 98888-0000" } });
  });

  it("ENVIAR POR E-MAIL: com o e-mail da empresa configurado vai pelo Resend (modelo PMOC_DOCUMENTO); falha não registra envio; sem e-mail: 422", async () => {
    await prisma.contatoCliente.create({ data: { empresaId: "e1", clienteId: "c1", nome: "Maria Lima", email: "maria@hospital.com.br", principal: true } });
    const id = await plano();
    email.ativa = true;
    const r = await chamar("enviar", "POST", { id, corpo: { canal: "EMAIL" } });
    expect(r.json).toMatchObject({ canal: "EMAIL", emailEnviado: true, erroEmail: null, para: "maria@hospital.com.br" });
    expect(email.enviar).toHaveBeenCalledTimes(1);
    expect(email.enviar.mock.calls[0]).toEqual(["e1", {
      tipo: "PMOC_DOCUMENTO", para: "maria@hospital.com.br", referenciaId: id, referenciaTipo: "Pmoc",
      variaveis: { cliente_nome: "Hospital Santa Clara", pmoc_nome: "PMOC 2027 — Hospital", vigencia: "12/11/2026 a 11/11/2027", link_documento: r.json.publicUrl },
    }]);
    expect(await historico(id)).toEqual([["Documento enviado por e-mail", "maria@hospital.com.br", "uA"]]);

    email.enviar = vi.fn(async () => ({ ok: false, erro: "Domínio não verificado." }));
    expect((await chamar("enviar", "POST", { id, corpo: { canal: "EMAIL" } })).json).toMatchObject({ emailEnviado: false, erroEmail: "Domínio não verificado." });
    email.enviar = vi.fn(async () => { throw new Error("rede"); });
    expect((await chamar("enviar", "POST", { id, corpo: { canal: "EMAIL" } })).json).toMatchObject({ emailEnviado: false, erroEmail: "Erro no envio." });
    expect(await historico(id)).toHaveLength(1); // o que não saiu não entra no histórico

    await prisma.contatoCliente.deleteMany({});
    await prisma.cliente.update({ where: { id: "c1" }, data: { email: null } });
    expect(await chamar("enviar", "POST", { id, corpo: { canal: "EMAIL" } })).toMatchObject({ status: 422, json: { erro: expect.stringContaining("O cliente não tem e-mail no cadastro.") } });
    await prisma.cliente.update({ where: { id: "c1" }, data: { email: "adm@hospital.com.br" } });
  });

  it("ENVIAR sem o e-mail da empresa: devolve o mailto com tudo preenchido; 'Copiar link' também fica no histórico", async () => {
    const id = await plano();
    const r = await chamar("enviar", "POST", { id, corpo: { canal: "EMAIL" } });
    expect(r.json).toMatchObject({ emailEnviado: false, erroEmail: null, para: "adm@hospital.com.br" });
    expect(email.enviar).not.toHaveBeenCalled();
    const mailto = new URL(r.json.mailtoUrl);
    expect(decodeURIComponent(mailto.pathname)).toBe("adm@hospital.com.br");
    expect(mailto.searchParams.get("subject")).toBe("PMOC 2027 — Hospital — Clima Total");
    expect(mailto.searchParams.get("body")).toContain(r.json.publicUrl);
    const link = await chamar("enviar", "POST", { id, corpo: { canal: "LINK" } });
    expect(link.json).toMatchObject({ canal: "LINK", publicUrl: r.json.publicUrl, para: null });
    expect(await historico(id)).toEqual([["Documento enviado por e-mail", "pelo e-mail do usuário, para adm@hospital.com.br", "uA"], ["Link do documento copiado", null, "uA"]]);
  });

  it("ENVIAR — bloqueios e RBAC: só plano publicado e ativo; quem só visualiza envia; sem o módulo, técnico e outra empresa não", async () => {
    const rascunho = await plano({ status: "RASCUNHO" }), inativo = await plano({ ativo: false }), id = await plano();
    for (const canal of ["WHATSAPP", "EMAIL", "LINK"]) {
      expect(await chamar("enviar", "POST", { id: rascunho, corpo: { canal } })).toMatchObject({ status: 409, json: { erro: "Publique o plano antes de enviar ao cliente." } });
      expect(await chamar("enviar", "POST", { id: inativo, corpo: { canal } })).toMatchObject({ status: 409, json: { erro: "PMOC inativo: reative antes de enviar ao cliente." } });
    }
    expect(await prisma.pmoc.count({ where: { tokenPublico: { not: null } } })).toBe(0); // envio recusado não cria link
    for (const corpo of [{}, { canal: "SMS" }, null]) expect(await chamar("enviar", "POST", { id, corpo })).toMatchObject({ status: 400, json: { erro: "Canal de envio inválido." } });

    comPmoc(["visualizar"]); // "baixar e enviar respeitam PMOC › Visualizar"
    expect((await chamar("enviar", "POST", { id, corpo: { canal: "LINK" } })).status).toBe(200);
    semModulo();
    expect((await chamar("enviar", "POST", { id, corpo: { canal: "LINK" } })).status).toBe(403);
    tecnicoDoApp();
    expect((await chamar("enviar", "POST", { id, corpo: { canal: "WHATSAPP" } })).status).toBe(403);
    como(permissoesTotais(), "e2");
    expect((await chamar("enviar", "POST", { id, corpo: { canal: "LINK" } })).status).toBe(404);
    expect(await prisma.pmocHistorico.count({ where: { pmocId: { in: [rascunho, inativo] } } })).toBe(0);
    expect(await historico(id)).toHaveLength(1);
  });

  it("LINK PÚBLICO: só abre com o token certo e enquanto o plano está publicado e ativo", async () => {
    const id = await plano();
    const token = (await chamar("enviar", "POST", { id, corpo: { canal: "LINK" } })).json.publicUrl.split("/").pop();
    sessao.atual = null;
    expect((await chamar("publico", "GET", { token })).status).toBe(200);
    for (const errado of ["", "curto", `${token}x`, token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"), "../../api/pmocs", "a".repeat(200), id]) {
      const r = await chamar("publico", "GET", { token: errado });
      expect(r, errado).toMatchObject({ status: 404, bytes: null, texto: "Documento indisponível. Peça um novo link a quem enviou." });
    }
    await prisma.pmoc.update({ where: { id }, data: { status: "RASCUNHO" } });
    expect((await chamar("publico", "GET", { token })).status).toBe(404);
    await prisma.pmoc.update({ where: { id }, data: { status: "PUBLICADO", ativo: false } });
    expect((await chamar("publico", "GET", { token })).status).toBe(404);
    await prisma.pmoc.update({ where: { id }, data: { ativo: true } });
    expect((await chamar("publico", "GET", { token })).status).toBe(200); // voltou a valer: o mesmo link
    // o plano de cada empresa tem o seu token; o documento público é o daquele plano
    como(permissoesTotais(), "e2");
    const idE2 = await plano({}, "e2");
    const tokenE2 = (await chamar("enviar", "POST", { id: idE2, corpo: { canal: "LINK" } })).json.publicUrl.split("/").pop();
    expect(tokenE2).not.toBe(token);
    sessao.atual = null;
    const docE2 = await textoDoPdf((await chamar("publico", "GET", { token: tokenE2 })).bytes!);
    expect(docE2).toContain("PMOC da outra empresa");
    expect(docE2).not.toContain("Hospital Santa Clara");
  });

  /* ───────── avisos de vencimento ───────── */
  it("AVISO: o sino conta o plano que expira dentro da antecedência DA EMPRESA e o expirado; rascunho e inativo não avisam", async () => {
    await plano({ nome: "Vence em 20 dias", dataInicio: dia("2025-12-03"), dataExpiracao: dia("2026-12-02") });
    await plano({ nome: "Vence em 31 dias", dataInicio: dia("2025-12-14"), dataExpiracao: dia("2026-12-13") });
    await plano({ nome: "Expira hoje", dataInicio: dia("2025-11-13"), dataExpiracao: dia("2026-11-12") });
    await plano({ nome: "Expirou ontem", dataInicio: dia("2025-11-12"), dataExpiracao: dia("2026-11-11") });
    await plano({ nome: "Rascunho vencendo", status: "RASCUNHO", dataInicio: dia("2025-12-03"), dataExpiracao: dia("2026-12-02") });
    await plano({ nome: "Inativo expirado", ativo: false, dataInicio: dia("2025-11-01"), dataExpiracao: dia("2026-10-31") });
    await plano({ nome: "Longe" });
    expect(await sino()).toMatchObject({ pmocsVencendo: 2, pmocsExpirados: 1 }); // padrão: 30 dias
    const semPmoc = await sino();
    // a antecedência é da empresa: com 45 dias entra o de 31; com 10, só o que expira hoje
    await prisma.pmocConfiguracao.create({ data: { empresaId: "e1", diasAviso: 45 } });
    expect(await sino()).toMatchObject({ pmocsVencendo: 3, pmocsExpirados: 1 });
    await prisma.pmocConfiguracao.update({ where: { empresaId: "e1" }, data: { diasAviso: 10 } });
    const com10 = await sino();
    expect(com10).toMatchObject({ pmocsVencendo: 1, pmocsExpirados: 1 });
    expect(com10.total - semPmoc.total).toBe(-1); // os avisos do PMOC entram no total do sino
    // quem não vê o PMOC não recebe o aviso (nem no total); a outra empresa não vê os planos desta
    semModulo();
    expect(await sino()).toMatchObject({ pmocsVencendo: 0, pmocsExpirados: 0, total: com10.total - 2 });
    como(permissoesTotais(), "e2");
    expect(await sino()).toMatchObject({ pmocsVencendo: 0, pmocsExpirados: 0 });
  });

  it("AVISO IDEMPOTENTE: o mesmo aviso é registrado UMA vez no histórico — com o sino consultando várias vezes e ao mesmo tempo", async () => {
    const id = await plano({ dataInicio: dia("2025-12-03"), dataExpiracao: dia("2026-12-02") });
    const { registrarAvisosPmoc } = await import("@/lib/pmoc-avisos-server");
    await sino();
    expect(depois.tarefas).toHaveLength(2); // a reconciliação fiscal (que já existia) e o registro dos avisos do PMOC
    expect(await prisma.pmocAviso.count()).toBe(0); // registra DEPOIS de responder
    await rodarDepois();
    expect(await historico(id)).toEqual([["Aviso: plano perto de expirar", "O plano expira em 02/12/2026 (faltam 20 dias).", null]]);
    // de novo, várias vezes e em paralelo
    for (let i = 0; i < 3; i++) { await sino(); await rodarDepois(); }
    expect((await Promise.all(Array.from({ length: 8 }, () => registrarAvisosPmoc("e1")))).reduce((a, b) => a + b, 0)).toBe(0);
    await prisma.pmocAviso.deleteMany({}); await prisma.pmocHistorico.deleteMany({});
    const registrados = await Promise.all(Array.from({ length: 8 }, () => registrarAvisosPmoc("e1"))); // oito ao mesmo tempo, do zero
    expect(registrados.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await prisma.pmocAviso.findMany({ select: { pmocId: true, tipo: true, dataExpiracao: true, vistoEm: true } })).toEqual([{ pmocId: id, tipo: "VENCENDO", dataExpiracao: dia("2026-12-02"), vistoEm: null }]);
    expect(await historico(id)).toHaveLength(1);
    // registrar não tira do sino: o aviso continua até alguém dar ciência
    expect(await sino()).toMatchObject({ pmocsVencendo: 1 });
    // dias depois, o mesmo aviso NÃO é escrito de novo
    em("2026-11-25");
    await sino(); await rodarDepois();
    expect(await historico(id)).toHaveLength(1);
    // quem não vê o PMOC não dispara o registro
    await prisma.pmocAviso.deleteMany({});
    semModulo();
    await sino();
    expect(depois.tarefas).toHaveLength(1);
  });

  it("CIÊNCIA: tira o aviso do sino de todos e fica no histórico; exige 'PMOC › Editar'; repetir não escreve de novo", async () => {
    const id = await plano({ dataInicio: dia("2025-12-03"), dataExpiracao: dia("2026-12-02") });
    const longe = await plano({ nome: "Longe" });
    comPmoc(["visualizar"]);
    expect((await chamar("aviso", "POST", { id })).status).toBe(403);
    expect(await sino()).toMatchObject({ pmocsVencendo: 1 });
    comPmoc(["visualizar", "editar"]);
    expect(await chamar("aviso", "POST", { id })).toMatchObject({ status: 200, json: { ok: true, tipo: "VENCENDO" } });
    expect(await sino()).toMatchObject({ pmocsVencendo: 0, pmocsExpirados: 0 });
    expect(await prisma.pmocAviso.findMany({ select: { tipo: true, vistoPorId: true, vistoEm: true } })).toEqual([{ tipo: "VENCENDO", vistoPorId: "uA", vistoEm: AGORA }]);
    expect(await historico(id)).toEqual([["Ciência do aviso de vencimento", "Expira em 20 dias (02/12/2026)", "uA"]]);
    expect((await chamar("aviso", "POST", { id })).status).toBe(200);
    expect(await historico(id)).toHaveLength(1);
    await sino(); await rodarDepois();
    expect(await historico(id)).toHaveLength(1); // quem já teve ciência não é "avisado" de novo
    // plano sem aviso, de outra empresa ou inexistente: 404
    expect(await chamar("aviso", "POST", { id: longe })).toMatchObject({ status: 404, json: { erro: "Este PMOC não tem aviso de vencimento." } });
    como(permissoesTotais(), "e2");
    expect((await chamar("aviso", "POST", { id })).status).toBe(404);
    tecnicoDoApp();
    expect((await chamar("aviso", "POST", { id })).status).toBe(403);
  });

  it("quando VIRA EXPIRADO é outro aviso (mesmo com ciência do 'vencendo'); mudar a validade também recomeça", async () => {
    const id = await plano({ dataInicio: dia("2025-12-03"), dataExpiracao: dia("2026-12-02") });
    await sino(); await rodarDepois();
    await chamar("aviso", "POST", { id });
    expect(await sino()).toMatchObject({ pmocsVencendo: 0, pmocsExpirados: 0 });
    em("2026-12-02"); // o dia da expiração ainda é vigente
    expect(await sino()).toMatchObject({ pmocsVencendo: 0, pmocsExpirados: 0 });
    em("2026-12-03"); // expirou
    expect(await sino()).toMatchObject({ pmocsVencendo: 0, pmocsExpirados: 1 });
    await rodarDepois(); await sino(); await rodarDepois();
    expect((await historico(id)).map((h: any[]) => h[0])).toEqual(["Aviso: plano perto de expirar", "Ciência do aviso de vencimento", "Aviso: plano expirado"]);
    expect((await historico(id)).at(-1)).toEqual(["Aviso: plano expirado", "O plano expirou em 02/12/2026.", null]);
    expect((await chamar("aviso", "POST", { id })).json).toMatchObject({ tipo: "EXPIRADO" });
    expect(await sino()).toMatchObject({ pmocsExpirados: 0 });

    // a validade foi estendida: o plano volta a vigente, sem aviso; perto da NOVA data, um aviso novo
    await prisma.pmoc.update({ where: { id }, data: { dataExpiracao: dia("2027-06-30") } });
    expect(await sino()).toMatchObject({ pmocsVencendo: 0, pmocsExpirados: 0 });
    em("2027-06-10");
    expect(await sino()).toMatchObject({ pmocsVencendo: 1 });
    await rodarDepois();
    expect(await prisma.pmocAviso.count({ where: { pmocId: id } })).toBe(3); // vencendo e expirado da data antiga + vencendo da nova
    expect((await historico(id)).at(-1)).toEqual(["Aviso: plano perto de expirar", "O plano expira em 30/06/2027 (faltam 20 dias).", null]);
  });

  it("DASHBOARD: o bloco PMOC traz vigentes, vencendo e expirados, e a lista dos avisos — expirados primeiro", async () => {
    const vence = await plano({ nome: "Vence em 20 dias", dataInicio: dia("2025-12-03"), dataExpiracao: dia("2026-12-02") });
    const expirou = await plano({ nome: "Expirou ontem", dataInicio: dia("2025-11-12"), dataExpiracao: dia("2026-11-11") });
    await plano({ nome: "Longe" });
    await plano({ nome: "Da outra empresa", dataInicio: dia("2025-11-12"), dataExpiracao: dia("2026-11-11") }, "e2");
    const { dadosPmoc } = await import("@/lib/dashboard/dados");
    expect(await dadosPmoc("e1")).toEqual({
      vigentes: 2, diasAviso: 30, vencendo: 1, expirados: 1,
      avisos: [
        { id: expirou, nome: "Expirou ontem", cliente: "Hospital Santa Clara", tipo: "EXPIRADO", texto: "Expirou ontem (11/11/2026)" },
        { id: vence, nome: "Vence em 20 dias", cliente: "Hospital Santa Clara", tipo: "VENCENDO", texto: "Expira em 20 dias (02/12/2026)" },
      ],
    });
    await chamar("aviso", "POST", { id: expirou });
    expect(await dadosPmoc("e1")).toMatchObject({ vencendo: 1, expirados: 0, avisos: [{ id: vence }] });
    // a lista do PMOC filtra "Vencendo" com a mesma regra
    const { filtroStatusPmoc } = await import("@/lib/pmoc");
    expect((await prisma.pmoc.findMany({ where: { empresaId: "e1", ...filtroStatusPmoc("VENCENDO", new Date(), 30) }, select: { nome: true } })).map((p: any) => p.nome)).toEqual(["Vence em 20 dias"]);
    expect(await prisma.pmoc.count({ where: { empresaId: "e1", ...filtroStatusPmoc("VENCENDO", new Date(), 10) } })).toBe(0);
  });

  /* ───────── configuração e histórico ───────── */
  it("CONFIGURAÇÃO por empresa: antecedência (1 a 365 dias) e texto técnico; ler é 'visualizar', salvar é 'editar'; uma empresa não vê a da outra", async () => {
    expect((await chamar("config", "GET")).json).toEqual({ diasAviso: 30, textoPadrao: null, textoDoSistema: DESCRICAO_PADRAO_PMOC });
    for (const [corpo, erro] of [
      [{ diasAviso: 0 }, "A antecedência vai de 1 a 365 dias."], [{ diasAviso: 366 }, "A antecedência vai de 1 a 365 dias."],
      [{ diasAviso: 7.5 }, "Use um número inteiro de dias."], [{ diasAviso: "30" }, "Informe com quantos dias de antecedência avisar."], [{}, "Required"],
      [{ diasAviso: 30, textoPadrao: "x".repeat(20_001) }, "O texto padrão vai até 20.000 caracteres."],
    ] as const) {
      const r = await chamar("config", "PUT", { corpo });
      expect(r.status, JSON.stringify(corpo).slice(0, 40)).toBe(400);
      if (erro !== "Required") expect(r.json.erro).toBe(erro);
    }
    expect(await prisma.pmocConfiguracao.count()).toBe(0);
    expect((await chamar("config", "PUT", { corpo: { diasAviso: 60, textoPadrao: "  Texto da Clima Total.  " } })).json).toMatchObject({ diasAviso: 60, textoPadrao: "Texto da Clima Total." });
    expect((await chamar("config", "GET")).json).toMatchObject({ diasAviso: 60, textoPadrao: "Texto da Clima Total." });
    // texto igual ao do sistema (ou vazio) não é gravado: volta a acompanhar o padrão do sistema
    expect((await chamar("config", "PUT", { corpo: { diasAviso: 15, textoPadrao: DESCRICAO_PADRAO_PMOC } })).json).toMatchObject({ diasAviso: 15, textoPadrao: null });
    expect((await chamar("config", "PUT", { corpo: { diasAviso: 15, textoPadrao: "   " } })).json.textoPadrao).toBeNull();
    comPmoc(["visualizar"]);
    expect((await chamar("config", "GET")).status).toBe(200);
    expect((await chamar("config", "PUT", { corpo: { diasAviso: 5 } })).status).toBe(403);
    semModulo();
    expect((await chamar("config", "GET")).status).toBe(403);
    tecnicoDoApp();
    expect((await chamar("config", "PUT", { corpo: { diasAviso: 5 } })).status).toBe(403);
    como(permissoesTotais(), "e2");
    expect((await chamar("config", "GET")).json).toMatchObject({ diasAviso: 30, textoPadrao: null }); // a outra empresa segue no padrão
    await chamar("config", "PUT", { corpo: { diasAviso: 90 } });
    expect((await prisma.pmocConfiguracao.findMany({ orderBy: { empresaId: "asc" }, select: { empresaId: true, diasAviso: true } }))).toEqual([{ empresaId: "e1", diasAviso: 15 }, { empresaId: "e2", diasAviso: 90 }]);
  });

  it("HISTÓRICO do plano: publicação, envios, avisos e ciência, do mais novo para o mais antigo, com quem fez", async () => {
    const id = await plano({ status: "RASCUNHO", dataInicio: dia("2025-12-03"), dataExpiracao: dia("2026-12-02") });
    const datas = { dataInicio: "2025-12-03", dataExpiracao: "2026-12-02" };
    await chamar("plano", "PUT", { id, corpo: corpoPlano(datas) });                        // publica
    em("2026-11-13"); await sino(); await rodarDepois();                                    // aviso automático
    em("2026-11-14"); await chamar("enviar", "POST", { id, corpo: { canal: "WHATSAPP" } }); // envio
    em("2026-11-15"); await chamar("aviso", "POST", { id });                                // ciência
    em("2026-11-16"); await chamar("plano", "PUT", { id, corpo: corpoPlano({ ...datas, status: "RASCUNHO" }) }); // volta a rascunho
    await chamar("plano", "PUT", { id, corpo: corpoPlano({ ...datas, status: "RASCUNHO" }) });                    // salvar sem mudar o status: nada novo
    const r = await chamar("historico", "GET", { id });
    expect(r.status).toBe(200);
    expect(r.json.historico.map((h: any) => [h.acao, h.usuario])).toEqual([
      ["Plano voltou para rascunho", "Ana Souza"],
      ["Ciência do aviso de vencimento", "Ana Souza"],
      ["Documento enviado por WhatsApp", "Ana Souza"],
      ["Aviso: plano perto de expirar", null], // automático: sem usuário
      ["Plano publicado", "Ana Souza"],
    ]);
    expect(r.json.historico.every((h: any) => /^\d{4}-\d{2}-\d{2}T/.test(h.criadoEm) && typeof h.id === "string")).toBe(true);
    expect(r.json.historico[3].detalhes).toBe("O plano expira em 02/12/2026 (faltam 19 dias).");
    comPmoc(["visualizar"]);
    expect((await chamar("historico", "GET", { id })).status).toBe(200);
    semModulo();
    expect((await chamar("historico", "GET", { id })).status).toBe(403);
    como(permissoesTotais(), "e2");
    expect((await chamar("historico", "GET", { id })).status).toBe(404);
  });

  it("apagar o plano leva o histórico e os avisos; apagar o usuário não apaga o histórico (fica sem o nome)", async () => {
    const id = await plano({ dataInicio: dia("2025-12-03"), dataExpiracao: dia("2026-12-02") });
    await prisma.usuario.create({ data: { id: "uTemp", empresaId: "e1", nome: "Temporário", email: "temp@x.com", senha: "x" } });
    como(permissoesTotais(), "e1", { id: "uTemp" });
    await chamar("enviar", "POST", { id, corpo: { canal: "LINK" } });
    await chamar("aviso", "POST", { id });
    await prisma.usuario.delete({ where: { id: "uTemp" } });
    expect(await historico(id)).toEqual([["Link do documento copiado", null, null], ["Ciência do aviso de vencimento", "Expira em 20 dias (02/12/2026)", null]]);
    expect(await prisma.pmocAviso.findFirst({ where: { pmocId: id }, select: { vistoPorId: true, vistoEm: true } })).toEqual({ vistoPorId: null, vistoEm: AGORA });
    await prisma.pmoc.delete({ where: { id } });
    expect([await prisma.pmocHistorico.count(), await prisma.pmocAviso.count()]).toEqual([0, 0]);
  });
});
