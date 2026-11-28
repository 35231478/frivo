/**
 * COM-1 — as regras puras das comissões: precedência, base (venda, lucro, fixo), desconto e ISS repartidos,
 * recebimento proporcional, alvo por gatilho (aprovação, conclusão da OS, recebimento), estorno, extrato,
 * folha do mês com comissão (uma linha por pessoa) e a validação do que a tela manda.
 */
import { describe, expect, it } from "vitest";
import {
  alvoLiberado, chaveDaRegra, comissoesDaVenda, comissoesPorPessoa, descricaoDaRegra, fimDaCompetencia, fracaoRecebida, itensDaVenda,
  movimentoNecessario, normalizarRegra, ORDEM_PRECEDENCIA, pesoDaRegra, regraSchema, regraVencedora, situacaoDaComissao, trocarVendedorSchema, valorDaComissao,
  type RegraComissao,
} from "@/lib/comissoes/regras";
import { folhaComComissoes, linhasDoCsv, totalDaLinha } from "@/lib/desempenho/fechamento";

const r = (id: string, x: Partial<RegraComissao>): RegraComissao => ({ id, quemTipo: "TODOS", papel: "VENDEDOR", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 1, ...x });
const ana = { usuarioId: "uAna", cargoId: "cgVend" };
const instalacao = { tipo: "SERVICO" as const, servicoId: "sInst", categoria: "Instalação" };

describe("precedência: o ITEM manda, a pessoa desempata (como a comissão diferenciada do OMIE)", () => {
  const regras = [
    r("todos", { valor: 2 }),
    r("cargoCat", { quemTipo: "CARGO", cargoId: "cgVend", sobreTipo: "CATEGORIA", categoria: "instalação", valor: 5 }),
    r("cargoServ", { quemTipo: "CARGO", cargoId: "cgVend", sobreTipo: "SERVICO", servicoId: "sInst", valor: 6 }),
    r("pessoaTodos", { quemTipo: "PESSOA", usuarioId: "uAna", valor: 7 }),
    r("pecas", { sobreTipo: "PECAS", base: "FIXO_ITEM", valor: 7 }),
  ];

  it("o fixo da pessoa (pessoa + todos) perde para a regra do serviço, mesmo de cargo; vale nos itens sem regra própria", () => {
    expect(regraVencedora(regras, ana, instalacao)?.id).toBe("cargoServ");
    expect(regraVencedora(regras, ana, { tipo: "SERVICO", servicoId: "sOutro", categoria: "Instalação" })?.id).toBe("cargoCat");
    expect(regraVencedora(regras, ana, { tipo: "SERVICO", servicoId: "sOutro", categoria: "Manutenção" })?.id).toBe("pessoaTodos");
    expect(regraVencedora(regras, { usuarioId: "uOutro", cargoId: null }, instalacao)?.id).toBe("todos");
    // A "diferenciada" vale para todo mundo: Todos + um serviço vence o fixo da pessoa
    const omie = [r("fixoAna", { quemTipo: "PESSOA", usuarioId: "uAna", valor: 7 }), r("vrf", { sobreTipo: "SERVICO", servicoId: "sInst", valor: 3 })];
    expect(regraVencedora(omie, ana, instalacao)?.id).toBe("vrf");
    expect(regraVencedora(omie, ana, { tipo: "SERVICO", servicoId: "sLimp", categoria: null })?.id).toBe("fixoAna");
  });

  it("a ordem inteira: pessoa+serviço > cargo+serviço > pessoa+categoria > cargo+categoria > pessoa+todos > cargo+todos (> todos+todos)", () => {
    const cadeia = [
      r("1", { quemTipo: "PESSOA", usuarioId: "uAna", sobreTipo: "SERVICO", servicoId: "sInst" }),
      r("2", { quemTipo: "CARGO", cargoId: "cgVend", sobreTipo: "SERVICO", servicoId: "sInst" }),
      r("3", { quemTipo: "PESSOA", usuarioId: "uAna", sobreTipo: "CATEGORIA", categoria: "Instalação" }),
      r("4", { quemTipo: "CARGO", cargoId: "cgVend", sobreTipo: "CATEGORIA", categoria: "Instalação" }),
      r("5", { quemTipo: "PESSOA", usuarioId: "uAna" }),
      r("6", { quemTipo: "CARGO", cargoId: "cgVend" }),
      r("7", {}),
    ];
    // Tira a vencedora uma a uma: a próxima é sempre a seguinte na ordem (embaralhado, para a ordem da lista não importar)
    let resto = [...cadeia].reverse();
    for (const esperado of ["1", "2", "3", "4", "5", "6", "7"]) {
      expect(regraVencedora(resto, ana, instalacao)?.id).toBe(esperado);
      resto = resto.filter((x) => x.id !== esperado);
    }
    expect(pesoDaRegra({ quemTipo: "CARGO", sobreTipo: "SERVICO" })).toBeGreaterThan(pesoDaRegra({ quemTipo: "PESSOA", sobreTipo: "CATEGORIA" }));
    expect(pesoDaRegra({ quemTipo: "TODOS", sobreTipo: "CATEGORIA" })).toBeGreaterThan(pesoDaRegra({ quemTipo: "PESSOA", sobreTipo: "TODOS_SERVICOS" }));
    expect(ORDEM_PRECEDENCIA).toHaveLength(6);
  });

  it("categoria sem acento/maiúscula importando", () => {
    expect(regraVencedora([r("c", { sobreTipo: "CATEGORIA", categoria: "INSTALACAO" })], ana, instalacao)?.id).toBe("c");
  });

  it("peças só valem para as linhas de peça; serviço nunca pega regra de peça; regra desativada e outro papel não valem", () => {
    expect(regraVencedora(regras, ana, { tipo: "PRODUTO" })?.id).toBe("pecas");
    expect(regraVencedora([r("pecas", { sobreTipo: "PECAS" })], ana, instalacao)).toBeNull();
    expect(regraVencedora([r("off", { ativo: false })], ana, instalacao)).toBeNull();
    expect(regraVencedora([r("exec", { papel: "EXECUTOR" })], ana, instalacao)).toBeNull();
    expect(regraVencedora([r("exec", { papel: "EXECUTOR" })], ana, instalacao, "EXECUTOR")?.id).toBe("exec");
    // Cargo: quem não tem cargo (usuário sem colaborador) nunca casa com regra de cargo
    expect(regraVencedora([r("c", { quemTipo: "CARGO", cargoId: "cgVend" })], { usuarioId: "uAna", cargoId: null }, instalacao)).toBeNull();
  });

  it("chave da regra: mesma pessoa/cargo e mesmo alvo = repetida (categoria sem diferenciar maiúscula)", () => {
    expect(chaveDaRegra(r("a", { quemTipo: "CARGO", cargoId: "c1", sobreTipo: "CATEGORIA", categoria: "Instalação" })))
      .toBe(chaveDaRegra(r("b", { quemTipo: "CARGO", cargoId: "c1", sobreTipo: "CATEGORIA", categoria: " instalação " })));
    expect(chaveDaRegra(r("a", { quemTipo: "CARGO", cargoId: "c1" }))).not.toBe(chaveDaRegra(r("b", { quemTipo: "CARGO", cargoId: "c2" })));
    expect(chaveDaRegra(r("a", { papel: "VENDEDOR" }))).not.toBe(chaveDaRegra(r("b", { papel: "EXECUTOR" })));
  });
});

describe("o valor: base, desconto, ISS e lucro", () => {
  it("% da venda (com ISS) ou líquida de impostos; valor fixo por item multiplica a quantidade", () => {
    const item = { venda: 1050, vendaLiquida: 1000, custo: 300, quantidade: 3 };
    expect(valorDaComissao({ base: "PERC_VENDA", valor: 5 }, item, false)).toEqual({ baseValor: 1050, taxa: 5, valor: 52.5, semCusto: false });
    expect(valorDaComissao({ base: "PERC_VENDA", valor: 5 }, item, true).valor).toBe(50);
    expect(valorDaComissao({ base: "FIXO_ITEM", valor: 7.5 }, item, false).valor).toBe(22.5);
  });

  it("% do lucro: venda líquida − custo (nunca negativa); custo desconhecido não calcula", () => {
    expect(valorDaComissao({ base: "PERC_LUCRO", valor: 10 }, { venda: 1050, vendaLiquida: 1000, custo: 300, quantidade: 1 }, false)).toEqual({ baseValor: 700, taxa: 10, valor: 70, semCusto: false });
    expect(valorDaComissao({ base: "PERC_LUCRO", valor: 10 }, { venda: 100, vendaLiquida: 100, custo: 150, quantidade: 1 }, false).valor).toBe(0);
    expect(valorDaComissao({ base: "PERC_LUCRO", valor: 10 }, { venda: 100, vendaLiquida: 100, custo: null, quantidade: 1 }, false)).toMatchObject({ valor: 0, semCusto: true });
  });

  it("itens da venda: o desconto de cada grupo repartido pela linha; o ISS só nos serviços", () => {
    const itens = itensDaVenda({
      servicos: [{ id: "s1", servicoId: "x", descricao: "A", quantidade: 1, valorTotal: 600, custo: 0 }, { id: "s2", descricao: "B", quantidade: 2, valorTotal: 400, custo: null }],
      produtos: [{ id: "p1", descricao: "Peça", quantidade: 1, valorTotal: 200, custo: 80 }],
      descontoServicos: 100, descontoProdutos: 20, issAliquota: 5,
    });
    expect(itens.map((i) => [i.id, i.vendaLiquida, i.venda])).toEqual([["s1", 540, 567], ["s2", 360, 378], ["p1", 180, 180]]);
  });

  it("comissões da venda: um item por regra vencedora; item sem regra (ou valor zero) fica de fora", () => {
    const itens = itensDaVenda({
      servicos: [{ id: "s1", servicoId: "sInst", categoria: "Instalação", descricao: "Instalação", quantidade: 1, valorTotal: 1000, custo: 0 }],
      produtos: [{ id: "p1", descricao: "Peça", quantidade: 2, valorTotal: 100, custo: null }],
      descontoServicos: 0, descontoProdutos: 0, issAliquota: 0,
    });
    const cs = comissoesDaVenda(itens, [r("cat", { quemTipo: "CARGO", cargoId: "cgVend", sobreTipo: "CATEGORIA", categoria: "Instalação", valor: 5 })], ana, false);
    expect(cs.map((c) => [c.item.id, c.regra.id, c.valor])).toEqual([["s1", "cat", 50]]);
    const comPeca = comissoesDaVenda(itens, [r("p", { sobreTipo: "PECAS", base: "FIXO_ITEM", valor: 7 }), r("z", { valor: 0 })], ana, false);
    expect(comPeca.map((c) => [c.item.id, c.valor])).toEqual([["p1", 14]]);
  });

  it("descrição da regra (congelada na comissão)", () => {
    expect(descricaoDaRegra(r("x", { quemTipo: "PESSOA", sobreTipo: "SERVICO", valor: 8 }), { pessoa: "Ana", servico: "Limpeza" })).toBe("Ana (pessoa) · Limpeza (serviço) · 8% da venda");
    expect(descricaoDaRegra(r("x", { sobreTipo: "PECAS", base: "FIXO_ITEM", valor: 10 }))).toBe("Todos · Peças · R$ 10,00 por item");
    expect(descricaoDaRegra(r("x", { quemTipo: "CARGO", sobreTipo: "CATEGORIA", categoria: "Instalação", base: "PERC_LUCRO", valor: 12.5 }), { cargo: "Vendedores" })).toBe("Vendedores (cargo) · Instalação (categoria) · 12,5% do lucro");
  });
});

describe("quando fica devida: alvo, recebimento proporcional e estorno", () => {
  it("fração recebida: o recebido de cada fatura na proporção do que é da venda, até 100%", () => {
    expect(fracaoRecebida([{ daVenda: 1000, aCobrar: 1000, recebido: 400 }], 1000)).toBeCloseTo(0.4);
    // Fatura com retenção: cobra 950 de 1000; recebeu tudo o que cobra = 100%
    expect(fracaoRecebida([{ daVenda: 1000, aCobrar: 950, recebido: 950 }], 1000)).toBe(1);
    // Duas faturas parciais
    expect(fracaoRecebida([{ daVenda: 400, aCobrar: 400, recebido: 400 }, { daVenda: 600, aCobrar: 600, recebido: 300 }], 1000)).toBeCloseTo(0.7);
    expect(fracaoRecebida([{ daVenda: 2000, aCobrar: 2000, recebido: 2000 }], 1000)).toBe(1);
    expect(fracaoRecebida([{ daVenda: 1000, aCobrar: 0, recebido: 0 }], 1000)).toBe(0);
    expect(fracaoRecebida([], 0)).toBe(0);
  });

  it("alvo por gatilho: aprovação (venda viva), conclusão da OS, recebimento (o dinheiro manda)", () => {
    const c = (quando: "APROVACAO" | "CONCLUSAO_OS" | "RECEBIMENTO") => ({ valor: 80, quando });
    const viva = { statusOrcamento: "APROVADO", osConcluida: false, fracao: 0.25 };
    expect(alvoLiberado(c("APROVACAO"), viva)).toBe(80);
    expect(alvoLiberado(c("APROVACAO"), { ...viva, statusOrcamento: "CONVERTIDA" })).toBe(80);
    expect(alvoLiberado(c("APROVACAO"), { ...viva, statusOrcamento: "CANCELADO" })).toBe(0);
    expect(alvoLiberado(c("CONCLUSAO_OS"), viva)).toBe(0);
    expect(alvoLiberado(c("CONCLUSAO_OS"), { ...viva, osConcluida: true })).toBe(80);
    expect(alvoLiberado(c("CONCLUSAO_OS"), { ...viva, osConcluida: true, statusOrcamento: "REPROVADO" })).toBe(0);
    expect(alvoLiberado(c("RECEBIMENTO"), viva)).toBe(20);
    expect(alvoLiberado(c("RECEBIMENTO"), { ...viva, fracao: 1.7 })).toBe(80);
  });

  it("movimento: só a diferença (+ libera, − estorna); menos de 1 centavo não mexe", () => {
    expect(movimentoNecessario(20, 0)).toEqual({ tipo: "LIBERACAO", valor: 20 });
    expect(movimentoNecessario(20, 20)).toBeNull();
    expect(movimentoNecessario(0, 20)).toEqual({ tipo: "ESTORNO", valor: -20 });
    expect(movimentoNecessario(50, 20)).toEqual({ tipo: "LIBERACAO", valor: 30 });
    expect(movimentoNecessario(20.004, 20)).toBeNull();
  });

  it("extrato: prevista = valor − liberado; liberada = liberado − pago; paga = o que entrou no fechamento", () => {
    expect(situacaoDaComissao(100, [])).toEqual({ prevista: 100, liberada: 0, paga: 0 });
    expect(situacaoDaComissao(100, [{ valor: 40, pago: true }, { valor: 30, pago: false }])).toEqual({ prevista: 30, liberada: 30, paga: 40 });
    // Estorno de uma liberação já paga: a paga fica, a liberada fica negativa (desconta no próximo mês)
    expect(situacaoDaComissao(100, [{ valor: 40, pago: true }, { valor: -40, pago: false }])).toEqual({ prevista: 100, liberada: -40, paga: 40 });
  });
});

describe("fechamento do mês com comissões", () => {
  it("o mês da competência: tudo antes do 1º dia do mês seguinte (dezembro vira o ano)", () => {
    expect(fimDaCompetencia("2026-11").toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(fimDaCompetencia("2026-12").toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("por pessoa: soma; saldo negativo fica para o mês seguinte; movimento sem pessoa não entra", () => {
    expect(comissoesPorPessoa([
      { usuarioId: "u2", nome: "Bia", tecnicoId: null, valor: 10 }, { usuarioId: "u1", nome: "Ana", tecnicoId: "t1", valor: 30 },
      { usuarioId: "u1", nome: "Ana", tecnicoId: "t1", valor: -5 }, { usuarioId: "u3", nome: "Caio", tecnicoId: null, valor: -8 },
      { usuarioId: null, nome: "?", tecnicoId: null, valor: 99 },
    ])).toEqual([{ usuarioId: "u1", nome: "Ana", tecnicoId: "t1", valor: 25 }, { usuarioId: "u2", nome: "Bia", tecnicoId: null, valor: 10 }]);
  });

  it("folha com comissão: junta na linha do mesmo colaborador (uma conta por pessoa); quem só tem comissão ganha linha própria", () => {
    const folha = { linhas: [{ tecnicoId: "t1", nome: "Ana", perfil: "Preventiva", posicao: 1, escore: 90, faixa: "Ouro", valor: 300 }, { tecnicoId: "t2", nome: "Beto", perfil: "Preventiva", posicao: 2, escore: 70, faixa: null, valor: 0 }], total: 300 };
    const f = folhaComComissoes(folha, [{ usuarioId: "uAna", nome: "Ana", tecnicoId: "t1", valor: 55.5 }, { usuarioId: "uZe", nome: "Zé Vendas", tecnicoId: null, valor: 20 }]);
    expect(f.linhas.map((l) => [l.nome, l.valor, l.comissao, l.usuarioId, l.perfil])).toEqual([
      ["Ana", 300, 55.5, "uAna", "Preventiva"], ["Beto", 0, 0, null, "Preventiva"], ["Zé Vendas", 0, 20, "uZe", "Comissão"],
    ]);
    expect([f.total, f.totalComissao]).toEqual([300, 75.5]);
    expect(totalDaLinha(f.linhas[0])).toBe(355.5);
  });

  it("CSV: com comissão ganha 'Comissão' e 'Total'; sem comissão fica exatamente como era", () => {
    const sem = linhasDoCsv("2026-11", { linhas: [{ tecnicoId: "t1", nome: "Ana", perfil: "P", posicao: 1, escore: 90, faixa: "Ouro", valor: 300 }], total: 300 }, []);
    expect(sem[0]).toEqual(["Competência", "Colaborador", "Perfil", "Posição", "Escore (%)", "Faixa", "Bônus (R$)", "Premiação"]);
    const com = linhasDoCsv("2026-11", folhaComComissoes({ linhas: [{ tecnicoId: "t1", nome: "Ana", perfil: "P", posicao: 1, escore: 90, faixa: "Ouro", valor: 300 }], total: 300 }, [{ usuarioId: "u", nome: "Ana", tecnicoId: "t1", valor: 50 }]), []);
    expect(com[0]).toEqual(["Competência", "Colaborador", "Perfil", "Posição", "Escore (%)", "Faixa", "Bônus (R$)", "Comissão (R$)", "Total (R$)", "Premiação"]);
    expect(com[1].slice(6, 9)).toEqual(["300,00", "50,00", "350,00"]);
    expect(com.at(-1)!.slice(6, 9)).toEqual(["300,00", "50,00", "350,00"]);
  });
});

describe("o que a tela manda", () => {
  it("regra: pessoa/cargo/categoria/serviço exigidos conforme o tipo; % até 100; só o papel Vendedor; valor > 0", () => {
    expect(regraSchema.safeParse({ quemTipo: "PESSOA", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 5 }).success).toBe(false);
    expect(regraSchema.safeParse({ quemTipo: "CARGO", cargoId: "c", sobreTipo: "CATEGORIA", base: "PERC_VENDA", valor: 5 }).success).toBe(false);
    expect(regraSchema.safeParse({ quemTipo: "TODOS", sobreTipo: "SERVICO", base: "PERC_VENDA", valor: 5 }).success).toBe(false);
    expect(regraSchema.safeParse({ quemTipo: "TODOS", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 100.01 }).success).toBe(false);
    expect(regraSchema.safeParse({ quemTipo: "TODOS", sobreTipo: "PECAS", base: "FIXO_ITEM", valor: 150 }).success).toBe(true);
    expect(regraSchema.safeParse({ quemTipo: "TODOS", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 0 }).success).toBe(false);
    expect(regraSchema.safeParse({ quemTipo: "TODOS", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 3, papel: "EXECUTOR" }).success).toBe(false);
    expect(regraSchema.safeParse({ quemTipo: "TODOS", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 3, outro: 1 }).success).toBe(false);
  });

  it("normalizar: o que não vale para o tipo escolhido vai nulo", () => {
    const d = regraSchema.parse({ quemTipo: "TODOS", usuarioId: "u", cargoId: "c", sobreTipo: "TODOS_SERVICOS", categoria: "X", servicoId: "s", base: "PERC_VENDA", valor: "2,5".replace(",", ".") });
    expect(normalizarRegra(d)).toEqual({ quemTipo: "TODOS", papel: "VENDEDOR", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 2.5, ativo: true, usuarioId: null, cargoId: null, categoria: null, servicoId: null });
  });

  it("trocar vendedor: exige a pessoa e o motivo (mínimo 5 caracteres)", () => {
    expect(trocarVendedorSchema.safeParse({ vendedorId: "u" }).success).toBe(false);
    expect(trocarVendedorSchema.safeParse({ vendedorId: "u", motivo: "abc" }).success).toBe(false);
    expect(trocarVendedorSchema.safeParse({ vendedorId: "u", motivo: "Carteira nova" }).success).toBe(true);
  });
});
