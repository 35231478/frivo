/**
 * DESEMPENHO (PR 2 — pagar) — as REGRAS do fechamento, sem banco e sem tela (o servidor está em
 * desempenho-pg):
 *  - os avisos que a gestão confirma antes de fechar (mês em andamento, itens sem revisão);
 *  - a FOLHA DE BÔNUS: uma linha por colaborador, valor zero sem faixa, total em centavos;
 *  - a PREMIAÇÃO: maior escore acima da meta, no escopo (perfil ou geral), com DESEMPATE determinístico —
 *    média de avaliação → menos penalidades → mais atividades no prazo → prêmio dividido;
 *  - valores em reais só para quem pode: o painel congelado sai sem bônus e sem valor de faixa;
 *  - a exportação (CSV) só com o valor do bônus; o que a tela manda (fechar, reabrir);
 *  - a vista "Desempenho" do app do técnico no endereço.
 */
import { describe, expect, it } from "vitest";
import {
  AVISO_MES_EM_ANDAMENTO, AVISO_PENDENTES, CRITERIOS, MSG_MES_FECHADO, MSG_MOTIVO_REABERTURA, TEXTO_CRITERIO, avisosDoFechamento, fecharSchema, folhaDoPainel,
  ganhadoresDoPremio, lerPremios, linhasDoCsv, nomeDoArquivo, premiosDoMes, reabrirSchema, semValores, type PremioFechado,
} from "@/lib/desempenho/fechamento";
import type { GrupoRanking, LinhaRanking } from "@/lib/desempenho/painel";
import { lerVista, urlDaVista } from "@/components/tecnico/contexto";

const linha = (nome: string, escore: number | null, x: Partial<LinhaRanking> & { media?: number | null; penalidades_?: number; noPrazo?: number } = {}): LinhaRanking => {
  const { media = 5, penalidades_ = 0, noPrazo = 2, ...resto } = x;
  return {
    tecnicoId: nome.toLowerCase(), nome, posicao: 1, escore, base: escore, desconto: 0, atingiuMeta: escore !== null && escore >= 70, faixa: escore !== null && escore >= 90 ? "Ouro" : null, composicao: [],
    penalidades: { retornos: 0, reclamacoes: 0, pontosRetorno: 0, pontosReclamacao: 0 }, bonus: escore !== null && escore >= 90 ? 350 : 0,
    desempate: { mediaAvaliacao: media, penalidades: penalidades_, noPrazo }, ...resto,
  };
};
const REGRA = { vigenteDesde: "2026-11", pesoPrazo: 40, pesoRelatorio: 30, pesoAvaliacao: 30, exigirFotoAntesDepois: true, penalidadeRetorno: 5, penalidadeReclamacao: 5, metaMinima: 70, faixas: [{ nome: "Ouro", minimo: 90, valor: 350 }] };
const grupo = (nome: string, linhas: LinhaRanking[]): GrupoRanking => ({ perfil: { id: nome, nome, tipo: "TECNICO" }, regra: REGRA, linhas });
const quem = (r: ReturnType<typeof ganhadoresDoPremio>) => `${r.criterio}:${r.ganhadores.map((g) => g.nome).join("+")}`;

describe("avisos antes de fechar", () => {
  it("mês que já terminou e sem pendência: nenhum aviso", () => {
    expect(avisosDoFechamento("2026-10", "2026-11", 0)).toEqual([]);
  });

  it("mês corrente: avisa que ainda não terminou; itens sem revisão: avisa quantos (singular e plural)", () => {
    expect(avisosDoFechamento("2026-11", "2026-11", 0)).toEqual([AVISO_MES_EM_ANDAMENTO]);
    expect(avisosDoFechamento("2026-10", "2026-11", 1)).toEqual(["Há 1 item a revisar neste mês. Sem revisão, ele não pesa no escore fechado."]);
    expect(avisosDoFechamento("2026-10", "2026-11", 3)).toEqual([AVISO_PENDENTES(3)]);
    expect(AVISO_PENDENTES(3)).toBe("Há 3 itens a revisar neste mês. Sem revisão, eles não pesam no escore fechado.");
    expect(avisosDoFechamento("2026-11", "2026-11", 2)).toEqual([AVISO_MES_EM_ANDAMENTO, AVISO_PENDENTES(2)]);
    expect(MSG_MES_FECHADO("2026-11")).toBe("O mês 11/2026 está fechado. Reabra o mês para mudar.");
  });
});

describe("folha de bônus", () => {
  it("uma linha por colaborador, na ordem do painel; sem faixa ou sem medição o valor é zero; o total soma em centavos", () => {
    const folha = folhaDoPainel({ grupos: [
      grupo("Preventiva", [linha("Ana", 95, { bonus: 350.1 }), linha("Bia", 75, { posicao: 2, bonus: 0.2 }), linha("Novato", null, { posicao: null, bonus: 0 })]),
      grupo("Corretiva", [linha("Edu", 92, { bonus: 199.999 })]),
    ] });
    expect(folha.linhas).toEqual([
      { tecnicoId: "ana", nome: "Ana", perfil: "Preventiva", posicao: 1, escore: 95, faixa: "Ouro", valor: 350.1 },
      { tecnicoId: "bia", nome: "Bia", perfil: "Preventiva", posicao: 2, escore: 75, faixa: null, valor: 0.2 },
      { tecnicoId: "novato", nome: "Novato", perfil: "Preventiva", posicao: null, escore: null, faixa: null, valor: 0 },
      { tecnicoId: "edu", nome: "Edu", perfil: "Corretiva", posicao: 1, escore: 92, faixa: "Ouro", valor: 200 },
    ]);
    expect(folha.total).toBe(550.3); // 350,10 + 0,20 + 200,00 — sem o erro de ponto flutuante
  });

  it("painel sem valores (bônus vazio) vira folha de zeros; sem ninguém, folha vazia", () => {
    expect(folhaDoPainel({ grupos: [grupo("P", [linha("Ana", 95, { bonus: null })])] })).toMatchObject({ linhas: [{ valor: 0 }], total: 0 });
    expect(folhaDoPainel({ grupos: [grupo("P", [])] })).toEqual({ linhas: [], total: 0 });
  });
});

describe("premiação: quem ganha", () => {
  it("o MAIOR escore do escopo ganha — sem empate, o critério é o escore", () => {
    const grupos = [grupo("Preventiva", [linha("Ana", 95), linha("Bia", 90)]), grupo("Corretiva", [linha("Edu", 99)])];
    expect(quem(ganhadoresDoPremio(grupos, "Preventiva"))).toBe("ESCORE:Ana");
    expect(quem(ganhadoresDoPremio(grupos, "Corretiva"))).toBe("ESCORE:Edu");
    expect(quem(ganhadoresDoPremio(grupos, null))).toBe("ESCORE:Edu"); // prêmio geral: todos os perfis
    expect(ganhadoresDoPremio(grupos, null).ganhadores).toEqual([{ tecnicoId: "edu", nome: "Edu", escore: 99 }]);
  });

  it("só concorre quem ATINGIU A META: o maior escore abaixo dela não ganha; ninguém acima = sem ganhador", () => {
    const grupos = [grupo("Preventiva", [linha("Ana", 69.9), linha("Bia", 60), linha("Novato", null)])];
    expect(ganhadoresDoPremio(grupos, "Preventiva")).toEqual({ ganhadores: [], criterio: null });
    grupos[0].linhas.push(linha("Caio", 70));
    expect(quem(ganhadoresDoPremio(grupos, "Preventiva"))).toBe("ESCORE:Caio");
    expect(ganhadoresDoPremio([], null)).toEqual({ ganhadores: [], criterio: null });
    expect(ganhadoresDoPremio(grupos, "Perfil que não existe")).toEqual({ ganhadores: [], criterio: null });
  });

  it("DESEMPATE 1 — empate no escore: ganha a maior MÉDIA de avaliação do cliente (quem não foi avaliado perde para quem foi)", () => {
    expect(quem(ganhadoresDoPremio([grupo("P", [linha("Ana", 95, { media: 4.5 }), linha("Bia", 95, { media: 4.8 }), linha("Caio", 94, { media: 5 })])], "P"))).toBe("AVALIACAO:Bia");
    expect(quem(ganhadoresDoPremio([grupo("P", [linha("Ana", 95, { media: null }), linha("Bia", 95, { media: 1 })])], "P"))).toBe("AVALIACAO:Bia");
  });

  it("DESEMPATE 2 — empate no escore e na avaliação: ganha quem teve MENOS penalidades que contaram", () => {
    expect(quem(ganhadoresDoPremio([grupo("P", [linha("Ana", 95, { penalidades_: 2 }), linha("Bia", 95, { penalidades_: 1 }), linha("Caio", 95, { penalidades_: 3 })])], "P"))).toBe("PENALIDADES:Bia");
    expect(quem(ganhadoresDoPremio([grupo("P", [linha("Ana", 95, { penalidades_: 0 }), linha("Bia", 95, { penalidades_: 1 })])], "P"))).toBe("PENALIDADES:Ana");
  });

  it("DESEMPATE 3 — ainda empatados: ganha quem teve MAIS atividades no prazo", () => {
    expect(quem(ganhadoresDoPremio([grupo("P", [linha("Ana", 95, { noPrazo: 3 }), linha("Bia", 95, { noPrazo: 7 }), linha("Caio", 95, { noPrazo: 5 })])], "P"))).toBe("PRAZO:Bia");
  });

  it("a ORDEM dos critérios importa: avaliação vem antes de penalidades, que vem antes do prazo", () => {
    // Ana tem a melhor média — ganha mesmo com mais penalidades e menos atividades no prazo
    expect(quem(ganhadoresDoPremio([grupo("P", [linha("Ana", 95, { media: 5, penalidades_: 3, noPrazo: 1 }), linha("Bia", 95, { media: 4.9, penalidades_: 0, noPrazo: 9 })])], "P"))).toBe("AVALIACAO:Ana");
    // Mesma média: Bia tem menos penalidades — ganha mesmo com menos atividades no prazo
    expect(quem(ganhadoresDoPremio([grupo("P", [linha("Ana", 95, { penalidades_: 1, noPrazo: 9 }), linha("Bia", 95, { penalidades_: 0, noPrazo: 1 })])], "P"))).toBe("PENALIDADES:Bia");
    // O escore manda em tudo: critério de desempate nenhum salva quem tem escore menor
    expect(quem(ganhadoresDoPremio([grupo("P", [linha("Ana", 94.9, { media: 5, noPrazo: 99 }), linha("Bia", 95, { media: 1, penalidades_: 9, noPrazo: 0 })])], "P"))).toBe("ESCORE:Bia");
    // Um critério só desempata ENTRE os que continuam empatados: Caio saiu na avaliação e não volta pelo prazo
    expect(quem(ganhadoresDoPremio([grupo("P", [linha("Ana", 95, { media: 5, noPrazo: 2 }), linha("Bia", 95, { media: 5, noPrazo: 3 }), linha("Caio", 95, { media: 4, noPrazo: 50 })])], "P"))).toBe("PRAZO:Bia");
  });

  it("empate em TODOS os critérios: o prêmio é DIVIDIDO — e só entre os que empataram", () => {
    const r = ganhadoresDoPremio([grupo("P", [linha("Edu", 94), linha("Ana", 94), linha("Bia", 94, { noPrazo: 1 }), linha("Caio", 80)])], "P");
    expect(quem(r)).toBe("DIVIDIDO:Ana+Edu"); // em ordem de nome
    expect(TEXTO_CRITERIO.DIVIDIDO).toBe("Empate em todos os critérios: o prêmio é dividido");
    // É determinístico: a ordem em que as linhas chegam não muda o resultado
    expect(quem(ganhadoresDoPremio([grupo("P", [linha("Caio", 80), linha("Bia", 94, { noPrazo: 1 }), linha("Ana", 94), linha("Edu", 94)])], "P"))).toBe("DIVIDIDO:Ana+Edu");
  });

  it("um só concorrente acima da meta ganha pelo escore; todo critério tem o texto que a tela mostra", () => {
    expect(quem(ganhadoresDoPremio([grupo("P", [linha("Ana", 71)])], "P"))).toBe("ESCORE:Ana");
    expect(Object.keys(TEXTO_CRITERIO)).toEqual([...CRITERIOS]);
    expect(TEXTO_CRITERIO.PRAZO).toContain("mais atividades no prazo");
    expect(TEXTO_CRITERIO.AVALIACAO).toContain("maior média de avaliação");
    expect(TEXTO_CRITERIO.PENALIDADES).toContain("menos penalidades");
  });

  it("os prêmios do mês: cada um no seu escopo (perfil ou geral), com os ganhadores e o critério", () => {
    const painel = {
      grupos: [grupo("Preventiva", [linha("Ana", 95), linha("Bia", 95, { media: 4 })]), grupo("Corretiva", [linha("Edu", 97)]), grupo("Instalação", [linha("Ivo", 50)])],
      premiacoes: [
        { id: "p1", titulo: "Kit", descricao: "Brinde", perfil: "Preventiva", temImagem: true }, { id: "p2", titulo: "Jantar", descricao: null, perfil: null, temImagem: false },
        { id: "p3", titulo: "Folga", descricao: null, perfil: "Instalação", temImagem: false },
      ],
    };
    expect(premiosDoMes(painel)).toEqual([
      { premiacaoId: "p1", titulo: "Kit", descricao: "Brinde", perfil: "Preventiva", ganhadores: [{ tecnicoId: "ana", nome: "Ana", escore: 95 }], criterio: "AVALIACAO" },
      { premiacaoId: "p2", titulo: "Jantar", descricao: null, perfil: null, ganhadores: [{ tecnicoId: "edu", nome: "Edu", escore: 97 }], criterio: "ESCORE" },
      { premiacaoId: "p3", titulo: "Folga", descricao: null, perfil: "Instalação", ganhadores: [], criterio: null },
    ]);
    expect(premiosDoMes({ grupos: painel.grupos, premiacoes: [] })).toEqual([]);
  });

  it("prêmios gravados (JSON): só o que tem a forma certa; critério desconhecido vira vazio", () => {
    const ok = { premiacaoId: "p1", titulo: "Kit", descricao: null, perfil: null, ganhadores: [], criterio: "ESCORE" };
    expect(lerPremios([ok, { titulo: "Sem ganhadores" }, null, "x", { ...ok, criterio: "SORTEIO" }])).toEqual([ok, { ...ok, criterio: null }]);
    for (const lixo of [null, undefined, "texto", {}, 5]) expect(lerPremios(lixo)).toEqual([]);
  });
});

describe("valores em reais só para quem pode", () => {
  it("o painel congelado sem valores: sem bônus e sem valor de faixa — o resto igual; o original não é alterado", () => {
    const painel = { competencia: "2026-11", grupos: [grupo("P", [linha("Ana", 95), linha("Bia", 75)]), { ...grupo("Sem regra", [linha("Ivo", null)]), regra: null }], equipes: [], premiacoes: [] };
    const limpo = semValores(painel);
    expect(limpo.grupos.flatMap((g) => g.linhas.map((l) => l.bonus))).toEqual([null, null, null]);
    expect(limpo.grupos[0].regra?.faixas).toEqual([{ nome: "Ouro", minimo: 90, valor: null }]);
    expect(limpo.grupos[1].regra).toBeNull();
    expect(limpo.grupos[0].linhas.map((l) => `${l.nome}:${l.escore}:${l.faixa}`)).toEqual(["Ana:95:Ouro", "Bia:75:null"]);
    expect(JSON.stringify(limpo)).not.toMatch(/"(bonus|valor)":\s*\d/);
    expect(painel.grupos[0].linhas[0].bonus).toBe(350);
    expect(painel.grupos[0].regra?.faixas[0].valor).toBe(350);
  });
});

describe("exportação da folha", () => {
  const folha = { linhas: [
    { tecnicoId: "ana", nome: "Ana; Dias", perfil: "Preventiva", posicao: 1, escore: 95.5, faixa: "Ouro", valor: 1350.5 },
    { tecnicoId: "bia", nome: "Bia", perfil: "Preventiva", posicao: null, escore: null, faixa: null, valor: 0 },
    { tecnicoId: null, nome: "Saiu da empresa", perfil: "Corretiva", posicao: 2, escore: 80, faixa: "Prata", valor: 200 },
  ], total: 1550.5 };
  const premios: PremioFechado[] = [
    { premiacaoId: "p1", titulo: "Kit", descricao: null, perfil: null, ganhadores: [{ tecnicoId: "ana", nome: "Ana", escore: 95.5 }], criterio: "ESCORE" },
    { premiacaoId: "p2", titulo: "Jantar", descricao: null, perfil: null, ganhadores: [{ tecnicoId: "ana", nome: "Ana", escore: 95.5 }, { tecnicoId: "bia", nome: "Bia", escore: 95.5 }], criterio: "DIVIDIDO" },
  ];

  it("cabeçalho, uma linha por colaborador e o total; números no padrão brasileiro; sem medição fica em branco", () => {
    expect(linhasDoCsv("2026-11", folha, premios)).toEqual([
      ["Competência", "Colaborador", "Perfil", "Posição", "Escore (%)", "Faixa", "Bônus (R$)", "Premiação"],
      ["11/2026", "Ana; Dias", "Preventiva", "1", "95,5", "Ouro", "1350,50", "Kit / Jantar"],
      ["11/2026", "Bia", "Preventiva", "", "", "", "0,00", "Jantar"],
      ["11/2026", "Saiu da empresa", "Corretiva", "2", "80,0", "Prata", "200,00", ""], // sem colaborador ligado, não herda prêmio de ninguém
      ["", "Total", "", "", "", "", "1550,50", ""],
    ]);
  });

  it("SÓ o valor do bônus: nenhuma coluna de imposto, encargo, desconto ou líquido", () => {
    const [cabecalho] = linhasDoCsv("2026-11", folha, premios);
    expect(cabecalho).toHaveLength(8);
    expect(cabecalho.join(" ")).not.toMatch(/imposto|encargo|inss|irrf|fgts|l[ií]quido|desconto/i);
  });

  it("nome do arquivo: o mês; a partir do 2º fechamento, a versão", () => {
    expect(nomeDoArquivo("2026-11", 1)).toBe("bonus-desempenho-2026-11.csv");
    expect(nomeDoArquivo("2026-11", 2)).toBe("bonus-desempenho-2026-11-v2.csv");
  });
});

describe("o que a tela manda", () => {
  it("fechar: o mês e, quando há aviso, a confirmação — ninguém manda valor, escore nem ganhador", () => {
    expect(fecharSchema.parse({ competencia: "2026-11" })).toEqual({ competencia: "2026-11" });
    expect(fecharSchema.parse({ competencia: "2026-11", ciente: true })).toEqual({ competencia: "2026-11", ciente: true });
    for (const ruim of [{}, { competencia: "11/2026" }, { competencia: "2026-13" }, { competencia: "2026-11", ciente: "sim" }]) expect(fecharSchema.safeParse(ruim).success, JSON.stringify(ruim)).toBe(false);
    for (const extra of [{ ganhadores: { p1: ["ana"] } }, { total: 9999 }, { linhas: [] }, { versao: 5 }]) expect(fecharSchema.safeParse({ competencia: "2026-11", ...extra }).success, JSON.stringify(extra)).toBe(false);
  });

  it("reabrir: o motivo é obrigatório (mín. 10, máx. 500), aparado", () => {
    expect(reabrirSchema.parse({ motivo: "  Faltou revisar a ressalva  " })).toEqual({ motivo: "Faltou revisar a ressalva" });
    const erro = (x: object) => { const r = reabrirSchema.safeParse(x); return r.success ? null : r.error.issues[0].message; };
    expect(erro({})).toBe(MSG_MOTIVO_REABERTURA);
    expect(erro({ motivo: "   curto   " })).toBe(MSG_MOTIVO_REABERTURA);
    expect(erro({ motivo: "123456789" })).toBe(MSG_MOTIVO_REABERTURA);
    expect(erro({ motivo: "1234567890" })).toBeNull();
    expect(erro({ motivo: "x".repeat(501) })).toBe("Motivo com no máximo 500 caracteres.");
    expect(erro({ motivo: "Motivo válido aqui", situacao: "FECHADO" })).not.toBeNull();
  });
});

describe("app do técnico: a vista Desempenho no endereço", () => {
  it("?ver=desempenho abre a vista; a vista vira o endereço certo; valor desconhecido cai no Meu dia", () => {
    expect(lerVista("?ver=desempenho")).toEqual({ ver: "desempenho" });
    expect(urlDaVista({ ver: "desempenho" })).toBe("/tecnico?ver=desempenho");
    expect(lerVista("?ver=fechamento")).toEqual({ ver: "dia" });
    expect(lerVista("?ver=perfil")).toEqual({ ver: "perfil" });
  });
});
