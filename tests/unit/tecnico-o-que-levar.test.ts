/**
 * App do técnico — "O que levar" (materiais previstos) e "Como chegar" (rota): as REGRAS PURAS.
 *
 *  O QUE LEVAR
 *  - vem só do que o sistema já grava: materiais lançados na linha de serviço da OS, a composição
 *    padrão do serviço (quando a linha não tem material lançado) e as peças vendidas na OS;
 *  - "não usado" (quantidade 0), já consumido/devolvido no estoque e linha já executada não entram;
 *  - serviço sem composição não gera material (nada é inventado);
 *  - soma por produto + unidade, por OS e por dia (cada OS conta uma vez; concluída não entra);
 *  - nenhum valor passa por aqui.
 *
 *  COMO CHEGAR
 *  - URL universal de mapas (Google, Waze, Mapas da Apple), sem chave de API;
 *  - coordenadas quando há, senão o endereço; sem nada, sem link;
 *  - o Mapas da Apple só é oferecido em aparelho da Apple.
 */
import { describe, expect, it } from "vitest";
import {
  chaveDoMaterial, formatarQuantidade, materiaisPrevistosDaOs, oQueLevarNoDia, quantidadeComUnidade, resumoDoQueLevar, somarMateriais,
  type LinhaDaOs, type MaterialPrevisto,
} from "@/lib/tecnico/o-que-levar";
import { APPS_ROTA, appsDeRota, ehAparelhoApple, ehAppRota, linkApple, linkDoApp, linkRota, linkWaze } from "@/lib/tecnico/cartao";
import { CONFIG_APP_PADRAO, SELECT_CONFIG_APP, configAppParaPayload, normalizarConfigApp } from "@/lib/tecnico/config-app";

const servico = (x: Partial<LinhaDaOs> = {}): LinhaDaOs => ({ tipo: "SERVICO", executado: false, descricao: "Limpeza de split", quantidade: 1, materialId: null, produto: null, materiais: [], composicao: null, ...x });
const produto = (x: Partial<LinhaDaOs> = {}): LinhaDaOs => ({ tipo: "PRODUTO", executado: false, descricao: "Capacitor 35uF", quantidade: 1, materialId: null, produto: null, materiais: [], composicao: null, ...x });
const mat = (descricao: string, quantidade: unknown, x: Record<string, unknown> = {}) => ({ produtoId: null as string | null, descricao, unidade: "un" as string | null, quantidade, ...x });
const lista = (ms: MaterialPrevisto[]) => ms.map((m) => `${m.descricao}:${m.quantidade}:${m.unidade}`);
const FILTRO = { id: "pFiltro", nome: "Filtro G4", unidade: "un", ativo: true, categoriaProduto: null };
const GAS = { id: "pGas", nome: "Gás R410A", unidade: "kg", ativo: true, categoriaProduto: null };
const FITA = { id: "pFita", nome: "Fita isolante", unidade: "rl", ativo: false, categoriaProduto: null };

describe("O que levar — os materiais previstos de UMA OS", () => {
  it("materiais LANÇADOS na linha do serviço valem na quantidade lançada; 'não usado' (quantidade 0) não entra", () => {
    const os = [servico({ materiais: [mat("Filtro G4", 2, { produtoId: "pFiltro" }), mat("Gás R410A", "1.500", { produtoId: "pGas", unidade: "kg" }), mat("Fita isolante", 0, { produtoId: "pFita" })] })];
    expect(lista(materiaisPrevistosDaOs(os))).toEqual(["Filtro G4:2:un", "Gás R410A:1.5:kg"]);
  });

  it("com material lançado, a composição do cadastro NÃO é somada por cima (vale o que está na OS)", () => {
    const os = [servico({ materiais: [mat("Filtro G4", 1, { produtoId: "pFiltro" })], composicao: [{ produtoId: "pFiltro", quantidade: 4, produto: FILTRO }, { produtoId: "pGas", quantidade: 1, produto: GAS }] })];
    expect(lista(materiaisPrevistosDaOs(os))).toEqual(["Filtro G4:1:un"]);
    // Tudo marcado "não usado": o escritório decidiu que não vai material — a composição não volta
    expect(materiaisPrevistosDaOs([servico({ materiais: [mat("Filtro G4", 0, { produtoId: "pFiltro" })], composicao: [{ produtoId: "pFiltro", quantidade: 4, produto: FILTRO }] })])).toEqual([]);
  });

  it("serviço do catálogo SEM material lançado: vale a composição padrão — produto solto e KIT aberto nos seus itens (quantidade do item × kits)", () => {
    const kit = { id: "k1", nome: "Kit limpeza", ativo: true, itens: [{ produtoId: "pFita", quantidade: "0.500", produto: FITA }, { produtoId: "pFiltro", quantidade: 1, produto: FILTRO }] };
    const os = [servico({ composicao: [{ produtoId: "pFiltro", quantidade: 2, produto: FILTRO }, { kitId: "k1", quantidade: 2, kit }] })];
    // Filtro: 2 soltos + 1 × 2 kits = 4; fita: 0,5 × 2 kits = 1 (produto inativo continua valendo na composição)
    expect(lista(materiaisPrevistosDaOs(os))).toEqual(["Filtro G4:4:un", "Fita isolante:1:rl"]);
  });

  it("serviço SEM composição (ou linha livre) não gera material: nada é inventado", () => {
    expect(materiaisPrevistosDaOs([servico(), servico({ composicao: [] }), servico({ descricao: "Mão de obra avulsa" })])).toEqual([]);
    expect(materiaisPrevistosDaOs([])).toEqual([]);
    // Composição com produto ou kit que não carrega (removido do catálogo): ignorada
    expect(materiaisPrevistosDaOs([servico({ composicao: [{ produtoId: "pX", quantidade: 1, produto: null }, { kitId: "kX", quantidade: 1, kit: null }] })])).toEqual([]);
  });

  it("PEÇA vendida na OS (linha de produto) entra; a que só espelha um material do serviço NÃO entra de novo", () => {
    const os = [
      servico({ materiais: [mat("Capacitor 35uF", 1, { produtoId: "pCap" })] }),
      produto({ materialId: "m1", descricao: "Capacitor 35uF", produto: { id: "pCap", nome: "Capacitor 35uF", unidade: "un" } }), // espelho da peça do serviço
      produto({ descricao: "Compressor rotativo 12k", quantidade: 1, produto: { id: "pComp", nome: "Compressor rotativo 12.000 BTU", unidade: "pç" } }),
      produto({ descricao: "Suporte de condensadora", quantidade: "2" }), // linha livre: sem produto do catálogo
    ];
    expect(lista(materiaisPrevistosDaOs(os))).toEqual(["Capacitor 35uF:1:un", "Compressor rotativo 12.000 BTU:1:pç", "Suporte de condensadora:2:un"]);
  });

  it("linha já EXECUTADA e material que o estoque já deu como CONSUMIDO ou DEVOLVIDO não entram (já foi levado); SEPARADO entra", () => {
    const os = [
      servico({ executado: true, materiais: [mat("Filtro G4", 2, { produtoId: "pFiltro" })] }),
      produto({ executado: true, descricao: "Peça já entregue" }),
      servico({ materiais: [
        mat("Gás R410A", 1, { produtoId: "pGas", unidade: "kg", estadoSeparacao: "CONSUMIDO" }), mat("Fita isolante", 1, { produtoId: "pFita", estadoSeparacao: "DEVOLVIDO" }),
        mat("Dreno", 3, { unidade: "m", estadoSeparacao: "SEPARADO" }), mat("Abraçadeira", 4, { estadoSeparacao: null }),
      ] }),
    ];
    expect(lista(materiaisPrevistosDaOs(os))).toEqual(["Abraçadeira:4:un", "Dreno:3:m"]);
  });

  it("o mesmo produto em duas linhas da OS é SOMADO; unidade diferente não se mistura; sem unidade vira 'un'", () => {
    const os = [
      servico({ materiais: [mat("Filtro G4", 2, { produtoId: "pFiltro" }), mat("Gás R410A", 0.4, { produtoId: "pGas", unidade: "kg" })] }),
      servico({ descricao: "Higienização", materiais: [mat("Filtro G4 (595x595)", 1, { produtoId: "pFiltro" }), mat("Gás R410A", 1, { produtoId: "pGas", unidade: "lata" }), mat("  Pano  ", 1, { unidade: null })] }),
    ];
    // A descrição que fica é a da primeira vez que o produto aparece
    expect(lista(materiaisPrevistosDaOs(os))).toEqual(["Filtro G4:3:un", "Gás R410A:0.4:kg", "Gás R410A:1:lata", "Pano:1:un"]);
  });

  it("quantidade inválida, negativa ou descrição vazia não entram; a soma não acumula erro de ponto flutuante", () => {
    expect(materiaisPrevistosDaOs([servico({ materiais: [mat("X", "abc"), mat("Y", -2), mat("   ", 3), mat("Z", null)] })])).toEqual([]);
    const os = [servico({ materiais: [mat("Gás", 0.1, { unidade: "kg" })] }), servico({ materiais: [mat("Gás", 0.2, { unidade: "kg" })] })];
    expect(materiaisPrevistosDaOs(os)[0].quantidade).toBe(0.3);
  });

  it("NENHUM valor sai: o material previsto só tem identidade, descrição, unidade e quantidade", () => {
    const comValor = { ...mat("Filtro G4", 2, { produtoId: "pFiltro" }), valorVendaUnit: 89.9, custoUnit: 41.2 };
    const [m] = materiaisPrevistosDaOs([servico({ materiais: [comValor] })]);
    expect(Object.keys(m).sort()).toEqual(["chave", "descricao", "quantidade", "unidade"]);
    expect(JSON.stringify(m)).not.toMatch(/89|41|valor|custo/i);
  });
});

describe("O que levar — soma e identidade", () => {
  it("a identidade é o produto + unidade; na linha livre, a descrição sem acento, caixa e espaço sobrando", () => {
    expect(chaveDoMaterial("pFiltro", "Filtro G4", "un")).toBe("p:pFiltro|un");
    expect(chaveDoMaterial("pFiltro", "outro nome", " UN ")).toBe("p:pFiltro|un");
    expect(chaveDoMaterial(null, "  Abraçadeira   de Nylon ", null)).toBe("d:abracadeira de nylon|un");
    expect(chaveDoMaterial(null, "ABRACADEIRA DE NYLON", "un")).toBe(chaveDoMaterial(null, "abraçadeira de nylon", "Un"));
    expect(chaveDoMaterial(null, "Dreno", "m")).not.toBe(chaveDoMaterial(null, "Dreno", "un"));
  });

  it("somar: junta pela identidade, em ordem alfabética (português, número como número), e ignora lista vazia", () => {
    const a: MaterialPrevisto[] = [{ chave: "p:1|un", descricao: "Filtro 10", unidade: "un", quantidade: 1 }, { chave: "p:2|un", descricao: "Ácido", unidade: "un", quantidade: 2 }];
    const b: MaterialPrevisto[] = [{ chave: "p:1|un", descricao: "Filtro 10", unidade: "un", quantidade: 2.5 }, { chave: "p:3|un", descricao: "Filtro 2", unidade: "un", quantidade: 1 }, { chave: "p:4|un", descricao: "Zero", unidade: "un", quantidade: 0 }];
    expect(lista(somarMateriais([a, null, undefined, [], b]))).toEqual(["Ácido:2:un", "Filtro 2:1:un", "Filtro 10:3.5:un"]);
    expect(a[0].quantidade).toBe(1); // as listas de entrada não são alteradas
  });
});

describe("O que levar — por DIA", () => {
  const filtro = (q: number): MaterialPrevisto => ({ chave: "p:pFiltro|un", descricao: "Filtro G4", unidade: "un", quantidade: q });
  const gas = (q: number): MaterialPrevisto => ({ chave: "p:pGas|kg", descricao: "Gás R410A", unidade: "kg", quantidade: q });
  const c = (id: string, osId: string, status: string, materiais?: MaterialPrevisto[] | null) => ({ id, osId, status, materiais });

  it("soma os materiais das OS do dia — para carregar o veículo uma vez", () => {
    const dia = [c("a1", "os1", "AGENDADA", [filtro(2), gas(1)]), c("a2", "os2", "AGENDADA", [filtro(1)]), c("a3", "os3", "EM_ANDAMENTO", [gas(0.5)])];
    expect(oQueLevarNoDia(dia)).toEqual({ itens: [{ ...filtro(3) }, { ...gas(1.5) }], os: 3 });
  });

  it("cada OS conta UMA vez: duas atividades da mesma OS no dia não dobram o material", () => {
    const dia = [c("a1", "os1", "AGENDADA", [filtro(2)]), c("a2", "os1", "AGENDADA", [filtro(2)]), c("a3", "os2", "AGENDADA", [filtro(1)])];
    expect(oQueLevarNoDia(dia)).toEqual({ itens: [filtro(3)], os: 2 });
  });

  it("atividade CONCLUÍDA ou CANCELADA não entra; OS sem material não conta como OS", () => {
    const dia = [c("a1", "os1", "CONCLUIDA", [filtro(2)]), c("a2", "os2", "CANCELADA", [filtro(5)]), c("a3", "os3", "AGENDADA", [gas(1)]), c("a4", "os4", "AGENDADA", []), c("a5", "os5", "AGENDADA"), c("a6", "os6", "AGENDADA", null)];
    expect(oQueLevarNoDia(dia)).toEqual({ itens: [gas(1)], os: 1 });
    expect(oQueLevarNoDia([])).toEqual({ itens: [], os: 0 });
  });

  it("a mesma OS com uma atividade concluída e outra por fazer: ainda conta (pela que falta)", () => {
    expect(oQueLevarNoDia([c("a1", "os1", "CONCLUIDA", [filtro(2)]), c("a2", "os1", "AGENDADA", [filtro(2)])])).toEqual({ itens: [filtro(2)], os: 1 });
  });

  it("a tela informa a situação que o técnico já gravou no aparelho: concluiu sem sinal → sai da conta", () => {
    const dia = [c("a1", "os1", "AGENDADA", [filtro(2)]), c("a2", "os2", "AGENDADA", [filtro(1)])];
    expect(oQueLevarNoDia(dia, (x) => (x.id === "a1" ? "CONCLUIDA" : x.status))).toEqual({ itens: [filtro(1)], os: 1 });
  });
});

describe("O que levar — como o técnico lê", () => {
  it("quantidade no padrão brasileiro, até 3 casas, sem zero sobrando e sem separador de milhar", () => {
    expect([4, 2.5, 0.125, 1.5004, 1200, 0, Number.NaN].map(formatarQuantidade)).toEqual(["4", "2,5", "0,125", "1,5", "1200", "0", "0"]);
    expect(quantidadeComUnidade({ quantidade: 2.5, unidade: "kg" })).toBe("2,5 kg");
    expect(quantidadeComUnidade({ quantidade: 4, unidade: "un" })).toBe("4 un");
  });

  it("resumo do dia: singular e plural", () => {
    expect(resumoDoQueLevar(1, 1)).toBe("1 material para 1 OS");
    expect(resumoDoQueLevar(5, 3)).toBe("5 materiais para 3 OS");
    expect(resumoDoQueLevar(2, 1)).toBe("2 materiais para 1 OS");
  });
});

describe("opção por empresa: Mostrar 'O que levar'", () => {
  it("nasce LIGADA; a coluna app_o_que_levar entra na leitura, no payload e volta igual", () => {
    expect(CONFIG_APP_PADRAO.oQueLevar).toBe(true);
    expect(SELECT_CONFIG_APP.appOQueLevar).toBe(true);
    expect(normalizarConfigApp(null).oQueLevar).toBe(true);
    expect(normalizarConfigApp({ appOQueLevar: false }).oQueLevar).toBe(false);
    expect(normalizarConfigApp({ appAvisarCliente: false }).oQueLevar).toBe(true); // coluna ausente da leitura: padrão
    const desligada = { ...CONFIG_APP_PADRAO, oQueLevar: false };
    expect(configAppParaPayload(desligada).appOQueLevar).toBe(false);
    expect(normalizarConfigApp(configAppParaPayload(desligada))).toEqual(desligada);
  });
});

describe("Como chegar — URL universal de mapas (sem chave de API)", () => {
  const comCoord = linkRota({ logradouro: "Av. Paulista", numero: "1000", cidade: "São Paulo", estado: "SP", latitude: -23.5614, longitude: -46.6559 })!;
  const semCoord = linkRota({ logradouro: "Rua das Flores", numero: "12", bairro: "Centro", cidade: "Campinas", estado: "SP", cep: "13010-000" })!;

  it("o destino são as COORDENADAS da unidade quando há; senão o endereço escrito; sem nada, sem link", () => {
    expect(comCoord).toBe("https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=-23.5614%2C-46.6559");
    expect(new URL(semCoord).searchParams.get("destination")).toBe("Rua das Flores, 12 — Centro, Campinas/SP 13010-000");
    expect(linkRota({})).toBeNull();
    expect(linkRota(null)).toBeNull();
    expect(linkRota({ latitude: 0, longitude: 0 })).toBeNull(); // coordenada zerada não é endereço
    for (const link of [comCoord, semCoord]) expect(link).not.toMatch(/key=|apikey|token/i);
  });

  it("Mapas da Apple: o mesmo destino, já com a rota de carro; Waze idem; link quebrado não vira rota", () => {
    expect(linkApple(comCoord)).toBe("https://maps.apple.com/?daddr=-23.5614%2C-46.6559&dirflg=d");
    expect(new URL(linkApple(semCoord)!).searchParams.get("daddr")).toBe("Rua das Flores, 12 — Centro, Campinas/SP 13010-000");
    expect(linkWaze(comCoord)).toBe("https://waze.com/ul?ll=-23.5614%2C-46.6559&navigate=yes");
    expect(linkWaze(semCoord)).toMatch(/^https:\/\/waze\.com\/ul\?q=Rua%20das%20Flores/);
    for (const ruim of [null, undefined, "", "não é link", "https://www.google.com/maps/dir/?api=1"]) { expect(linkApple(ruim), String(ruim)).toBeNull(); expect(linkWaze(ruim), String(ruim)).toBeNull(); }
  });

  it("o link do app escolhido; app que não consegue abrir o destino cai no Google", () => {
    expect(linkDoApp(comCoord, "google")).toBe(comCoord);
    expect(linkDoApp(comCoord, "waze")).toBe(linkWaze(comCoord));
    expect(linkDoApp(comCoord, "apple")).toBe(linkApple(comCoord));
    const semDestino = "https://www.google.com/maps/dir/?api=1";
    expect(linkDoApp(semDestino, "apple")).toBe(semDestino);
    expect(linkDoApp(semDestino, "waze")).toBe(semDestino);
  });

  it("o Mapas da Apple só é oferecido em iPhone, iPad e Mac; Android e Windows veem Google Maps e Waze", () => {
    const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
    const IPAD = "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15";
    const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
    const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
    expect([IPHONE, IPAD, MAC].map(ehAparelhoApple)).toEqual([true, true, true]);
    expect([ANDROID, WINDOWS, "", null, undefined].map(ehAparelhoApple)).toEqual([false, false, false, false, false]);
    expect(appsDeRota(true).map((a) => a.nome)).toEqual(["Google Maps", "Waze", "Mapas da Apple"]);
    expect(appsDeRota(false).map((a) => a.id)).toEqual(["google", "waze"]);
    expect(APPS_ROTA.map((a) => a.id)).toEqual(["google", "waze", "apple"]);
    expect(["google", "waze", "apple"].every(ehAppRota)).toBe(true);
    expect(["bing", "", null, undefined, 3].some(ehAppRota)).toBe(false);
  });
});
