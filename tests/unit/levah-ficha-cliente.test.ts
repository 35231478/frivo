/**
 * Leva H — Ficha do cliente profissional: as regras puras.
 *  - endereço principal (lib/clientes/endereco-principal): o que a consulta do CNPJ preenche, a linha única, e o
 *    local "Principal" criado com o cliente novo;
 *  - cabeçalho (lib/clientes/cabecalho): só o que importa (inadimplente com valor, contratos, a receber, inativo,
 *    satisfação) e o botão único "Novo ▾" pelo perfil;
 *  - histórico automático (lib/clientes/historico): ordem, repetidos, filtro, contagem, meses de Brasília, corte;
 *  - a ficha em consulta (lib/clientes/ficha): a seção "Endereço principal".
 */
import { describe, expect, it } from "vitest";
import {
  enderecoDaConsulta, enderecoPrincipalEmUmaLinha, localDoEnderecoPrincipal, locaisDoClienteNovo, mesmoEndereco, temEndereco,
} from "@/lib/clientes/endereco-principal";
import { itensDoNovo, sinaisDoCliente } from "@/lib/clientes/cabecalho";
import {
  agruparPorMes, contarPorTipo, filtrarEventos, montarHistorico, ordenarEventos, semRepetidos, ROTULO_TIPO_HISTORICO, TIPOS_HISTORICO,
  type EventoCliente,
} from "@/lib/clientes/historico";
import { secoesDaFicha } from "@/lib/clientes/ficha";

const CONSULTA = { cep: "74000-000", endereco: "Avenida Central", numero: "1000", complemento: "Sala 2", bairro: "Setor Central", cidade: "Goiânia", estado: "go" };

describe("endereço principal: o que a consulta do CNPJ preenche", () => {
  it("tudo vazio: preenche todos os campos (UF em maiúsculas, 2 letras)", () => {
    expect(enderecoDaConsulta(CONSULTA, {})).toEqual({ ...CONSULTA, estado: "GO" });
  });
  it("só os campos vazios: o que a pessoa já digitou fica (espaços contam como vazio)", () => {
    expect(enderecoDaConsulta(CONSULTA, { numero: "12", cidade: "Anápolis", bairro: "   ", cep: "" }))
      .toEqual({ cep: "74000-000", endereco: "Avenida Central", complemento: "Sala 2", bairro: "Setor Central", estado: "GO" });
  });
  it("a consulta sem endereço (ou só com brancos) não muda nada", () => {
    expect(enderecoDaConsulta({}, {})).toEqual({});
    expect(enderecoDaConsulta({ endereco: "  ", cidade: null }, {})).toEqual({});
  });
  it("UF vinda por extenso é cortada em 2 letras; os textos chegam sem os espaços das pontas", () => {
    expect(enderecoDaConsulta({ estado: " goias ", endereco: " Rua A " }, {})).toEqual({ estado: "GO", endereco: "Rua A" });
  });
});

describe("endereço principal: tem endereço e a linha única", () => {
  it("rua, CEP ou cidade bastam; só número ou bairro não", () => {
    expect(temEndereco({ endereco: "Rua A" })).toBe(true);
    expect(temEndereco({ cep: "74000-000" })).toBe(true);
    expect(temEndereco({ cidade: "Goiânia" })).toBe(true);
    expect(temEndereco({ numero: "10", bairro: "Centro", complemento: "Sala 1", estado: "GO" })).toBe(false);
    expect(temEndereco({ endereco: "  ", cidade: null })).toBe(false);
  });
  it("só o que existe, na ordem rua, número — complemento · bairro · cidade/UF · CEP", () => {
    expect(enderecoPrincipalEmUmaLinha({ ...CONSULTA, estado: "GO" })).toBe("Avenida Central, 1000 — Sala 2 · Setor Central · Goiânia/GO · CEP 74000-000");
    expect(enderecoPrincipalEmUmaLinha({ endereco: "Rua A", cidade: "Goiânia" })).toBe("Rua A · Goiânia");
    expect(enderecoPrincipalEmUmaLinha({ cidade: "Goiânia", estado: "GO" })).toBe("Goiânia/GO");
    expect(enderecoPrincipalEmUmaLinha({})).toBe("");
  });
});

describe("endereço principal: o local \"Principal\" do cliente novo", () => {
  const ENDERECO = { endereco: "Avenida Central", numero: "1000", complemento: "Sala 2", bairro: "Setor Central", cidade: "Goiânia", estado: "go", cep: "74000-000" };
  it("com endereço e sem locais informados: o local Principal, com o endereço e a UF em maiúsculas", () => {
    expect(localDoEnderecoPrincipal(ENDERECO)).toEqual({
      nome: "Principal", principal: true, logradouro: "Avenida Central", numero: "1000", complemento: "Sala 2",
      bairro: "Setor Central", cidade: "Goiânia", estado: "GO", cep: "74000-000",
    });
  });
  it("campos vazios ficam de fora (undefined), não viram texto vazio", () => {
    expect(localDoEnderecoPrincipal({ cidade: "Goiânia" })).toEqual({
      nome: "Principal", principal: true, logradouro: undefined, numero: undefined, complemento: undefined,
      bairro: undefined, cidade: "Goiânia", estado: undefined, cep: undefined,
    });
  });
  it("sem endereço principal: nada", () => {
    expect(localDoEnderecoPrincipal({ numero: "10" })).toBeNull();
    expect(locaisDoClienteNovo({}, [{ logradouro: "Rua B", numero: "5", principal: true }]))
      .toEqual({ principal: null, locais: [{ logradouro: "Rua B", numero: "5", principal: true }] });
  });
  it("um local informado que já é o mesmo endereço: não duplica (fica o informado, como veio)", () => {
    const igual = { logradouro: "avenida  central", numero: "1000", principal: true };
    expect(localDoEnderecoPrincipal(ENDERECO, [igual])).toBeNull();
    expect(locaisDoClienteNovo(ENDERECO, [igual])).toEqual({ principal: null, locais: [igual] });
  });
  it("outros locais: o Principal vem do endereço e os informados entram como secundários", () => {
    const r = locaisDoClienteNovo(ENDERECO, [{ logradouro: "Rua dos Ipês", numero: "80", principal: true }]);
    expect(r.principal?.nome).toBe("Principal");
    expect(r.locais).toEqual([{ logradouro: "Rua dos Ipês", numero: "80", principal: false }]);
  });
  it("mesmo lugar: rua + número, ou CEP + número (sem acento, caixa ou pontuação); número diferente não é", () => {
    expect(mesmoEndereco({ logradouro: "Av. Central", numero: "1000" }, { endereco: "AV CENTRAL", numero: "1000" })).toBe(true);
    expect(mesmoEndereco({ logradouro: "Rua São João", numero: "1" }, { endereco: "rua sao joao", numero: "1" })).toBe(true);
    expect(mesmoEndereco({ cep: "74000000", numero: "1000" }, { cep: "74000-000", numero: "1000" })).toBe(true);
    expect(mesmoEndereco({ logradouro: "Av. Central", numero: "999" }, { endereco: "Av. Central", numero: "1000" })).toBe(false);
    expect(mesmoEndereco({ logradouro: "Rua X", numero: "1000" }, { endereco: "Av. Central", numero: "1000" })).toBe(false);
    // sem rua nem CEP dos dois lados, não dá para dizer: não é o mesmo
    expect(mesmoEndereco({ numero: "1" }, { numero: "1" })).toBe(false);
    expect(mesmoEndereco({ logradouro: "", cep: "", numero: "" }, { endereco: "", cep: "", numero: "" })).toBe(false);
  });
});

describe("cabeçalho: só o que importa", () => {
  const base = { clienteId: "c1", ativo: true, valorEmAtraso: 0, totalProximos30Dias: 0, contratosAtivos: 0 };
  it("cliente ativo, adimplente, sem contrato, sem nada a receber e sem avaliação: nenhum sinal", () => {
    expect(sinaisDoCliente(base)).toEqual([]);
    expect(sinaisDoCliente({ ...base, satisfacao: { media: null, avaliacoes: 0 } })).toEqual([]);
  });
  it("inadimplente: com o valor em atraso; vira link às contas vencidas só para quem vê o contas a receber", () => {
    expect(sinaisDoCliente({ ...base, valorEmAtraso: 2950 })).toEqual([{ id: "inadimplente", rotulo: "Inadimplente · R$ 2.950,00 em atraso", tom: "atrasado" }]);
    expect(sinaisDoCliente({ ...base, valorEmAtraso: 2950, podeVerReceber: true })[0].href)
      .toBe("/financeiro/contas-receber?clienteId=c1&card=VENCIDO&periodo=todos");
  });
  it("frações de centavo não acendem o sinal (0,004 é zero)", () => {
    expect(sinaisDoCliente({ ...base, valorEmAtraso: 0.004, totalProximos30Dias: 0.004 })).toEqual([]);
    expect(sinaisDoCliente({ ...base, valorEmAtraso: 0.006 })[0].rotulo).toBe("Inadimplente · R$ 0,01 em atraso");
  });
  it("contratos: singular e plural; link para os contratos ATIVOS do cliente só para quem vê contratos", () => {
    // pj4 (H17, mudança intencional): antes o link ia a /contratos?clienteId= para todos e sem o filtro de ativos
    expect(sinaisDoCliente({ ...base, contratosAtivos: 1 })).toEqual([{ id: "contratos", rotulo: "1 contrato ativo", tom: "ok" }]);
    expect(sinaisDoCliente({ ...base, contratosAtivos: 1, podeVerContratos: true })[0].href).toBe("/contratos?clienteId=c1&status=ATIVO");
    expect(sinaisDoCliente({ ...base, contratosAtivos: 3 })[0].rotulo).toBe("3 contratos ativos");
  });
  it("a receber nos próximos 30 dias: só com valor", () => {
    expect(sinaisDoCliente({ ...base, totalProximos30Dias: 1200.5 })).toEqual([{ id: "aReceber", rotulo: "A receber em 30 dias · R$ 1.200,50", tom: "acento" }]);
  });
  it("satisfação: a média do aceite e quantas avaliações, com a origem no título", () => {
    expect(sinaisDoCliente({ ...base, satisfacao: { media: 4.65, avaliacoes: 12 } })).toEqual([
      { id: "satisfacao", rotulo: "★ 4,7 (12)", tom: "previsto", titulo: "Média 4,7 de 5 em 12 avaliações no aceite das OS" },
    ]);
    expect(sinaisDoCliente({ ...base, satisfacao: { media: 4, avaliacoes: 0 } })).toEqual([]);
  });
  it("todos juntos, na ordem: inativo, inadimplente, contratos, a receber, satisfação", () => {
    const s = sinaisDoCliente({ clienteId: "c1", ativo: false, valorEmAtraso: 10, totalProximos30Dias: 20, contratosAtivos: 2, satisfacao: { media: 5, avaliacoes: 1 } });
    expect(s.map((x) => x.id)).toEqual(["inativo", "inadimplente", "contratos", "aReceber", "satisfacao"]);
    expect(s[0]).toEqual({ id: "inativo", rotulo: "Inativo", tom: "previsto" });
  });
});

describe("cabeçalho: o botão único \"Novo ▾\"", () => {
  const so = (...p: string[]) => (m: string, a: string) => p.includes(`${m}.${a}`);
  it("com tudo: OS, orçamento, contrato e envio de documentação, já com o cliente", () => {
    expect(itensDoNovo("c 1", true, () => true)).toEqual([
      { id: "os", rotulo: "Ordem de serviço", href: "/ordens/nova?clienteId=c%201" },
      { id: "orcamento", rotulo: "Orçamento", href: "/orcamentos/novo?clienteId=c%201" },
      { id: "contrato", rotulo: "Contrato", href: "/contratos/novo?clienteId=c%201" },
      { id: "documentacao", rotulo: "Envio de documentação da equipe", href: "/documentacao-equipe/novo?clienteId=c%201" },
    ]);
  });
  it("cada item pela sua permissão de criar (documentação: enviar)", () => {
    expect(itensDoNovo("c1", true, so("ordens.criar")).map((i) => i.id)).toEqual(["os"]);
    expect(itensDoNovo("c1", true, so("orcamentos.criar")).map((i) => i.id)).toEqual(["orcamento"]);
    expect(itensDoNovo("c1", true, so("contratos.criar")).map((i) => i.id)).toEqual(["contrato"]);
    expect(itensDoNovo("c1", true, so("documentos.enviar")).map((i) => i.id)).toEqual(["documentacao"]);
    expect(itensDoNovo("c1", true, so("ordens.editar", "contratos.visualizar"))).toEqual([]);
  });
  it("cliente inativo: nada a criar (sem botão)", () => {
    expect(itensDoNovo("c1", false, () => true)).toEqual([]);
  });
});

const ev = (id: string, tipo: EventoCliente["tipo"], iso: string): EventoCliente => ({ id, tipo, titulo: id, quando: new Date(iso) });

describe("histórico automático", () => {
  it("mais recente primeiro; empate pelo id; data inválida fica de fora", () => {
    const xs = [ev("b", "os", "2026-11-10T12:00:00Z"), ev("a", "os", "2026-11-10T12:00:00Z"), ev("c", "nota", "2026-11-20T12:00:00Z"), ev("x", "os", "nada")];
    expect(ordenarEventos(xs).map((e) => e.id)).toEqual(["c", "a", "b"]);
  });
  it("o mesmo evento (mesmo id) vindo duas vezes: fica o primeiro", () => {
    const xs = [{ ...ev("a", "os", "2026-11-10T12:00:00Z"), titulo: "1º" }, { ...ev("a", "os", "2026-11-11T12:00:00Z"), titulo: "2º" }, ev("b", "os", "2026-11-12T12:00:00Z")];
    expect(semRepetidos(xs).map((e) => e.titulo)).toEqual(["1º", "b"]);
  });
  it("filtro: \"todos\" devolve tudo (cópia); um tipo, só ele", () => {
    const xs = [ev("a", "os", "2026-11-10T12:00:00Z"), ev("b", "nota", "2026-11-11T12:00:00Z")];
    const todos = filtrarEventos(xs, "todos");
    expect(todos).toEqual(xs);
    expect(todos).not.toBe(xs);
    expect(filtrarEventos(xs, "nota").map((e) => e.id)).toEqual(["b"]);
    expect(filtrarEventos(xs, "portal")).toEqual([]);
  });
  it("contagem por tipo: só os tipos com algo", () => {
    expect(contarPorTipo([ev("a", "os", "2026-11-10T12:00:00Z"), ev("b", "os", "2026-11-11T12:00:00Z"), ev("c", "portal", "2026-11-11T12:00:00Z")]))
      .toEqual({ os: 2, portal: 1 });
    expect(contarPorTipo([])).toEqual({});
  });
  it("por mês no fuso de Brasília: 1º/12 às 01:00 UTC ainda é novembro aqui; grupos na ordem recebida", () => {
    const xs = [ev("a", "os", "2026-12-01T03:00:00Z"), ev("b", "os", "2026-12-01T01:00:00Z"), ev("c", "os", "2026-11-15T12:00:00Z"), ev("d", "os", "2025-01-10T12:00:00Z")];
    expect(agruparPorMes(xs).map((g) => [g.chave, g.rotulo, g.eventos.map((e) => e.id)])).toEqual([
      ["2026-12", "Dezembro de 2026", ["a"]],
      ["2026-11", "Novembro de 2026", ["b", "c"]],
      ["2025-01", "Janeiro de 2025", ["d"]],
    ]);
    expect(agruparPorMes([])).toEqual([]);
  });
  it("montar: sem repetidos, ordenado e cortado no limite (ficam as mais recentes)", () => {
    const xs = [ev("a", "os", "2026-11-01T12:00:00Z"), ev("b", "os", "2026-11-03T12:00:00Z"), ev("b", "os", "2026-11-09T12:00:00Z"), ev("c", "os", "2026-11-02T12:00:00Z")];
    expect(montarHistorico(xs, 2).map((e) => e.id)).toEqual(["b", "c"]);
    expect(montarHistorico(xs).map((e) => e.id)).toEqual(["b", "c", "a"]);
  });
  it("cada tipo tem rótulo no filtro", () => {
    for (const t of TIPOS_HISTORICO) expect(ROTULO_TIPO_HISTORICO[t]).toBeTruthy();
    expect(TIPOS_HISTORICO).toContain("nota");
  });
});

describe("ficha em consulta: a seção Endereço principal", () => {
  it("logo depois da identificação, numa linha; sem endereço, a seção some", () => {
    const comEnd = secoesDaFicha({ nome: "Clínica", tipoPessoa: "JURIDICA", endereco: "Av. Brasil", numero: "900", cidade: "São Paulo", estado: "SP" });
    expect(comEnd.map((s) => s.id).slice(0, 2)).toEqual(["identificacao", "endereco"]);
    expect(comEnd[1]).toEqual({ id: "endereco", titulo: "Endereço principal", linhas: [{ rotulo: "Endereço", valor: "Av. Brasil, 900 · São Paulo/SP" }] });
    expect(secoesDaFicha({ nome: "Clínica", tipoPessoa: "JURIDICA" }).map((s) => s.id)).not.toContain("endereco");
  });
});
