/**
 * NFS-e PR3 — regras puras da nota (lib/nfse/nota.ts): status do PlugNotas, pré-validação
 * (emitente, medição, tomador, itens), rateio do desconto, agrupamento "uma nota por código",
 * discriminação, o corpo do POST /nfse e a leitura das respostas (emissão e consulta).
 */
import { describe, expect, it } from "vitest";
import {
  agruparNotas, aguardandoResposta, corpoNotaPlugNotas, discriminacaoPadrao, lerConsulta, lerData, lerEmissao, MAX_DISCRIMINACAO,
  pendenciasEmitente, pendenciasItens, pendenciasMedicao, pendenciasNotas, pendenciasTomador, ratearDesconto, STATUS_MEDICAO_EMITE,
  statusDaSituacao, statusVivo, type EmitenteEmissao, type ItemEmissao, type TomadorEmissao,
} from "@/lib/nfse/nota";

const textos = (p: { texto: string }[]) => p.map((x) => x.texto);

describe("status", () => {
  it("situação do PlugNotas → status (variações de grafia); desconhecida = null", () => {
    for (const s of ["CONCLUIDO", "concluído", "Concluida", "AUTORIZADO", "autorizada"]) expect(statusDaSituacao(s)).toBe("CONCLUIDO");
    for (const s of ["PROCESSANDO", "em_processamento", "AGUARDANDO", "pendente"]) expect(statusDaSituacao(s)).toBe("PROCESSANDO");
    for (const s of ["REJEITADO", "rejeitada", "DENEGADO", "Denegada"]) expect(statusDaSituacao(s)).toBe("REJEITADO");
    for (const s of ["CANCELADO", "cancelada"]) expect(statusDaSituacao(s)).toBe("CANCELADO");
    for (const s of ["INTERROMPIDO", "interrompida", "EXCEPTION", "exceção", "ERRO"]) expect(statusDaSituacao(s)).toBe("INTERROMPIDO");
    for (const s of ["", "  ", null, undefined, "QUALQUER"]) expect(statusDaSituacao(s)).toBeNull();
    expect(statusDaSituacao(" concluido ")).toBe("CONCLUIDO");
  });

  it("vivas (prendem os itens) e esperando resposta", () => {
    expect(["ENVIANDO", "PROCESSANDO", "CONCLUIDO", "REJEITADO", "CANCELADO", "INTERROMPIDO"].filter(statusVivo)).toEqual(["ENVIANDO", "PROCESSANDO", "CONCLUIDO"]);
    expect(["ENVIANDO", "PROCESSANDO", "CONCLUIDO", "REJEITADO"].filter(aguardandoResposta)).toEqual(["ENVIANDO", "PROCESSANDO"]);
  });
});

describe("pré-validação", () => {
  const AGORA = new Date("2026-10-29T12:00:00Z");
  const ok: EmitenteEmissao = {
    status: "ATIVO", cnpj: "12345678000190", ambiente: "HOMOLOGACAO", emitenteAmbiente: "HOMOLOGACAO",
    certificadoValidoAte: new Date("2027-01-01"), tokenDisponivel: true, producaoLiberada: false,
  };

  it("emitente: ativo, mesmo ambiente, produção fechada nesta fase, certificado, token", () => {
    expect(pendenciasEmitente(ok, AGORA)).toEqual([]);
    expect(pendenciasEmitente({ ...ok, status: "PENDENTE" }, AGORA)).toEqual([{ area: "emitente", texto: "A empresa ainda não está ativa como emitente no PlugNotas.", link: "/configuracoes/dados-fiscais", rotuloLink: "Abrir Dados fiscais" }]);
    expect(textos(pendenciasEmitente({ ...ok, cnpj: null }, AGORA))).toEqual(["A empresa ainda não está ativa como emitente no PlugNotas."]);
    expect(textos(pendenciasEmitente({ ...ok, emitenteAmbiente: "PRODUCAO" }, AGORA))).toEqual(["O emitente foi cadastrado em Produção, mas a empresa está em Homologação (testes): salve os Dados fiscais de novo."]);
    expect(textos(pendenciasEmitente({ ...ok, emitenteAmbiente: null }, AGORA))).toEqual(["O emitente foi cadastrado em outro ambiente, mas a empresa está em Homologação (testes): salve os Dados fiscais de novo."]);
    const prod = { ...ok, ambiente: "PRODUCAO" as const, emitenteAmbiente: "PRODUCAO" };
    expect(textos(pendenciasEmitente(prod, AGORA))).toEqual(["A emissão em Produção ainda não está liberada: nesta fase as notas saem só em Homologação (testes)."]);
    expect(pendenciasEmitente({ ...prod, producaoLiberada: true }, AGORA)).toEqual([]);
    expect(textos(pendenciasEmitente({ ...ok, certificadoValidoAte: new Date("2026-10-29T11:59:59Z") }, AGORA))).toEqual(["O certificado digital venceu: envie o novo em Dados fiscais."]);
    expect(pendenciasEmitente({ ...ok, certificadoValidoAte: null }, AGORA)).toEqual([]);
    // vence no próprio instante ou depois: ainda vale
    expect(pendenciasEmitente({ ...ok, certificadoValidoAte: new Date("2026-10-29T12:00:00Z") }, AGORA)).toEqual([]);
    expect(pendenciasEmitente({ ...ok, certificadoValidoAte: new Date("2026-10-29T12:00:01Z") }, AGORA)).toEqual([]);
    // sem emitente ativo: só esse aviso (o resto não faz sentido ainda)
    expect(textos(pendenciasEmitente({ ...ok, status: "NAO_CONFIGURADO", cnpj: null, emitenteAmbiente: null, tokenDisponivel: false, certificadoValidoAte: new Date("2020-01-01") }, AGORA)))
      .toEqual(["A empresa ainda não está ativa como emitente no PlugNotas."]);
    expect(pendenciasEmitente({ ...ok, tokenDisponivel: false }, AGORA)).toEqual([{ area: "emitente", texto: "A integração com o PlugNotas não está configurada neste servidor (falta o token). Avise o suporte." }]);
  });

  it("medição: aprovada (PC recebido em diante), não cancelada, sem NF registrada à mão", () => {
    const m = { id: "m1", numero: "MED-1", status: "PC_RECEBIDO", nfManual: null };
    expect(STATUS_MEDICAO_EMITE).toEqual(["PC_RECEBIDO", "NF_EMITIDA", "BOLETO_GERADO", "PAGO"]);
    for (const status of STATUS_MEDICAO_EMITE) expect(pendenciasMedicao({ ...m, status }, "x")).toEqual([]);
    for (const status of ["RASCUNHO", "AGUARDANDO_APROVACAO", "APROVADA", "AGUARDANDO_PC"]) {
      expect(pendenciasMedicao({ ...m, status }, "Aguardando PC")).toEqual([{ area: "medicao", texto: "A medição MED-1 precisa estar aprovada (e com o pedido de compra, se o cliente exige) antes da nota. Hoje está “Aguardando PC”.", link: "/financeiro/medicoes/m1", rotuloLink: "Abrir a medição" }]);
    }
    expect(textos(pendenciasMedicao({ ...m, status: "CANCELADA" }, "x"))).toEqual(["A medição MED-1 está cancelada."]);
    expect(textos(pendenciasMedicao({ ...m, nfManual: "555" }, "x"))).toEqual(["A medição MED-1 já tem NF registrada à mão (nº 555): não emitimos outra."]);
  });

  const tomador: TomadorEmissao = {
    id: "c1", nome: "Condomínio", cpfCnpj: "11.222.333/0001-81", endereco: "Rua A", numero: "1", bairro: "Centro",
    cidade: "Goiânia", estado: "go", cep: "74000-000", codigoCidade: "5208707",
  };
  it("tomador: CPF/CNPJ com dígito certo, nome, endereço completo, código IBGE", () => {
    expect(pendenciasTomador(tomador)).toEqual([]);
    expect(pendenciasTomador({ ...tomador, cpfCnpj: "529.982.247-25" })).toEqual([]);
    expect(pendenciasTomador({ ...tomador, cpfCnpj: "11.222.333/0001-82" })).toEqual([{ area: "tomador", texto: "CPF/CNPJ do cliente inválido.", link: "/clientes/c1/editar", rotuloLink: "Editar o cliente" }]);
    for (const doc of ["529.982.247-24", "123", "", "111.111.111-11"]) expect(textos(pendenciasTomador({ ...tomador, cpfCnpj: doc }))).toEqual(["CPF/CNPJ do cliente inválido."]);
    expect(textos(pendenciasTomador({ ...tomador, nome: " " }))).toEqual(["Nome / razão social do cliente."]);
    expect(textos(pendenciasTomador({ ...tomador, endereco: null, numero: "", bairro: " ", cidade: undefined, estado: "G", cep: "7400" })))
      .toEqual(["Endereço do cliente: logradouro, número, bairro, cidade, UF, CEP."]);
    expect(textos(pendenciasTomador({ ...tomador, estado: null }))).toEqual(["Endereço do cliente: UF."]);
    expect(textos(pendenciasTomador({ ...tomador, codigoCidade: null }))).toEqual(["Não achamos o código IBGE da cidade do cliente (Goiânia/GO, CEP 74000000): confira o CEP e a cidade."]);
    expect(textos(pendenciasTomador({ ...tomador, codigoCidade: "520870" }))).toHaveLength(1);
    // endereço incompleto: o IBGE não é cobrado (falta o mais básico antes)
    expect(textos(pendenciasTomador({ ...tomador, cep: null, codigoCidade: null }))).toEqual(["Endereço do cliente: CEP."]);
  });

  const hig = { id: "sHig", nome: "Higienização", codigoLc116: "14.01", codigoMunicipal: "140101", aliquotaISS: 5 };
  const it1: ItemEmissao = { id: "i1", tipo: "SERVICO", descricao: "Higienização", quantidade: 1, valorTotal: 100, servico: hig };
  it("itens: serviço do catálogo e os dados fiscais dele (o ISS da empresa vale quando o serviço não tem)", () => {
    const o = { aliquotaPadrao: null, cnaeEmpresa: null };
    expect(pendenciasItens([it1], o)).toEqual([]);
    expect(pendenciasItens([{ ...it1, servico: null }], o)).toEqual([{ area: "item", itemId: "i1", texto: "Item “Higienização”: escolha o serviço do catálogo (de onde vêm os dados fiscais)." }]);
    const semLc = { ...it1, servico: { ...hig, codigoLc116: null, aliquotaISS: null } };
    expect(pendenciasItens([semLc], o)).toEqual([{ area: "servico", texto: "Serviço “Higienização”: falta Código do serviço (LC 116) e Alíquota de ISS.", link: "/configuracoes/servicos", rotuloLink: "Abrir Serviços" }]);
    expect(textos(pendenciasItens([semLc], { ...o, aliquotaPadrao: 3 }))).toEqual(["Serviço “Higienização”: falta Código do serviço (LC 116)."]);
    // o mesmo serviço em 2 itens: avisa uma vez; produto, item já em nota e item zerado não contam
    expect(pendenciasItens([semLc, { ...semLc, id: "i2" }], o)).toHaveLength(1);
    expect(pendenciasItens([{ ...it1, tipo: "PRODUTO", servico: null }, { ...it1, emNota: true, servico: null }, { ...it1, valorTotal: 0, servico: null }], o)).toEqual([]);
  });

  it("notas: discriminação vazia ou acima de 2000 caracteres", () => {
    expect(MAX_DISCRIMINACAO).toBe(2000);
    const g = { chave: "k", rotulo: "Código 1" };
    expect(pendenciasNotas([{ ...g, discriminacao: "ok" }, { ...g, discriminacao: "x".repeat(2000) }])).toEqual([]);
    expect(pendenciasNotas([{ ...g, discriminacao: "  " }])).toEqual([{ area: "nota", chave: "k", texto: "Código 1: escreva a discriminação do serviço." }]);
    expect(textos(pendenciasNotas([{ ...g, discriminacao: "x".repeat(2001) }]))).toEqual(["Código 1: a discriminação passou de 2000 caracteres (tem 2001)."]);
  });
});

describe("rateio do desconto", () => {
  it("proporcional ao valor, em centavos exatos (a soma fecha)", () => {
    expect(ratearDesconto([300, 600, 100], 100)).toEqual([30, 60, 10]);
    expect(ratearDesconto([1, 1, 1], 1)).toEqual([0.34, 0.33, 0.33]);
    expect(ratearDesconto([10, 20], 0.01)).toEqual([0, 0.01]);
    const r = ratearDesconto([33.33, 33.33, 33.34], 10);
    expect(Math.round(r.reduce((s, x) => s + x, 0) * 100)).toBe(1000);
    expect(r).toEqual([3.33, 3.33, 3.34]);
  });
  it("sem desconto, sem valor, desconto maior que o total (limita) e negativo (zera)", () => {
    expect(ratearDesconto([100, 50], 0)).toEqual([0, 0]);
    expect(ratearDesconto([0, 0], 10)).toEqual([0, 0]);
    expect(ratearDesconto([100, 50], 1000)).toEqual([100, 50]);
    expect(ratearDesconto([100, 50], -5)).toEqual([0, 0]);
    expect(ratearDesconto([], 5)).toEqual([]);
  });
});

describe("agrupamento: uma nota por código", () => {
  const o = { aliquotaPadrao: 3.5, cnaeEmpresa: "4322302" };
  const ctx = { medicaoNumero: "MED-1", osNumeros: ["OS-9"] };
  const srv = (id: string, x: Record<string, unknown> = {}) => ({ id, nome: id, codigoLc116: "14.01", codigoMunicipal: "140101", aliquotaISS: 5, ...x });
  const item = (id: string, valor: number, servico: any, x: Partial<ItemEmissao> = {}): ItemEmissao => ({ id, tipo: "SERVICO", descricao: `Item ${id}`, quantidade: 1, valorTotal: valor, servico, ...x });

  it("mesmo código e mesma regra de ISS = mesma nota; código diferente = outra nota; ordem dos itens", () => {
    const g = agruparNotas([
      item("a", 300, srv("hig")), item("b", 600, srv("ins", { codigoLc116: "14.06", codigoMunicipal: "140601", aliquotaISS: null })), item("c", 100, srv("man")),
    ], 0, o, ctx);
    expect(g.map((x) => [x.rotulo, x.itens.map((i) => i.item.id), x.valorServicos, x.aliquota, x.codigoLc116, x.codigoTributacao])).toEqual([
      ["Código 140101 (LC 116 14.01)", ["a", "c"], 400, 5, "14.01", "140101"],
      ["Código 140601 (LC 116 14.06)", ["b"], 600, 3.5, "14.06", "140601"],
    ]);
    expect(g[1].servico).toEqual({ codigo: "14.06", codigoTributacao: "140601", cnae: "4322302", iss: { tipoTributacao: 6, exigibilidade: 1, aliquota: 3.5, retido: false } });
  });

  it("mesmo código com ISS diferente (alíquota, retido, tributação, CNAE) = notas separadas, com o ISS no rótulo", () => {
    const g = agruparNotas([
      item("a", 100, srv("x")), item("b", 100, srv("y", { aliquotaISS: 2 })), item("c", 100, srv("z", { issRetido: true })),
      item("d", 100, srv("w", { nfseTributacao: "ISENTO" })), item("e", 100, srv("v", { cnae: "4321500" })),
    ], 0, o, ctx);
    expect(g.map((x) => x.rotulo)).toEqual([
      "Código 140101 (LC 116 14.01) · ISS 5%", "Código 140101 (LC 116 14.01) · ISS 2%", "Código 140101 (LC 116 14.01) · ISS 5% retido",
      "Código 140101 (LC 116 14.01) · ISS 5%", "Código 140101 (LC 116 14.01) · ISS 5%",
    ]);
    expect(g[2].retido).toBe(true);
    expect(g[2].servico).toMatchObject({ iss: { retido: true }, responsavelRetencao: 1 });
    expect(g[3].servico.iss).toEqual({ tipoTributacao: 1, exigibilidade: 3, aliquota: 5, retido: false });
  });

  it("sem código municipal: o LC 116 vira o código (sem repetir no rótulo); 2,5% com vírgula", () => {
    const g = agruparNotas([item("a", 10, srv("x", { codigoMunicipal: null, aliquotaISS: 2.5 })), item("b", 10, srv("y", { codigoMunicipal: "  ", aliquotaISS: 2.5, issRetido: true }))], 0, o, ctx);
    expect(g.map((x) => [x.codigoTributacao, x.rotulo])).toEqual([["14.01", "Código 14.01 · ISS 2,5%"], ["14.01", "Código 14.01 · ISS 2,5% retido"]]);
  });

  it("fora da nota: produto, item já em nota, sem serviço, serviço com pendência, valor zero", () => {
    const g = agruparNotas([
      item("p", 100, null, { tipo: "PRODUTO" }), item("n", 100, srv("a"), { emNota: true }), item("s", 100, null),
      item("l", 100, srv("b", { codigoLc116: null })), item("z", 0, srv("c")), item("ok", 50, srv("d")),
    ], 0, o, ctx);
    expect(g.map((x) => x.itens.map((i) => i.item.id))).toEqual([["ok"]]);
  });

  it("desconto rateado por TODOS os itens (a parte dos produtos não vai para a NFS-e)", () => {
    const g = agruparNotas([item("a", 300, srv("x")), item("p", 100, null, { tipo: "PRODUTO" }), item("b", 600, srv("y", { codigoMunicipal: "999" }))], 100, o, ctx);
    expect(g.map((x) => [x.valorServicos, x.valorDesconto, x.itens.map((i) => i.desconto)])).toEqual([[300, 30, [30]], [600, 60, [60]]]);
    const somados = agruparNotas([item("a", 0.1, srv("x")), item("b", 0.2, srv("x"))], 0.03, o, ctx);
    expect([somados[0].valorServicos, somados[0].valorDesconto]).toEqual([0.3, 0.03]);
  });

  it("discriminação: texto base dos serviços (sem repetir), itens com qtd × valor, referência; '|' quebra a linha", () => {
    const base = srv("x", { discriminacaoPadrao: " Higienização completa " });
    const d = discriminacaoPadrao({ itens: [
      { item: item("a", 300, base, { descricao: " Split 12k ", quantidade: 2 }), desconto: 0 },
      { item: item("b", 100, base, { descricao: "Split 9k", quantidade: 1 }), desconto: 0 },
      { item: item("c", 75, srv("y", { discriminacaoPadrao: "Manutenção" }), { descricao: "Filtro", quantidade: 1.5 }), desconto: 0 },
      { item: item("d", 30, srv("w"), { descricao: "Visita", quantidade: 0 }), desconto: 0 },
    ] }, { medicaoNumero: "MED-7", osNumeros: ["2026-1", "2026-2"] });
    expect(d).toBe("Higienização completa | Manutenção | Split 12k — 2 x R$ 150,00 = R$ 300,00 | Split 9k — R$ 100,00 | Filtro — 1,5 x R$ 50,00 = R$ 75,00 | Visita — R$ 30,00 | Ref.: Medição MED-7 · OS 2026-1, 2026-2");
    expect(d).not.toMatch(/ /);
    expect(discriminacaoPadrao({ itens: [{ item: item("a", 10, srv("x")), desconto: 0 }] }, { medicaoNumero: "MED-7" })).toBe("Item a — R$ 10,00 | Ref.: Medição MED-7");
    expect(discriminacaoPadrao({ itens: [{ item: item("a", 10, srv("x")), desconto: 0 }] }, { medicaoNumero: "MED-7", osNumeros: [] })).toBe("Item a — R$ 10,00 | Ref.: Medição MED-7");
    expect(agruparNotas([item("a", 10, srv("x"))], 0, o, ctx)[0].discriminacao).toBe("Item a — R$ 10,00 | Ref.: Medição MED-1 · OS OS-9");
  });
});

describe("corpo da nota (POST /nfse)", () => {
  const tomador: TomadorEmissao = {
    id: "c1", nome: " Condomínio Jardim ", cpfCnpj: "11.222.333/0001-81", email: " nf@x.com ",
    endereco: "Av. Goiás", numero: " 100 ", complemento: " Bl B ", bairro: " Centro ", cidade: " Senador Canedo ", estado: "go", cep: "75250-000", codigoCidade: "5220454",
  };
  const servico = { codigo: "14.01", codigoTributacao: "140101", iss: { tipoTributacao: 6 as const, exigibilidade: 1 as const, aliquota: 5, retido: false } };

  it("prestador pelo CNPJ, tomador com endereço, um servico com a discriminação e o valor (desconto incondicionado)", () => {
    expect(corpoNotaPlugNotas({ id: "nota1", prestadorCnpj: "12.345.678/0001-90", tomador, servico, discriminacao: " Texto ", valorServicos: 400, valorDesconto: 40 })).toEqual({
      idIntegracao: "nota1",
      prestador: { cpfCnpj: "12345678000190" },
      tomador: {
        cpfCnpj: "11222333000181", razaoSocial: "Condomínio Jardim", email: "nf@x.com",
        endereco: { descricaoCidade: "Senador Canedo", cep: "75250000", tipoLogradouro: "Avenida", logradouro: "Goiás", tipoBairro: "Bairro", codigoCidade: "5220454", complemento: "Bl B", estado: "GO", numero: "100", bairro: "Centro" },
      },
      servico: [{ ...servico, discriminacao: "Texto", valor: { servico: 400, descontoIncondicionado: 40 } }],
    });
  });

  it("sem e-mail, sem complemento e sem desconto: os campos não vão", () => {
    const c = corpoNotaPlugNotas({ id: "n", prestadorCnpj: "12345678000190", tomador: { ...tomador, email: "  ", complemento: null }, servico, discriminacao: "x", valorServicos: 10, valorDesconto: 0 });
    expect(c.tomador).not.toHaveProperty("email");
    expect(c.tomador.endereco).not.toHaveProperty("complemento");
    expect(c.servico[0].valor).toEqual({ servico: 10 });
  });
});

describe("respostas do PlugNotas", () => {
  it("emissão: { documents: [{ id }], protocol } (direto ou em data); acha a nota pelo idIntegracao; sem id = null", () => {
    expect(lerEmissao({ documents: [{ idIntegracao: "n1", prestador: "123", id: "pn1" }], message: "Nota(as) em processamento", protocol: "p-1" }, "n1")).toEqual({ id: "pn1", protocolo: "p-1" });
    expect(lerEmissao({ data: { documents: [{ idIntegracao: "x", id: "pnX" }, { idIntegracao: "n1", id: "pn1" }], protocolo: "p-2" } }, "n1")).toEqual({ id: "pn1", protocolo: "p-2" });
    expect(lerEmissao({ documents: [{ id: "pn9" }] }, "n1")).toEqual({ id: "pn9", protocolo: null });
    expect(lerEmissao([{ id: "pnA", protocol: "pa" }], "n1")).toEqual({ id: "pnA", protocolo: "pa" });
    expect(lerEmissao({ id: "pnB", protocolo: "pb" }, "n1")).toEqual({ id: "pnB", protocolo: "pb" });
    expect(lerEmissao({ documents: [{ _id: "pnC" }], protocol: "pc" }, "n1")).toEqual({ id: "pnC", protocolo: "pc" });
    expect(lerEmissao({ documents: [], protocol: "p" }, "n1")).toBeNull();
    expect(lerEmissao({ message: "ok" }, "n1")).toBeNull();
    expect(lerEmissao(null, "n1")).toBeNull();
  });

  it("datas: ISO e dd/mm/aaaa [hh:mm[:ss]] no horário de Brasília; inválida = null", () => {
    expect(lerData("2026-10-29T10:00:00Z")).toEqual(new Date("2026-10-29T10:00:00Z"));
    expect(lerData("29/10/2026")).toEqual(new Date("2026-10-29T03:00:00Z"));
    expect(lerData("29/10/2026 14:05")).toEqual(new Date("2026-10-29T17:05:00Z"));
    expect(lerData("29/10/2026 14:05:09")).toEqual(new Date("2026-10-29T17:05:09Z"));
    // só ISO ou dd/mm/aaaa: o resto que o Date "entende" ("12" = dez/2001) não vale
    for (const v of ["", null, undefined, "ontem", 12, "12", "Oct 29 2026", "2026/10/29"]) expect(lerData(v)).toBeNull();
  });

  const nota = { id: "pn1", idIntegracao: "n1", situacao: "CONCLUIDO", numero: "77", numeroNfse: "1001", codigoVerificacao: "AB-12", mensagem: "Nota autorizada", pdf: "https://api/pdf/pn1", xml: "https://api/xml/pn1", emissao: "29/10/2026" };
  it("consulta: lista, { data: [...] }, { data: {...} } ou objeto; o número é o da NFS-e (não o do RPS)", () => {
    const esperado = { id: "pn1", situacao: "CONCLUIDO", status: "CONCLUIDO", numero: "1001", codigoVerificacao: "AB-12", mensagem: "Nota autorizada", pdf: "https://api/pdf/pn1", xml: "https://api/xml/pn1", autorizadaEm: new Date("2026-10-29T03:00:00Z") };
    expect(lerConsulta([nota])).toEqual(esperado);
    expect(lerConsulta({ data: [nota] })).toEqual(esperado);
    expect(lerConsulta({ data: nota })).toEqual(esperado);
    expect(lerConsulta(nota)).toEqual(esperado);
    expect(lerConsulta({ ...nota, numeroNfse: undefined })!.numero).toBeNull();
    expect(lerConsulta({ ...nota, numeroNfse: undefined, numeroNFSe: 55 })!.numero).toBe("55");
    expect(lerConsulta({ ...nota, numeroNfse: undefined, nfse: { numero: "66", codigoVerificacao: "ZZ" }, codigoVerificacao: undefined })).toMatchObject({ numero: "66", codigoVerificacao: "ZZ" });
  });

  it("consulta: escolhe a nota pelo id ou pelo idIntegracao; vazia = null", () => {
    const outra = { ...nota, id: "pn2", idIntegracao: "n2", numeroNfse: "2002" };
    expect(lerConsulta([outra, nota], { id: "pn1" })!.numero).toBe("1001");
    expect(lerConsulta([outra, nota], { idIntegracao: "n1" })!.numero).toBe("1001");
    expect(lerConsulta([outra, nota], { id: "zzz" })!.numero).toBe("2002");
    expect(lerConsulta([])).toBeNull();
    expect(lerConsulta(null)).toBeNull();
    expect(lerConsulta("texto")).toBeNull();
  });

  it("consulta: motivo da rejeição (mensagem, motivo ou retorno), status pelo campo situacao ou status, datas alternativas", () => {
    expect(lerConsulta({ id: "a", status: "REJEITADO", motivo: "CNPJ inválido" })).toMatchObject({ status: "REJEITADO", mensagem: "CNPJ inválido", pdf: null, xml: null, autorizadaEm: null });
    expect(lerConsulta({ id: "a", situacao: "REJEITADO", retorno: { mensagemRetorno: "E160 - código inválido" } })!.mensagem).toBe("E160 - código inválido");
    expect(lerConsulta({ id: "a", situacao: "REJEITADO", retorno: { mensagem: "E1" } })!.mensagem).toBe("E1");
    expect(lerConsulta({ id: "a", situacao: "XYZ" })).toMatchObject({ situacao: "XYZ", status: null });
    expect(lerConsulta({ id: "a", situacao: "CONCLUIDO", dataAutorizacao: "2026-10-30T10:00:00Z", emissao: "29/10/2026" })!.autorizadaEm).toEqual(new Date("2026-10-30T10:00:00Z"));
    expect(lerConsulta({ id: "a", situacao: "CONCLUIDO", autorizacao: "2026-10-31T10:00:00Z" })!.autorizadaEm).toEqual(new Date("2026-10-31T10:00:00Z"));
    expect(lerConsulta({ id: "a", situacao: "CONCLUIDO", dataEmissao: "2026-11-01T10:00:00Z" })!.autorizadaEm).toEqual(new Date("2026-11-01T10:00:00Z"));
    expect(lerConsulta({ situacao: "PROCESSANDO" })!.id).toBeNull();
  });
});
