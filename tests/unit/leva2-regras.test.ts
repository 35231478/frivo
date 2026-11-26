/**
 * LEVA 2 — pontas soltas do dia a dia: as regras puras.
 *  - Estoque: saldo 0 é "Sem estoque" (antes, sem mínimo cadastrado, aparecia "OK");
 *  - Histórico da OS: o resumo do gestor agrupa o que se repete, junta o status automático à causa e
 *    traduz os códigos — sem perder registro nenhum (a auditoria fica em `itens`);
 *  - Gráfico do financeiro: um eixo que começa no zero, marcas redondas, rótulos curtos, ano no mês;
 *  - Ficha do cliente: o cadastro como texto, só com o que está preenchido.
 */
import { describe, expect, it } from "vitest";
import { avisosEstoque, ROTULO_SITUACAO_ESTOQUE, situacaoEstoque } from "@/lib/estoque/regras";
import { resumirHistorico, textoStatusOs, traduzir, PAUSA_AGRUPAR_MS, type EventoHistorico } from "@/lib/os/historico";
import { escalaEixo, moedaCurta, montarSerie } from "@/lib/financeiro/grafico-meses";
import { emOrdem, enderecoEmUmaLinha, meiosDoContato, secoesDaFicha } from "@/lib/clientes/ficha";

/* ───────────────────────── estoque ───────────────────────── */

describe("estoque: a situação reflete o saldo", () => {
  it("saldo 0 é Sem estoque — com ou sem mínimo cadastrado (o bug: sem mínimo, aparecia OK)", () => {
    expect(situacaoEstoque(0, null)).toBe("zerado");
    expect(situacaoEstoque(0, undefined)).toBe("zerado");
    expect(situacaoEstoque(0, 5)).toBe("zerado");
    expect(situacaoEstoque(0, 0)).toBe("zerado");
    expect(ROTULO_SITUACAO_ESTOQUE.zerado).toBe("Sem estoque");
  });

  it("a ordem de gravidade: negativo › sem estoque › abaixo do mínimo › em estoque", () => {
    expect(situacaoEstoque(-1, 5)).toBe("negativo");
    expect(situacaoEstoque(-0.001, null)).toBe("negativo");
    expect(situacaoEstoque(0.5, 5)).toBe("abaixo");
    expect(situacaoEstoque(5, 5)).toBe("abaixo"); // no mínimo conta como abaixo: hora de repor
    expect(situacaoEstoque(5.001, 5)).toBe("ok");
    expect(situacaoEstoque(12, null)).toBe("ok");
    expect(ROTULO_SITUACAO_ESTOQUE).toEqual({ negativo: "Saldo negativo", zerado: "Sem estoque", abaixo: "Abaixo do mínimo", ok: "Em estoque" });
  });

  it("sobra de conta decimal é zero (o saldo tem 3 casas)", () => {
    expect(situacaoEstoque(0.0001, null)).toBe("zerado");
    expect(situacaoEstoque(-0.0001, null)).toBe("zerado");
    expect(situacaoEstoque(0.001, null)).toBe("ok");
  });

  it("o aviso do topo: uma frase por situação, do mais grave ao mais brando, cada uma com o filtro dela", () => {
    expect(avisosEstoque({ semEstoque: 2, abaixo: 1, negativo: 1 })).toEqual([
      { situacao: "negativo", texto: "1 produto com saldo negativo", href: "/estoque?situacao=negativo" },
      { situacao: "zerado", texto: "2 produtos sem estoque", href: "/estoque?situacao=zerado" },
      { situacao: "abaixo", texto: "1 produto abaixo do mínimo", href: "/estoque?situacao=abaixo" },
    ]);
    expect(avisosEstoque({ semEstoque: 0, abaixo: 0, negativo: 0 })).toEqual([]);
    expect(avisosEstoque({ semEstoque: 1, abaixo: 0, negativo: 0 }).map((a) => a.texto)).toEqual(["1 produto sem estoque"]);
  });
});

/* ───────────────────────── histórico da OS ───────────────────────── */

let seq = 0;
const ev = (min: number, acao: string, detalhes: string | null = null, quem = "Sérgio"): EventoHistorico =>
  ({ id: `h${String(++seq).padStart(3, "0")}`, acao, detalhes, criadoEm: new Date(Date.UTC(2026, 10, 23, 8, 0) + min * 60_000), usuario: { nome: quem } });

describe("histórico da OS: o resumo do gestor", () => {
  it("traduz os códigos de status: nada de AGENDADA → EM_ANDAMENTO na tela", () => {
    expect(traduzir(ev(0, "Status da atividade alterado", `"Preventiva": AGENDADA → EM_ANDAMENTO (app do técnico)`))).toEqual({ titulo: "Atividade iniciada", detalhe: "Preventiva" });
    expect(traduzir(ev(0, "Status da atividade alterado", `"Preventiva": EM_ANDAMENTO → CONCLUIDA`)).titulo).toBe("Atividade concluída");
    expect(traduzir(ev(0, "Status automático", "ABERTA → AGENDADA")).titulo).toBe("OS agendada");
    expect(textoStatusOs("EM_ANDAMENTO")).toBe("OS em execução");
    expect(textoStatusOs("CONCLUIDA")).toBe("OS concluída");
    expect(textoStatusOs("XYZ")).toBeNull();
    expect(traduzir(ev(0, "Foto adicionada", "Antes — sala 101 (app do técnico)")).detalhe).toBe("Antes — sala 101");
  });

  it("agrupa o que se repete seguido, pela mesma pessoa: \"4 fotos adicionadas\", \"3 itens executados\"", () => {
    const linhas = resumirHistorico([
      ev(0, "Foto adicionada", "Antes — sala 101"), ev(1, "Foto adicionada", "Antes — sala 102"),
      ev(1, "Foto adicionada", "Antes — sala 103"), ev(2, "Foto adicionada", "Antes — sala 104"),
      ev(10, "Item executado", "Limpeza de filtros"), ev(20, "Item executado", "Limpeza da serpentina"), ev(30, "Item executado", "Medição"),
    ]);
    expect(linhas.map((l) => [l.titulo, l.quantidade])).toEqual([["3 itens executados", 3], ["4 fotos adicionadas", 4]]);
    expect(linhas[1].detalhe).toBe("Antes — sala 101; Antes — sala 102; Antes — sala 103 e mais 1");
    expect(linhas[0].detalhe).toBe("Limpeza de filtros; Limpeza da serpentina; Medição");
  });

  it("não agrupa: pessoas diferentes, pausa longa no meio ou outra ação entre elas", () => {
    expect(resumirHistorico([ev(0, "Foto adicionada", "a", "Sérgio"), ev(1, "Foto adicionada", "b", "Ana")])).toHaveLength(2);
    // a pausa é de 1 hora: 59 min depois ainda é o mesmo momento; 61 min depois, outro
    expect(PAUSA_AGRUPAR_MS).toBe(60 * 60_000);
    expect(resumirHistorico([ev(0, "Foto adicionada", "a"), ev(59, "Foto adicionada", "b")])).toHaveLength(1);
    expect(resumirHistorico([ev(0, "Foto adicionada", "a"), ev(61, "Foto adicionada", "b")])).toHaveLength(2);
    expect(resumirHistorico([ev(0, "Foto adicionada", "a"), ev(1, "Item executado", "x"), ev(2, "Foto adicionada", "b")])).toHaveLength(3);
    // ações diferentes de famílias "genéricas" não se juntam, e a mesma ação com outro detalhe também não
    expect(resumirHistorico([ev(0, "Técnico a caminho", "x"), ev(1, "Técnico chegou ao local", "x")])).toHaveLength(2);
    expect(resumirHistorico([ev(0, "Material separado", "Capacitor"), ev(1, "Material separado", "Gás")])).toHaveLength(2);
  });

  it("edições seguidas da mesma atividade viram uma linha com o que mudou", () => {
    const [l] = resumirHistorico([
      ev(0, "Atividade editada", `"Preventiva": data agendada`), ev(1, "Atividade editada", `"Preventiva": técnico`), ev(2, "Atividade editada", `"Preventiva": data agendada`),
    ]);
    expect(l).toMatchObject({ titulo: "Atividade “Preventiva” editada", detalhe: "data agendada, técnico", quantidade: 3 });
    // outra atividade é outra linha
    expect(resumirHistorico([ev(0, "Atividade editada", `"A": técnico`), ev(1, "Atividade editada", `"B": técnico`)])).toHaveLength(2);
  });

  it("o status automático vira consequência do evento que o causou; sozinho, é uma linha própria", () => {
    const linhas = resumirHistorico([
      ev(0, "Status da atividade alterado", `"Preventiva": AGENDADA → EM_ANDAMENTO (app do técnico)`),
      ev(0.5, "Status automático", "AGENDADA → EM_ANDAMENTO"),
      ev(300, "Status automático", "EM_ANDAMENTO → CONCLUIDA"),
    ]);
    expect(linhas.map((l) => [l.titulo, l.consequencia])).toEqual([["OS concluída", null], ["Atividade iniciada", "OS em execução"]]);
    expect(linhas[1].itens.map((i) => i.acao)).toEqual(["Status automático", "Status da atividade alterado"]);
    // longe demais da causa: não é consequência dela
    const longe = resumirHistorico([ev(0, "Atividade adicionada", "X"), ev(10, "Status automático", "ABERTA → AGENDADA")]);
    expect(longe.map((l) => l.titulo)).toEqual(["OS agendada", "Atividade adicionada"]);
  });

  it("auditoria: nenhum registro some — todo id está em alguma linha, uma vez só; e a ordem é do mais recente", () => {
    const eventos = [
      ev(0, "OS criada", "OS-1 aberta", "Admin"), ev(1, "Atividade adicionada", "Preventiva", "Admin"), ev(1, "Status automático", "ABERTA → AGENDADA", "Admin"),
      ev(60 * 24, "Técnico a caminho", "x"), ev(60 * 24 + 20, "Técnico chegou ao local", "x"),
      ev(60 * 24 + 21, "Status da atividade alterado", `"Preventiva": AGENDADA → EM_ANDAMENTO`), ev(60 * 24 + 21, "Status automático", "AGENDADA → EM_ANDAMENTO"),
      ...[30, 31, 32].map((m) => ev(60 * 24 + m, "Foto adicionada", `f${m}`)),
      ev(60 * 24 + 90, "Status da atividade alterado", `"Preventiva": EM_ANDAMENTO → CONCLUIDA`),
    ];
    const embaralhado = [...eventos].reverse();
    const linhas = resumirHistorico(embaralhado);
    const ids = linhas.flatMap((l) => l.itens.map((i) => i.id));
    expect(ids.sort()).toEqual(eventos.map((e) => e.id).sort());
    expect(linhas.length).toBeLessThan(eventos.length);
    const quando = linhas.map((l) => new Date(l.quando).getTime());
    expect(quando).toEqual([...quando].sort((a, b) => b - a));
    expect(linhas[0].titulo).toBe("Atividade concluída");
    expect(linhas.at(-1)!.titulo).toBe("OS criada");
  });

  it("histórico vazio: nenhuma linha", () => {
    expect(resumirHistorico([])).toEqual([]);
  });
});

/* ───────────────────────── gráfico do financeiro ───────────────────────── */

describe("gráfico Entradas × Saídas: um eixo que se lê", () => {
  it("o eixo começa no zero e sobe em passos redondos até cobrir o maior valor", () => {
    expect(escalaEixo(61980.55)).toEqual({ topo: 80000, marcas: [0, 20000, 40000, 60000, 80000] });
    expect(escalaEixo(100)).toEqual({ topo: 100, marcas: [0, 25, 50, 75, 100] });
    expect(escalaEixo(1)).toEqual({ topo: 1, marcas: [0, 0.25, 0.5, 0.75, 1] });
    expect(escalaEixo(0)).toEqual({ topo: 1000, marcas: [0, 250, 500, 750, 1000] });
    for (const max of [3, 97, 1234, 9999, 50000, 123456]) {
      const { topo, marcas } = escalaEixo(max);
      expect(topo, String(max)).toBeGreaterThanOrEqual(max);
      expect(marcas[0]).toBe(0);
      expect(marcas.length, String(max)).toBeLessThanOrEqual(5);
    }
  });

  it("valores curtos: R$ 0, R$ 850, R$ 1,5 mil, R$ 60 mil, R$ 1,2 mi — e com sinal de menos", () => {
    expect(moedaCurta(0)).toBe("R$ 0");
    expect(moedaCurta(850)).toBe("R$ 850");
    expect(moedaCurta(1500)).toBe("R$ 1,5 mil");
    expect(moedaCurta(60000)).toBe("R$ 60 mil");
    expect(moedaCurta(16430.15)).toBe("R$ 16 mil");
    expect(moedaCurta(1_200_000)).toBe("R$ 1,2 mi");
    expect(moedaCurta(-11210.3)).toBe("−R$ 11 mil");
    expect(moedaCurta(-11210.3, { prefixo: false })).toBe("−11 mil");
  });

  it("a série: resultado de cada mês e do período, alturas no mesmo eixo, ano no primeiro mês e na virada", () => {
    const s = montarSerie([
      { mes: "nov", ref: "2025-11", entradas: 40000, saidas: 30000 },
      { mes: "dez", ref: "2025-12", entradas: 20000, saidas: 25000 },
      { mes: "jan", ref: "2026-01", entradas: 0, saidas: 0 },
    ]);
    expect(s.barras.map((b) => b.rotulo)).toEqual(["nov/25", "dez", "jan/26"]);
    expect(s.barras.map((b) => b.nomeCompleto)).toEqual(["Novembro de 2025", "Dezembro de 2025", "Janeiro de 2026"]);
    expect(s.barras.map((b) => b.resultado)).toEqual([10000, -5000, 0]);
    expect(s.resultadoPeriodo).toBe(5000);
    expect(s.topo).toBe(40000);
    expect(s.barras[0].altEntradas).toBe(100);
    expect(s.barras[0].altSaidas).toBe(75); // o mesmo eixo para as duas séries
    expect(s.barras[2].altEntradas).toBe(0);
  });
});

/* ───────────────────────── ficha do cliente ───────────────────────── */

describe("ficha do cliente em consulta", () => {
  it("mostra só o que está preenchido; seção vazia some", () => {
    const secoes = secoesDaFicha({ tipoPessoa: "JURIDICA", nome: "Clínica Vida Plena Ltda", nomeFantasia: "Vida Plena", cpfCnpj: "11222333000181" });
    expect(secoes.map((s) => s.id)).toEqual(["identificacao", "comercial"]);
    expect(secoes[0].linhas).toEqual([
      { rotulo: "Tipo", valor: "Pessoa jurídica" }, { rotulo: "CNPJ", valor: "11.222.333/0001-81" },
      { rotulo: "Razão social", valor: "Clínica Vida Plena Ltda" }, { rotulo: "Nome fantasia", valor: "Vida Plena" },
    ]);
    expect(secoes[1].linhas).toEqual([{ rotulo: "Tabela de preços", valor: "Preços do catálogo" }]);
  });

  it("pessoa física usa CPF, nome completo e apelido; fiscal e cobrança aparecem quando preenchidos", () => {
    const secoes = secoesDaFicha({
      tipoPessoa: "FISICA", nome: "João da Silva", cpfCnpj: "52998224725", optanteSimples: false, inscricaoMunicipal: "  123  ",
      tabelaPreco: { nome: "VIP", ativo: false }, emailsFaturamento: ["fin@x.com", " ", "b@x.com"], boletoUnicoMensal: true, exigePcAntesNf: true,
    });
    const linha = (id: string) => secoes.find((s) => s.id === id)!.linhas;
    expect(linha("identificacao").map((l) => l.rotulo)).toEqual(["Tipo", "CPF", "Nome completo"]);
    expect(linha("fiscal")).toEqual([{ rotulo: "Simples Nacional", valor: "Não optante" }, { rotulo: "Inscrição municipal", valor: "123" }]);
    expect(linha("comercial")[0].valor).toBe("VIP (inativa: valem os preços do catálogo)");
    expect(linha("cobranca")).toEqual([
      { rotulo: "E-mails de cobrança", valor: "fin@x.com, b@x.com" },
      { rotulo: "Preferências", valor: "Boleto único mensal · Exige pedido de compra antes da NF" },
    ]);
  });

  it("endereço numa linha, contatos com os meios na ordem de uso, principal primeiro", () => {
    expect(enderecoEmUmaLinha({ id: "u", nome: "Matriz", logradouro: "Rua das Flores", numero: "120", complemento: "sala 3", bairro: "Centro", cidade: "São Paulo", estado: "SP", cep: "01000-000" }))
      .toBe("Rua das Flores, 120 — sala 3 · Centro · São Paulo/SP · CEP 01000-000");
    expect(enderecoEmUmaLinha({ id: "u", nome: "Filial", cidade: "Campinas" })).toBe("Campinas");
    expect(enderecoEmUmaLinha({ id: "u", nome: "Vazio" })).toBe("");
    expect(meiosDoContato({ id: "c", nome: "Ana", telefone: "11988887777", whatsapp: "11988887777", email: "ana@x.com" })).toEqual(["(11) 98888-7777", "ana@x.com"]);
    expect(meiosDoContato({ id: "c", nome: "Ana", telefone: "1133334444", whatsapp: "11988887777" })).toEqual(["(11) 3333-4444", "WhatsApp (11) 98888-7777"]);
    expect(emOrdem([{ nome: "Bruno" }, { nome: "Ana" }, { nome: "Zeca", principal: true }]).map((x) => x.nome)).toEqual(["Zeca", "Ana", "Bruno"]);
  });
});
