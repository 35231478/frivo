/**
 * NFS-e PR3 — emissão pelas rotas REAIS (/api/fiscal/notas…), com o Prisma num PostgreSQL real e o
 * PlugNotas simulado no `fetch` (mesmos caminhos, cabeçalho x-api-key e formatos que o cliente usa):
 *  - pré-validação: emitente, medição aprovada, tomador (CPF/CNPJ, endereço, IBGE), item sem serviço,
 *    serviço sem LC 116/alíquota, NF registrada à mão, produção ainda fechada;
 *  - uma nota por código (o corpo enviado: prestador, tomador, servico[] com iss e desconto rateado);
 *  - status: PROCESSANDO → CONCLUIDO (nº, código de verificação, NF na medição, conta a receber) e
 *    REJEITADO (motivo sem o token; itens voltam a ficar livres; reemissão);
 *  - envio sem resposta: fica ENVIANDO, consulta pelo nosso id; sem registro lá → INTERROMPIDO;
 *  - clique duplo não duplica; consulta no máximo a cada 5 s; PDF/XML pelo servidor;
 *  - RBAC (Financeiro › Fiscal para emitir), empresa da sessão, histórico (notas e OS).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/nfse-emissao-pg
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_nfse_emissao_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const TOKEN = "tok-sandbox-SEGREDO-123456";
const BASE = "https://api.sandbox.plugnotas.com.br";

const FISCAL = montarPermissoes({ financeiro: ["visualizar", "medicoes", "fiscal"] });
const SO_MEDICOES = montarPermissoes({ financeiro: ["visualizar", "medicoes"] });
const SO_RECEBER = montarPermissoes({ financeiro: ["visualizar", "contasReceber"] });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes, o: { empresaId?: string; role?: string } = {}) => {
  sessao.atual = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId: o.empresaId ?? "e1", role: o.role ?? "OPERADOR", permissoes } };
};

/* ───────── PlugNotas simulado ───────── */
interface NotaPn { id: string; idIntegracao: string; situacao: string; numeroNfse?: string; codigoVerificacao?: string; mensagem?: string }
const pn = vi.hoisted(() => ({
  notas: new Map<string, any>(), envios: [] as any[], chamadas: [] as { metodo: string; url: string; chave: string | null }[],
  modo: "ok" as "ok" | "recusa" | "sem-resposta" | "erro500", seq: 0, viacep: [] as string[],
}));

function resposta(status: number, corpo: unknown, tipo = "application/json") {
  return new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status, headers: { "Content-Type": tipo } });
}
const consultaPn = (n: NotaPn) => [{
  id: n.id, idIntegracao: n.idIntegracao, situacao: n.situacao, numero: "77", numeroNfse: n.numeroNfse, codigoVerificacao: n.codigoVerificacao,
  mensagem: n.mensagem, emissao: "29/10/2026", pdf: `${BASE}/nfse/pdf/${n.id}`, xml: `${BASE}/nfse/xml/${n.id}`,
}];

async function fetchFalso(entrada: string | URL, init?: RequestInit) {
  const url = String(entrada);
  if (url.startsWith("https://viacep.com.br/")) {
    pn.viacep.push(url);
    return resposta(200, { ibge: "3550308", localidade: "São Paulo", uf: "SP" });
  }
  const chave = new Headers(init?.headers).get("x-api-key");
  const caminho = url.replace(BASE, "");
  pn.chamadas.push({ metodo: init?.method ?? "GET", url: caminho, chave });
  if (chave !== TOKEN) return resposta(401, { error: { message: "Unauthorized" } });
  if (init?.method === "POST" && caminho === "/nfse") {
    const corpo = JSON.parse(String(init.body));
    pn.envios.push(corpo);
    if (pn.modo === "sem-resposta") throw Object.assign(new Error("tempo"), { name: "TimeoutError" });
    if (pn.modo === "erro500") return resposta(500, { error: { message: "Erro interno" } });
    if (pn.modo === "recusa") return resposta(400, { error: { message: "Falha na validação do JSON de NFSe", data: { fields: { "tomador.endereco.cep": "CEP inválido" } } } });
    const docs = corpo.map((n: any) => {
      const id = `pn${(++pn.seq).toString().padStart(4, "0")}`;
      pn.notas.set(id, { id, idIntegracao: n.idIntegracao, situacao: "PROCESSANDO" });
      return { idIntegracao: n.idIntegracao, prestador: n.prestador.cpfCnpj, id };
    });
    return resposta(200, { documents: docs, message: "Nota(as) em processamento", protocol: `prot-${pn.seq}` });
  }
  let m: RegExpMatchArray | null;
  if ((m = caminho.match(/^\/nfse\/consultar\/([^/]+)\/(\d+)$/))) {
    const n = [...pn.notas.values()].find((x) => x.idIntegracao === decodeURIComponent(m![1]));
    return n ? resposta(200, consultaPn(n)) : resposta(404, { error: { message: "Nota não encontrada" } });
  }
  if ((m = caminho.match(/^\/nfse\/consultar\/([^/]+)$/))) {
    const n = pn.notas.get(decodeURIComponent(m[1]));
    return n ? resposta(200, consultaPn(n)) : resposta(404, { error: { message: "Nota não encontrada" } });
  }
  if ((m = caminho.match(/^\/nfse\/(pdf|xml)\/([^/]+)$/))) {
    if (!pn.notas.has(m[2])) return resposta(404, { error: { message: "Nota não encontrada" } });
    return m[1] === "pdf" ? resposta(200, "%PDF-1.4 nota", "application/pdf") : resposta(200, "<nfse/>", "application/xml; charset=utf-8");
  }
  return resposta(404, { error: { message: "rota desconhecida" } });
}
const situar = (id: string, s: Partial<NotaPn>) => pn.notas.set(id, { ...pn.notas.get(id), ...s });

/* ───────── Rotas ───────── */
async function rota(mod: string, metodo: "GET" | "POST", url: string, corpo?: unknown, params?: Record<string, string>) {
  const m = await import(/* @vite-ignore */ `@/app/api/fiscal/notas${mod}/route`);
  const req = new NextRequest(`http://localhost${url}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await m[metodo](req, { params: Promise.resolve(params ?? {}) });
  const tipo = res.headers.get("content-type") ?? "";
  return { status: res.status, headers: res.headers, json: tipo.includes("json") ? await res.json() as any : null, texto: tipo.includes("json") ? "" : await res.text() };
}
const previa = (medicaoId = "m1") => rota("", "GET", `/api/fiscal/notas?medicaoId=${medicaoId}&previa=1`);
const listar = (q = "medicaoId=m1") => rota("", "GET", `/api/fiscal/notas?${q}`);
const emitir = (corpo: Record<string, unknown> = {}) => rota("", "POST", "/api/fiscal/notas", { medicaoId: "m1", origem: "MEDICAO", ...corpo });
const consultar = (id: string) => rota("/[id]/consultar", "POST", `/api/fiscal/notas/${id}/consultar`, undefined, { id });
const arquivo = (id: string, tipo = "pdf") => rota("/[id]/arquivo", "GET", `/api/fiscal/notas/${id}/arquivo?tipo=${tipo}`, undefined, { id });
const vincular = (corpo: Record<string, unknown>) => rota("/vincular-servico", "POST", "/api/fiscal/notas/vincular-servico", corpo);

describe.skipIf(!URL_PG)("NFS-e: emissão pelo PlugNotas (PostgreSQL real)", () => {
  let prisma: any;
  const notasDb = () => prisma.notaFiscal.findMany({ orderBy: { criadoEm: "asc" }, include: { itens: true, eventos: { orderBy: { criadoEm: "asc" } } } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["", "/[id]/consultar", "/[id]/arquivo", "/vincular-servico"].map((r) => import(/* @vite-ignore */ `@/app/api/fiscal/notas${r}/route`)));
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn(fetchFalso));
    vi.stubEnv("PLUGNOTAS_API_TOKEN", TOKEN);
    vi.stubEnv("PLUGNOTAS_API_URL", "");
    vi.stubEnv("NFSE_EMISSAO_PRODUCAO", "");
    pn.notas.clear(); pn.envios = []; pn.chamadas = []; pn.modo = "ok"; pn.viacep = []; pn.seq = 0;
    for (const t of ["notaFiscalEvento", "notaFiscalItem", "notaFiscal", "osHistorico", "medicaoNf", "contaReceber", "medicaoItem", "medicao", "ordemServico", "servico", "cliente", "configuracao", "empresaFiscal", "usuario", "empresa"]) {
      await prisma[t].deleteMany({});
    }
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com", cnaePrincipal: "4322302" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.create({ data: { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" } });
    await prisma.configuracao.create({ data: { empresaId: "e1", issAliquota: 3.5 } });
    await prisma.empresaFiscal.create({ data: {
      empresaId: "e1", regimeTributario: "SIMPLES_NACIONAL", ambiente: "HOMOLOGACAO", status: "ATIVO",
      emitenteCnpj: "12345678000190", emitenteAmbiente: "HOMOLOGACAO", codigoMunicipio: "5220454", municipioNome: "Senador Canedo", municipioUf: "GO",
      certificadoValidoAte: new Date(Date.now() + 90 * 86_400_000),
    } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Condomínio Jardim", cpfCnpj: "11.222.333/0001-81", email: "fin@jardim.com", emailsFaturamento: ["nf@jardim.com"],
        endereco: "Av. Goiás", numero: "100", complemento: "Bloco B", bairro: "Centro", cidade: "Senador Canedo", estado: "GO", cep: "75250-000" },
      { id: "cB", empresaId: "e2", nome: "Da outra", cpfCnpj: "11.222.333/0001-81" },
    ] });
    await prisma.servico.createMany({ data: [
      { id: "sHig", empresaId: "e1", nome: "Higienização", codigoLc116: "14.01", codigoMunicipal: "140101", aliquotaISS: 5, discriminacaoPadrao: "Higienização de ar-condicionado" },
      { id: "sIns", empresaId: "e1", nome: "Instalação", codigoLc116: "14.06", codigoMunicipal: "140601", cnae: "4321500" },
      { id: "sMan", empresaId: "e1", nome: "Manutenção", codigoLc116: "14.01", codigoMunicipal: "140101", aliquotaISS: 5 },
      { id: "sSem", empresaId: "e1", nome: "Sem LC" },
      { id: "sB", empresaId: "e2", nome: "Da outra", codigoLc116: "14.01" },
    ] });
    await prisma.ordemServico.create({ data: { id: "os1", empresaId: "e1", numero: "2026-0045", clienteId: "c1", criadoPorId: "u1", descricao: "Higienização", status: "CONCLUIDA" } });
    await prisma.medicao.create({ data: {
      id: "m1", empresaId: "e1", clienteId: "c1", numero: "MED-2026-0012", tipo: "ADICIONAL", status: "PC_RECEBIDO",
      valorTotal: 1100, descontoValor: 110, valorLiquido: 990, tokenPublico: "tok-m1",
      itens: { create: [
        { id: "i1", tipo: "SERVICO", servicoId: "sHig", ordemServicoId: "os1", descricao: "Higienização split 12k", quantidade: 2, valorUnitario: 150, valorTotal: 300, ordem: 0 },
        { id: "i2", tipo: "SERVICO", servicoId: "sIns", descricao: "Instalação split", quantidade: 1, valorUnitario: 600, valorTotal: 600, ordem: 1 },
        { id: "i3", tipo: "SERVICO", servicoId: "sMan", descricao: "Manutenção corretiva", quantidade: 1, valorUnitario: 100, valorTotal: 100, ordem: 2 },
        { id: "i4", tipo: "PRODUTO", descricao: "Gás R410", quantidade: 1, valorUnitario: 100, valorTotal: 100, ordem: 3 },
      ] },
    } });
    await prisma.contaReceber.create({ data: { id: "cr1", empresaId: "e1", clienteId: "c1", medicaoId: "m1", numero: "CR-0001", descricao: "Medição", valor: 990, status: "PREVISTO" } });
    await prisma.medicao.create({ data: { id: "mB", empresaId: "e2", clienteId: "cB", numero: "MED-2026-0001", status: "PC_RECEBIDO", tokenPublico: "tok-mB" } });
    logar(FISCAL);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  describe("pré-validação", () => {
    it("tudo certo: 2 notas (código 140101 com Higienização + Manutenção; 140601 com Instalação); produto fora; desconto rateado", async () => {
      const r = await previa();
      expect(r.status).toBe(200);
      const p = r.json.previa;
      expect(p.pendencias).toEqual([]);
      expect(p.ambiente).toBe("HOMOLOGACAO");
      expect(p.grupos.map((g: any) => [g.rotulo, g.valorServicos, g.valorDesconto, g.itens.map((i: any) => i.id)])).toEqual([
        ["Código 140101 (LC 116 14.01)", 400, 40, ["i1", "i3"]],
        ["Código 140601 (LC 116 14.06)", 600, 60, ["i2"]],
      ]);
      expect(p.produtos).toEqual({ quantidade: 1, valor: 100 });
      expect(p.grupos[0].discriminacao).toBe("Higienização de ar-condicionado | Higienização split 12k — 2 x R$ 150,00 = R$ 300,00 | Manutenção corretiva — R$ 100,00 | Ref.: Medição MED-2026-0012 · OS 2026-0045");
      expect(r.json.podeEmitir).toBe(true);
      expect(pn.viacep).toEqual([]); // cliente na cidade do emitente: o código IBGE já é conhecido
    });

    it("mostra o que falta, com o link: emitente, medição em rascunho, cliente sem CEP, item sem serviço, serviço sem LC 116", async () => {
      await prisma.empresaFiscal.update({ where: { empresaId: "e1" }, data: { status: "PENDENTE" } });
      await prisma.medicao.update({ where: { id: "m1" }, data: { status: "RASCUNHO" } });
      await prisma.cliente.update({ where: { id: "c1" }, data: { cep: null, numero: "" } });
      await prisma.medicaoItem.update({ where: { id: "i3" }, data: { servicoId: null } });
      await prisma.medicaoItem.update({ where: { id: "i2" }, data: { servicoId: "sSem" } });
      const p = (await previa()).json.previa;
      expect(p.pendencias.map((x: any) => [x.area, x.texto, x.link ?? null])).toEqual([
        ["emitente", "A empresa ainda não está ativa como emitente no PlugNotas.", "/configuracoes/dados-fiscais"],
        ["medicao", "A medição MED-2026-0012 precisa estar aprovada (e com o pedido de compra, se o cliente exige) antes da nota. Hoje está “Rascunho”.", "/financeiro/medicoes/m1"],
        ["tomador", "Endereço do cliente: número, CEP.", "/clientes/c1/editar"],
        ["servico", "Serviço “Sem LC”: falta Código do serviço (LC 116).", "/configuracoes/servicos"],
        ["item", "Item “Manutenção corretiva”: escolha o serviço do catálogo (de onde vêm os dados fiscais).", null],
      ]);
      expect(p.itensSemServico).toEqual([{ id: "i3", descricao: "Manutenção corretiva", valorTotal: 100 }]);
      const e = await emitir();
      expect(e.status).toBe(409);
      expect(e.json.pendencias).toHaveLength(5);
      expect(pn.envios).toEqual([]);
      expect(await prisma.notaFiscal.count()).toBe(0);
    });

    it("cliente em outra cidade: o código IBGE vem do CEP (ViaCEP); não achado vira pendência", async () => {
      await prisma.cliente.update({ where: { id: "c1" }, data: { cidade: "São Paulo", estado: "SP", cep: "01310-100" } });
      expect((await previa()).json.previa.pendencias).toEqual([]);
      expect(pn.viacep).toEqual(["https://viacep.com.br/ws/01310100/json/"]);
      await prisma.cliente.update({ where: { id: "c1" }, data: { cidade: "Campinas", cep: "13010-000" } });
      vi.stubGlobal("fetch", vi.fn(async (u: string, i?: RequestInit) => (String(u).includes("viacep") || String(u).includes("brasilapi") ? resposta(200, { erro: true }) : fetchFalso(u, i))));
      const p = (await previa()).json.previa;
      expect(p.pendencias.map((x: any) => x.texto)).toEqual(["Não achamos o código IBGE da cidade do cliente (Campinas/SP, CEP 13010000): confira o CEP e a cidade."]);
    });

    it("cliente em OUTRA cidade da mesma UF do emitente: não herda o código do emitente; IBGE de outra UF não vale", async () => {
      await prisma.cliente.update({ where: { id: "c1" }, data: { cidade: "Goiânia", estado: "GO", cep: "74000-000" } });
      const p = (await previa()).json.previa;
      expect(pn.viacep).toEqual(["https://viacep.com.br/ws/74000000/json/"]); // a ViaCEP falsa responde São Paulo/SP
      expect(p.pendencias.map((x: any) => x.texto)).toEqual(["Não achamos o código IBGE da cidade do cliente (Goiânia/GO, CEP 74000000): confira o CEP e a cidade."]);
    });

    it("NF registrada à mão bloqueia; Produção fechada nesta fase; certificado vencido; sem token no servidor", async () => {
      await prisma.medicaoNf.create({ data: { medicaoId: "m1", numero: "555" } });
      await prisma.empresaFiscal.update({ where: { empresaId: "e1" }, data: { ambiente: "PRODUCAO", emitenteAmbiente: "PRODUCAO", certificadoValidoAte: new Date(Date.now() - 86_400_000) } });
      vi.stubEnv("PLUGNOTAS_API_TOKEN_PRODUCAO", "");
      const t = (await previa()).json.previa.pendencias.map((x: any) => x.texto);
      expect(t).toEqual([
        "A emissão em Produção ainda não está liberada: nesta fase as notas saem só em Homologação (testes).",
        "O certificado digital venceu: envie o novo em Dados fiscais.",
        "A integração com o PlugNotas não está configurada neste servidor (falta o token). Avise o suporte.",
        "A medição MED-2026-0012 já tem NF registrada à mão (nº 555): não emitimos outra.",
      ]);
    });

    it("item sem serviço: escolher o serviço na tela liga o item (só preenche; da outra empresa não vale)", async () => {
      await prisma.medicaoItem.update({ where: { id: "i3" }, data: { servicoId: null } });
      expect((await vincular({ medicaoId: "m1", itemId: "i3", servicoId: "sB" })).status).toBe(400);
      expect((await vincular({ medicaoId: "m1", itemId: "i3", servicoId: "sMan" })).status).toBe(200);
      expect((await prisma.medicaoItem.findUnique({ where: { id: "i3" } })).servicoId).toBe("sMan");
      // já tem serviço: não troca
      expect((await vincular({ medicaoId: "m1", itemId: "i1", servicoId: "sMan" })).status).toBe(404);
      expect((await prisma.medicaoItem.findUnique({ where: { id: "i1" } })).servicoId).toBe("sHig");
      logar(SO_MEDICOES);
      expect((await vincular({ medicaoId: "m1", itemId: "i3", servicoId: "sMan" })).status).toBe(403);
    });
  });

  describe("emitir e acompanhar", () => {
    it("envia uma nota por código, no formato do PlugNotas, em homologação; grava PROCESSANDO + protocolo + histórico", async () => {
      const r = await emitir({ discriminacoes: { [(await previa()).json.previa.grupos[1].chave]: "Instalação de split | conforme proposta" } });
      expect(r.status).toBe(201);
      expect(r.json.notas.map((n: any) => n.status)).toEqual(["PROCESSANDO", "PROCESSANDO"]);
      expect(pn.chamadas.filter((c) => c.metodo === "POST").map((c) => [c.url, c.chave])).toEqual([["/nfse", TOKEN], ["/nfse", TOKEN]]);
      const notas = await notasDb();
      expect(pn.envios).toEqual([
        [{
          idIntegracao: notas[0].id,
          prestador: { cpfCnpj: "12345678000190" },
          tomador: {
            cpfCnpj: "11222333000181", razaoSocial: "Condomínio Jardim", email: "nf@jardim.com",
            endereco: { descricaoCidade: "Senador Canedo", cep: "75250000", tipoLogradouro: "Avenida", logradouro: "Goiás", tipoBairro: "Bairro", codigoCidade: "5220454", complemento: "Bloco B", estado: "GO", numero: "100", bairro: "Centro" },
          },
          servico: [{
            codigo: "14.01", codigoTributacao: "140101", cnae: "4322302",
            iss: { tipoTributacao: 6, exigibilidade: 1, aliquota: 5, retido: false },
            discriminacao: notas[0].discriminacao, valor: { servico: 400, descontoIncondicionado: 40 },
          }],
        }],
        [expect.objectContaining({
          idIntegracao: notas[1].id,
          servico: [{ codigo: "14.06", codigoTributacao: "140601", cnae: "4321500", iss: { tipoTributacao: 6, exigibilidade: 1, aliquota: 3.5, retido: false }, discriminacao: "Instalação de split | conforme proposta", valor: { servico: 600, descontoIncondicionado: 60 } }],
        })],
      ]);
      expect(notas.map((n: any) => [n.status, n.plugnotasId, n.protocolo, n.ambiente, n.origem, n.contaReceberId, Number(n.valorServicos), Number(n.valorDesconto), n.emitidaPorId])).toEqual([
        ["PROCESSANDO", "pn0001", "prot-1", "HOMOLOGACAO", "MEDICAO", "cr1", 400, 40, "u1"],
        ["PROCESSANDO", "pn0002", "prot-2", "HOMOLOGACAO", "MEDICAO", "cr1", 600, 60, "u1"],
      ]);
      expect(notas[0].itens.map((i: any) => [i.medicaoItemId, i.servicoId, Number(i.valorDesconto)])).toEqual([["i1", "sHig", 30], ["i3", "sMan", 10]]);
      expect(notas[0].eventos.map((e: any) => [e.tipo, e.status, e.mensagem, e.usuarioId])).toEqual([["ENVIO", "PROCESSANDO", "Enviada ao PlugNotas (Homologação (testes)) · protocolo prot-1.", "u1"]]);
      const hist = await prisma.osHistorico.findMany({ where: { ordemServicoId: "os1" } });
      expect(hist.map((h: any) => [h.acao, h.detalhes])).toEqual([["NFS-e enviada", "2 notas da medição MED-2026-0012 (Homologação (testes)): Código 140101 (LC 116 14.01); Código 140601 (LC 116 14.06)"]]);
      // o mesmo pedido de novo: nada a emitir (os itens estão em notas vivas)
      const de2 = await emitir();
      expect(de2.status).toBe(409);
      expect(de2.json.erro).toMatch(/^Nada a emitir/);
      expect(pn.envios).toHaveLength(2);
    });

    it("clique duplo (duas emissões ao mesmo tempo): só uma leva de notas", async () => {
      const [a, b] = await Promise.all([emitir(), emitir()]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await prisma.notaFiscal.count()).toBe(2);
      expect(pn.envios).toHaveLength(2);
    });

    it("autorizada: nº + código de verificação; NF na medição; com TODAS autorizadas, medição 'NF emitida' e conta 'A receber'", async () => {
      await emitir();
      let [n1, n2] = await notasDb();
      situar("pn0001", { situacao: "CONCLUIDO", numeroNfse: "1001", codigoVerificacao: "AB12-CD34" });
      const r = await consultar(n1.id);
      expect(r.json).toMatchObject({ status: "CONCLUIDO", numero: "1001", codigoVerificacao: "AB12-CD34", motivo: null });
      [n1, n2] = await notasDb();
      expect(n1.autorizadaEm).toEqual(new Date(Date.UTC(2026, 9, 29, 3)));
      expect(n1.eventos.at(-1)).toMatchObject({ tipo: "STATUS", status: "CONCLUIDO", mensagem: "Autorizada: NFS-e nº 1001." });
      let m = await prisma.medicao.findUnique({ where: { id: "m1" }, include: { nfs: true } });
      expect([m.status, m.nfNumero, m.nfs.map((x: any) => [x.numero, x.url])]).toEqual(["PC_RECEBIDO", "1001", [["1001", `/api/fiscal/notas/${n1.id}/arquivo?tipo=pdf`]]]);
      expect((await prisma.contaReceber.findUnique({ where: { id: "cr1" } })).status).toBe("PREVISTO");
      situar("pn0002", { situacao: "CONCLUIDO", numeroNfse: "1002" });
      await consultar(n2.id);
      m = await prisma.medicao.findUnique({ where: { id: "m1" }, include: { nfs: true } });
      expect([m.status, m.nfNumero, m.nfs.length]).toEqual(["NF_EMITIDA", "1001, 1002", 2]);
      expect((await prisma.contaReceber.findUnique({ where: { id: "cr1" } })).status).toBe("A_RECEBER");
      expect((await prisma.osHistorico.findMany({ where: { ordemServicoId: "os1", acao: "NFS-e autorizada" } })).map((h: any) => h.detalhes)).toEqual(["NFS-e nº 1001 da medição MED-2026-0012"]);
      // a NF que nós gravamos na medição não conta como "registrada à mão"
      expect((await previa()).json.previa.pendencias).toEqual([]);
    });

    it("autorizada numa medição que já passou da NF (ex.: paga antes): o status dela não volta para 'NF emitida'", async () => {
      await prisma.medicao.update({ where: { id: "m1" }, data: { status: "PAGO" } });
      await emitir();
      situar("pn0001", { situacao: "CONCLUIDO", numeroNfse: "1" });
      situar("pn0002", { situacao: "CONCLUIDO", numeroNfse: "2" });
      for (const n of await notasDb()) await consultar(n.id);
      const m = await prisma.medicao.findUnique({ where: { id: "m1" } });
      expect([m.status, m.nfNumero]).toEqual(["PAGO", "1, 2"]);
    });

    it("rejeitada: o motivo do PlugNotas (sem o token), os itens voltam a ficar livres e dá para emitir de novo", async () => {
      await emitir();
      const [n1] = await notasDb();
      situar("pn0001", { situacao: "REJEITADO", mensagem: `Código de tributação 140101 inválido para o município (chave ${TOKEN})` });
      const r = await consultar(n1.id);
      expect(r.json.status).toBe("REJEITADO");
      expect(r.json.motivo).toBe("Código de tributação 140101 inválido para o município (chave •••)");
      const lista = await listar();
      expect(JSON.stringify(lista.json)).not.toContain(TOKEN);
      expect(JSON.stringify(await notasDb())).not.toContain(TOKEN);
      const p = (await previa()).json.previa;
      expect(p.grupos.map((g: any) => g.itens.map((i: any) => i.id))).toEqual([["i1", "i3"]]);
      expect(p.jaEmNota).toBe(1);
      const de2 = await emitir();
      expect(de2.status).toBe(201);
      expect(de2.json.notas).toHaveLength(1);
      expect((await notasDb()).map((n: any) => n.status)).toEqual(["REJEITADO", "PROCESSANDO", "PROCESSANDO"]);
      expect((await prisma.osHistorico.findMany({ where: { acao: "NFS-e rejeitada" } })).map((h: any) => h.detalhes)).toEqual(["Código de tributação 140101 inválido para o município (chave •••)"]);
    });

    it("recusa na validação do envio: REJEITADO na hora, com o campo apontado", async () => {
      pn.modo = "recusa";
      const r = await emitir();
      expect(r.json.notas.map((n: any) => n.status)).toEqual(["REJEITADO", "REJEITADO"]);
      const [n1] = await notasDb();
      expect(n1.motivo).toBe("Falha na validação do JSON de NFSe. Campos: tomador.endereco.cep (CEP inválido).");
      expect(n1.plugnotasId).toBeNull();
      expect(n1.eventos.map((e: any) => [e.tipo, e.status])).toEqual([["ERRO", "REJEITADO"]]);
    });

    it("envio sem resposta: fica ENVIANDO e a consulta pelo NOSSO id acha a nota lá (ou, sem registro após 2 min, INTERROMPIDO)", async () => {
      pn.modo = "sem-resposta";
      const r = await emitir();
      expect(r.json.notas.map((n: any) => n.status)).toEqual(["ENVIANDO", "ENVIANDO"]);
      const [n1, n2] = await notasDb();
      expect(n1.motivo).toBe("O PlugNotas não respondeu a tempo. Tente de novo. Consultando o status…");
      // a 1ª chegou lá (o PlugNotas registrou com o nosso idIntegracao)
      pn.notas.set("pnX", { id: "pnX", idIntegracao: n1.id, situacao: "PROCESSANDO" });
      const c1 = await consultar(n1.id);
      expect(c1.json.status).toBe("PROCESSANDO");
      expect(pn.chamadas.at(-1)!.url).toBe(`/nfse/consultar/${n1.id}/12345678000190`);
      expect((await prisma.notaFiscal.findUnique({ where: { id: n1.id } })).plugnotasId).toBe("pnX");
      // a 2ª não chegou: antes de 2 min continua esperando; depois, INTERROMPIDO (e libera os itens)
      expect((await consultar(n2.id)).json.status).toBe("ENVIANDO");
      await prisma.notaFiscal.update({ where: { id: n2.id }, data: { criadoEm: new Date(Date.now() - 3 * 60_000), ultimaConsultaEm: null } });
      const c2 = await consultar(n2.id);
      expect(c2.json).toMatchObject({ status: "INTERROMPIDO", motivo: "O PlugNotas não tem registro desta nota (o envio não chegou lá). Pode emitir de novo." });
      expect((await previa()).json.previa.grupos.map((g: any) => g.codigoTributacao)).toEqual(["140601"]);
    });

    it("nota que JÁ tem o id do PlugNotas e some de lá: continua esperando (só a sem id vira INTERROMPIDO)", async () => {
      await emitir();
      const [n1] = await notasDb();
      pn.notas.clear();
      await prisma.notaFiscal.update({ where: { id: n1.id }, data: { criadoEm: new Date(Date.now() - 10 * 60_000) } });
      expect((await consultar(n1.id)).json.status).toBe("PROCESSANDO");
    });

    it("envio sem resposta e o PlugNotas devolve uma situação desconhecida: com o id dele, a nota passa a PROCESSANDO", async () => {
      pn.modo = "sem-resposta";
      await emitir();
      const [n1] = await notasDb();
      pn.notas.set("pnY", { id: "pnY", idIntegracao: n1.id, situacao: "EM_FILA_XYZ" });
      const c = await consultar(n1.id);
      expect(c.json.status).toBe("PROCESSANDO");
      expect((await prisma.notaFiscal.findUnique({ where: { id: n1.id } })).plugnotasId).toBe("pnY");
    });

    it("situação que chega atrasada não sobrescreve quem já mudou a nota (consulta × outra consulta)", async () => {
      await emitir();
      const [velha] = await prisma.notaFiscal.findMany({ orderBy: { criadoEm: "asc" } });
      await prisma.notaFiscal.update({ where: { id: velha.id }, data: { status: "CONCLUIDO", numero: "1001" } });
      const { aplicarSituacao } = await import("@/lib/nfse/emissao-server");
      await aplicarSituacao(velha, { id: "pn0001", situacao: "REJEITADO", status: "REJEITADO", numero: null, codigoVerificacao: null, mensagem: "x", pdf: null, xml: null, autorizadaEm: null }, "u1");
      const agora = await prisma.notaFiscal.findUnique({ where: { id: velha.id }, include: { eventos: true } });
      expect([agora.status, agora.numero, agora.motivo]).toEqual(["CONCLUIDO", "1001", null]);
      expect(agora.eventos.map((e: any) => e.tipo)).toEqual(["ENVIO"]);
    });

    it("erro 500 do PlugNotas também é incerto (fica ENVIANDO, nunca reenvia sozinho)", async () => {
      pn.modo = "erro500";
      const r = await emitir();
      expect(r.json.notas.map((n: any) => n.status)).toEqual(["ENVIANDO", "ENVIANDO"]);
      expect(pn.envios).toHaveLength(2);
    });

    it("consulta no máximo a cada 5 s por nota; nota já resolvida não consulta", async () => {
      await emitir();
      const [n1] = await notasDb();
      const antes = pn.chamadas.length;
      await consultar(n1.id);
      await consultar(n1.id);
      expect(pn.chamadas.length - antes).toBe(1);
      expect((await prisma.notaFiscal.findUnique({ where: { id: n1.id } })).consultas).toBe(1);
      situar("pn0001", { situacao: "CONCLUIDO", numeroNfse: "9" });
      await prisma.notaFiscal.update({ where: { id: n1.id }, data: { ultimaConsultaEm: null } });
      await consultar(n1.id);
      const depois = pn.chamadas.length;
      await prisma.notaFiscal.update({ where: { id: n1.id }, data: { ultimaConsultaEm: null } });
      await consultar(n1.id);
      expect(pn.chamadas.length).toBe(depois);
    });

    it("PDF e XML: só da nota autorizada, buscados com o token pelo servidor e repassados", async () => {
      await emitir();
      const [n1] = await notasDb();
      expect((await arquivo(n1.id)).status).toBe(409);
      situar("pn0001", { situacao: "CONCLUIDO", numeroNfse: "1001" });
      await consultar(n1.id);
      const pdf = await arquivo(n1.id);
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get("content-type")).toBe("application/pdf");
      expect(pdf.headers.get("content-disposition")).toBe('inline; filename="nfse-1001.pdf"');
      expect(pdf.headers.get("cache-control")).toBe("private, no-store");
      expect(pdf.texto).toBe("%PDF-1.4 nota");
      expect(pn.chamadas.at(-1)).toEqual({ metodo: "GET", url: "/nfse/pdf/pn0001", chave: TOKEN });
      const xml = await arquivo(n1.id, "xml");
      expect([xml.status, xml.headers.get("content-disposition"), xml.texto]).toEqual([200, 'attachment; filename="nfse-1001.xml"', "<nfse/>"]);
      logar(SO_RECEBER);
      expect((await arquivo(n1.id)).status).toBe(200);
      logar(FISCAL, { empresaId: "e2" });
      expect((await arquivo(n1.id)).status).toBe(404);
    });

    it("pela OS: lista as notas da OS e grava a origem; OS fora da medição é recusada", async () => {
      expect((await emitir({ origem: "OS", ordemServicoId: "osX" })).status).toBe(400);
      const r = await emitir({ origem: "OS", ordemServicoId: "os1" });
      expect(r.status).toBe(201);
      expect((await notasDb()).map((n: any) => [n.origem, n.ordemServicoId])).toEqual([["OS", "os1"], ["OS", "os1"]]);
      // a OS só "tem" a medição m1 se entrou nela: a 2ª nota (Instalação) é da medição, não da OS, e aparece pela origem
      const l = await listar("osId=os1");
      expect(l.json.medicaoId).toBe("m1");
      expect(l.json.notas).toHaveLength(2);
    });
  });

  it("'Registrar NF emitida' à mão é recusado quando a medição já tem NFS-e viva (sem duplicar a NF); rejeitada não trava", async () => {
    const acao = async (corpo: unknown) => {
      const m = await import("@/app/api/medicoes/[id]/acao/route");
      const res: Response = await m.POST(new NextRequest("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }), { params: Promise.resolve({ id: "m1" }) });
      return { status: res.status, json: await res.json() as any };
    };
    await emitir();
    const r = await acao({ acao: "REGISTRAR_NF", nfNumero: "999" });
    expect(r).toEqual({ status: 409, json: { erro: "Esta medição já tem NFS-e emitida pelo sistema (veja “Notas fiscais (NFS-e)”). Não registre outra à mão." } });
    expect(await prisma.medicaoNf.count()).toBe(0);
    await prisma.notaFiscal.updateMany({ data: { status: "REJEITADO" } });
    expect((await acao({ acao: "REGISTRAR_NF", nfNumero: "999" })).status).toBe(200);
  });

  describe("RBAC e empresa da sessão", () => {
    it("emitir exige Financeiro › Fiscal; ver basta Medições (sem o botão); sem nenhum: 403; sem login: 401", async () => {
      logar(SO_MEDICOES);
      expect((await emitir()).status).toBe(403);
      const l = await listar();
      expect([l.status, l.json.podeEmitir, l.json.previa]).toEqual([200, false, null]); // sem "previa=1", sem a prévia
      logar(FISCAL);
      await emitir();
      const [n1] = await notasDb();
      logar(SO_MEDICOES);
      expect((await consultar(n1.id)).status).toBe(200); // quem vê a medição atualiza o status
      logar(SO_RECEBER);
      expect((await consultar(n1.id)).status).toBe(403);
      await prisma.notaFiscal.deleteMany({});
      pn.envios = [];
      logar(SO_MEDICOES);
      logar(SO_RECEBER);
      expect((await listar()).status).toBe(403);
      sessao.atual = null;
      expect((await listar()).status).toBe(401);
      expect(pn.envios).toEqual([]);
      logar({}, { role: "ADMIN" });
      expect((await emitir()).status).toBe(201);
    });

    it("medição/OS/nota de outra empresa: 404 e nada enviado", async () => {
      logar(FISCAL, { empresaId: "e2" });
      expect((await previa("m1")).status).toBe(404);
      expect((await listar()).status).toBe(404);
      expect((await emitir()).status).toBe(404);
      expect((await listar("osId=os1")).status).toBe(404);
      logar(FISCAL);
      await emitir();
      const [n1] = await notasDb();
      logar(FISCAL, { empresaId: "e2" });
      expect((await consultar(n1.id)).status).toBe(404);
      expect(pn.envios).toHaveLength(2);
      // a listagem também filtra pela empresa (além da conferência da rota)
      const { listarNotas } = await import("@/lib/nfse/emissao-server");
      expect(await listarNotas("e2", { medicaoId: "m1" })).toEqual([]);
      expect(await listarNotas("e1", { medicaoId: "m1" })).toHaveLength(2);
    });

    it("corpo com campos a mais (empresaId…) é recusado", async () => {
      expect((await emitir({ empresaId: "e2" })).status).toBe(400);
    });
  });
});
