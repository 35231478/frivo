/**
 * Execução da OS — regras puras: o que falta para concluir (por equipamento, com a mensagem exata),
 * o plano de edição do checklist do tipo (atualiza/cria/inativa, nunca apaga) e os checklists sugeridos.
 */
import { describe, expect, it } from "vitest";
import {
  MSG_SEM_EQUIPAMENTO, completo, contarFotosPorItem, respondido, faltasEquipamento, listaCurta, paraPendencia, rotuloCurto, textoFaltas, verificarConclusao,
  type EquipamentoParaPendencia, type ItemExecucao, type RespostaItem, type StatusItem,
} from "@/lib/execucao/pendencias";
import { checklistSchema, planejarChecklist } from "@/lib/checklist/tipo";
import { ITENS_BASE, ITENS_BASE_E1, TIPOS_PADRAO, TIPOS_PADRAO_E1, checklistSugerido } from "@/lib/checklist/padrao";

const ITENS: ItemExecucao[] = [
  { id: "i1", texto: "Limpeza dos filtros", pedirFoto: true, pedirObservacao: false, ativo: true, tipoResposta: "OK_ATENCAO_NA", unidade: null },
  { id: "i2", texto: "Medição de corrente", pedirFoto: false, pedirObservacao: true, ativo: true, tipoResposta: "OK_ATENCAO_NA", unidade: null },
  { id: "i3", texto: "Teste de funcionamento", pedirFoto: false, pedirObservacao: false, ativo: true, tipoResposta: "OK_ATENCAO_NA", unidade: null },
];
/** Uma resposta (medição/áudio vazios, a não ser que venham em `extra`) */
const r = (status: StatusItem | null, observacao: string | null = null, extra: Partial<RespostaItem> = {}): RespostaItem =>
  ({ status, observacao, valor: null, unidade: null, audio: false, ...extra });
const equip = (extra: Partial<EquipamentoParaPendencia> = {}): EquipamentoParaPendencia => ({
  equipamentoId: "eqA", titulo: "Split Sala 1 (TAG AC-01)", feito: true, itens: ITENS, respostas: {}, fotosPorItem: {}, formulario: null, ...extra,
});
const tudoOk = {
  i1: r("OK"), i2: r("OK", "6 A"), i3: r("OK"),
};

describe("o que falta em um equipamento", () => {
  it("item sem resposta; foto e observação que o item pede", () => {
    expect(faltasEquipamento(equip())).toEqual({ semResposta: ["Limpeza dos filtros", "Medição de corrente", "Teste de funcionamento"], semFoto: [], semObservacao: [], formulario: null });
    const f = faltasEquipamento(equip({ respostas: { ...tudoOk, i2: r("ATENCAO", "  ") } }));
    // "Atenção" (i2) pede foto do item + observação, além do que o item já pedia
    expect(f).toEqual({ semResposta: [], semFoto: ["Limpeza dos filtros", "Medição de corrente"], semObservacao: ["Medição de corrente"], formulario: null });
    expect(completo(f)).toBe(false);
    expect(completo(faltasEquipamento(equip({ respostas: tudoOk, fotosPorItem: { i1: 1 } })))).toBe(true);
  });

  it("“Atenção” SEMPRE exige foto do item + observação (escrita ou em áudio), mesmo se o item não pede", () => {
    const base = { ...tudoOk, i3: r("ATENCAO") };
    expect(faltasEquipamento(equip({ respostas: base, fotosPorItem: { i1: 1 } }))).toEqual({ semResposta: [], semFoto: ["Teste de funcionamento"], semObservacao: ["Teste de funcionamento"], formulario: null });
    // foto de OUTRO item não vale
    expect(faltasEquipamento(equip({ respostas: base, fotosPorItem: { i1: 3 } })).semFoto).toEqual(["Teste de funcionamento"]);
    // observação só em áudio vale; escrita também
    expect(completo(faltasEquipamento(equip({ respostas: { ...base, i3: r("ATENCAO", null, { audio: true }) }, fotosPorItem: { i1: 1, i3: 1 } })))).toBe(true);
    expect(completo(faltasEquipamento(equip({ respostas: { ...base, i3: r("ATENCAO", "ruído no rolamento") }, fotosPorItem: { i1: 1, i3: 1 } })))).toBe(true);
    // OK sem pedir nada continua sem exigir
    expect(completo(faltasEquipamento(equip({ respostas: tudoOk, fotosPorItem: { i1: 1 } })))).toBe(true);
    // áudio também conta para item que pede observação
    expect(faltasEquipamento(equip({ respostas: { ...tudoOk, i2: r("OK", null, { audio: true }) }, fotosPorItem: { i1: 1 } })).semObservacao).toEqual([]);
  });

  it("medição: respondida com o NÚMERO (zero vale) ou “Não se aplica”; status sozinho não vale; nada de avaliar o valor", () => {
    const med: ItemExecucao = { id: "m1", texto: "Pressão de sucção", pedirFoto: false, pedirObservacao: false, ativo: true, tipoResposta: "MEDICAO", unidade: "psi" };
    const e = (resp?: RespostaItem) => equip({ itens: [med], respostas: resp ? { m1: resp } : {} });
    expect(faltasEquipamento(e()).semResposta).toEqual(["Pressão de sucção"]);
    expect(faltasEquipamento(e(r(null, "anotei", { valor: null }))).semResposta).toEqual(["Pressão de sucção"]);
    expect(faltasEquipamento(e(r("OK"))).semResposta).toEqual(["Pressão de sucção"]);
    expect(faltasEquipamento(e(r(null, null, { valor: Number.NaN }))).semResposta).toEqual(["Pressão de sucção"]);
    expect(completo(faltasEquipamento(e(r(null, null, { valor: 0, unidade: "psi" }))))).toBe(true);
    expect(completo(faltasEquipamento(e(r(null, null, { valor: -12.5, unidade: "°C" }))))).toBe(true);
    expect(completo(faltasEquipamento(e(r(null, null, { valor: 999999, unidade: "psi" }))))).toBe(true); // valor "absurdo" não trava: o adm interpreta
    expect(completo(faltasEquipamento(e(r("NAO_SE_APLICA"))))).toBe(true);
    // medição que pede foto: com o número, a foto passa a faltar; N/A dispensa
    const comFoto = { ...med, pedirFoto: true };
    expect(faltasEquipamento(equip({ itens: [comFoto], respostas: { m1: r(null, null, { valor: 70 }) } })).semFoto).toEqual(["Pressão de sucção"]);
    expect(completo(faltasEquipamento(equip({ itens: [comFoto], respostas: { m1: r("NAO_SE_APLICA") } })))).toBe(true);
    expect(respondido(med, r(null, null, { valor: 1 }))).toBe(true);
    expect(respondido(ITENS[0], r(null, null, { valor: 1 }))).toBe(false); // item comum não se responde com número
  });

  it("“Não se aplica” dispensa a foto e a observação do item", () => {
    const f = faltasEquipamento(equip({ respostas: { i1: r("NAO_SE_APLICA"), i2: r("NAO_SE_APLICA"), i3: tudoOk.i3 } }));
    expect(completo(f)).toBe(true);
  });

  it("item que saiu do checklist do tipo (inativo) não é mais exigido", () => {
    const itens = [ITENS[0], { ...ITENS[2], ativo: false }];
    expect(faltasEquipamento(equip({ itens, respostas: { i1: tudoOk.i1 }, fotosPorItem: { i1: 2 } }))).toEqual({ semResposta: [], semFoto: [], semObservacao: [], formulario: null });
  });

  it("formulário obrigatório do tipo: conta o VALOR de cada campo ativo (linha gravada vazia não vale)", () => {
    const formulario = {
      id: "f1", nome: "PMOC Split", obrigatorioConcluir: true,
      campos: [{ id: "c1", label: "Pressão", tipo: "TEXTO_CURTO", ativo: true }, { id: "c2", label: "Foto da placa", tipo: "FOTO", ativo: true }, { id: "c3", label: "Removido", tipo: "TEXTO_CURTO", ativo: false }],
      respostas: { c1: { resposta: "  ", arquivoUrl: null }, c2: { resposta: null, arquivoUrl: "data:image/png;base64,AAAA" } },
    };
    const base = { respostas: tudoOk, fotosPorItem: { i1: 1 } };
    expect(faltasEquipamento(equip({ ...base, formulario })).formulario).toEqual({ nome: "PMOC Split", campos: ["Pressão"] });
    expect(faltasEquipamento(equip({ ...base, formulario: { ...formulario, obrigatorioConcluir: false } })).formulario).toBeNull();
    expect(faltasEquipamento(equip({ ...base, formulario: { ...formulario, respostas: { ...formulario.respostas, c1: { resposta: "120 psi", arquivoUrl: null } } } })).formulario).toBeNull();
  });

  it("texto das faltas: uma linha, até 3 nomes entre aspas e “mais N”", () => {
    expect(listaCurta(["a", "b", "c", "d", "e"])).toBe("“a”, “b”, “c” e mais 2");
    expect(listaCurta(["a"])).toBe("“a”");
    expect(textoFaltas({ semResposta: ["a"], semFoto: ["b"], semObservacao: ["c"], formulario: { nome: "F", campos: ["x", "y"] } }))
      .toBe("1 item sem resposta (“a”); foto em “b”; observação em “c”; formulário “F”: “x”, “y”");
    expect(textoFaltas({ semResposta: ["a", "b"], semFoto: [], semObservacao: [], formulario: null })).toBe("2 itens sem resposta (“a”, “b”)");
  });
});

describe("pode concluir?", () => {
  it("sem equipamento atendido: não (e diz quantos estão vinculados sem atendimento)", () => {
    expect(verificarConclusao([])).toEqual({ ok: false, semEquipamento: true, pendencias: [], atendidos: 0, naoAtendidos: 0, mensagem: MSG_SEM_EQUIPAMENTO });
    expect(verificarConclusao([equip({ feito: false })]).mensagem).toBe(`${MSG_SEM_EQUIPAMENTO} Há 1 equipamento vinculado que ainda não foi atendido.`);
    expect(verificarConclusao([equip({ feito: false }), equip({ equipamentoId: "eqB", feito: false })]).mensagem)
      .toBe(`${MSG_SEM_EQUIPAMENTO} Há 2 equipamentos vinculados que ainda não foram atendidos.`);
  });

  it("com atendidos: só eles contam; o não atendido não trava; a mensagem diz equipamento e itens", () => {
    const pronto = equip({ respostas: tudoOk, fotosPorItem: { i1: 1 } });
    const faltando = equip({ equipamentoId: "eqB", titulo: "Split Sala 2", respostas: { i1: tudoOk.i1 }, fotosPorItem: { i1: 1 } });
    const naoAtendido = equip({ equipamentoId: "eqC", feito: false });
    const r = verificarConclusao([pronto, faltando, naoAtendido]);
    expect(r).toMatchObject({ ok: false, semEquipamento: false, atendidos: 2, naoAtendidos: 1 });
    expect(r.pendencias.map((p) => p.equipamentoId)).toEqual(["eqB"]);
    expect(r.mensagem).toBe("Para concluir, falta: Split Sala 2 — 2 itens sem resposta (“Medição de corrente”, “Teste de funcionamento”).");
    expect(verificarConclusao([pronto, naoAtendido])).toMatchObject({ ok: true, mensagem: null, pendencias: [] });
  });

  it("rótulo do equipamento na mensagem: TAG, senão o local; fotos contadas por item (as gerais não)", () => {
    expect(rotuloCurto({ titulo: "Split", tag: "AC-01", local: "Sala 1" })).toBe("Split (TAG AC-01)");
    expect(rotuloCurto({ titulo: "Split", tag: null, local: "Sala 1" })).toBe("Split (Sala 1)");
    expect(rotuloCurto({ titulo: "Split", tag: null, local: null })).toBe("Split");
    expect(contarFotosPorItem([{ itemId: "i1" }, { itemId: "i1" }, { itemId: null }, { itemId: "i2" }])).toEqual({ i1: 2, i2: 1 });
    const p = paraPendencia({ feito: true, equipamento: { id: "eqA", titulo: "Split", tag: null, local: "Sala 1" }, itens: ITENS, respostas: {}, fotos: [{ itemId: "i1" }], formulario: null });
    expect(p).toMatchObject({ equipamentoId: "eqA", titulo: "Split (Sala 1)", fotosPorItem: { i1: 1 } });
  });
});

describe("editar o checklist do tipo", () => {
  const sem = { tipoResposta: "OK_ATENCAO_NA" as const, unidade: null };
  const atuais = [
    { id: "i1", texto: "Limpeza dos filtros", pedirFoto: true, pedirObservacao: false, ordem: 1, ...sem },
    { id: "i2", texto: "Medição de corrente", pedirFoto: false, pedirObservacao: true, ordem: 2, ...sem },
    { id: "i3", texto: "Teste de funcionamento", pedirFoto: false, pedirObservacao: false, ordem: 3, ...sem },
  ];
  const it_ = (x: Record<string, unknown>) => ({ tipoResposta: "OK_ATENCAO_NA" as const, pedirFoto: false, pedirObservacao: false, ...x }) as any;

  it("reordenar, mudar, acrescentar e remover: atualiza só o que mudou, cria o novo, INATIVA o que saiu", () => {
    const r = planejarChecklist(atuais, [
      it_({ id: "i2", texto: "Medição de corrente", pedirObservacao: true }),
      it_({ texto: "  Verificação   do dreno " }),
      it_({ id: "i1", texto: "Limpeza dos filtros", pedirFoto: false }),
    ]);
    expect(r).toEqual({ ok: true, plano: {
      atualizar: [
        { id: "i2", texto: "Medição de corrente", pedirFoto: false, pedirObservacao: true, ordem: 1, ...sem },
        { id: "i1", texto: "Limpeza dos filtros", pedirFoto: false, pedirObservacao: false, ordem: 3, ...sem },
      ],
      criar: [{ texto: "Verificação do dreno", pedirFoto: false, pedirObservacao: false, ordem: 2, ...sem }],
      inativar: ["i3"],
    } });
  });

  it("nada mudou = nada a gravar", () => {
    expect(planejarChecklist(atuais, atuais.map((a) => it_(a)))).toEqual({ ok: true, plano: { atualizar: [], criar: [], inativar: [] } });
  });

  it("recusa texto repetido (sem diferença de maiúsculas/espaços) e id que não é deste tipo", () => {
    expect(planejarChecklist(atuais, [it_({ texto: "Teste" }), it_({ texto: " teste " })])).toEqual({ ok: false, erro: "Item repetido no checklist: “teste”." });
    expect(planejarChecklist(atuais, [it_({ id: "deOutroTipo", texto: "X" })])).toEqual({ ok: false, erro: "Item do checklist não encontrado neste tipo: recarregue a tela." });
    expect(planejarChecklist(atuais, [it_({ id: "i1", texto: "A" }), it_({ id: "i1", texto: "B" })]).ok).toBe(false);
  });

  it("medição: unidade obrigatória e guardada; mudar a unidade atualiza; mudar o TIPO vira item novo (o antigo é inativado com as respostas)", () => {
    const comMed = [...atuais, { id: "m1", texto: "Pressão de sucção", pedirFoto: false, pedirObservacao: false, ordem: 4, tipoResposta: "MEDICAO" as const, unidade: "psi" }];
    const lista = comMed.map((a) => it_(a));
    expect(planejarChecklist(comMed, lista)).toEqual({ ok: true, plano: { atualizar: [], criar: [], inativar: [] } });
    // unidade muda (e espaços somem)
    const r1 = planejarChecklist(comMed, [...lista.slice(0, 3), it_({ ...lista[3], unidade: " bar " })]);
    expect(r1.ok && r1.plano.atualizar).toEqual([{ id: "m1", texto: "Pressão de sucção", pedirFoto: false, pedirObservacao: false, ordem: 4, tipoResposta: "MEDICAO", unidade: "bar" }]);
    // OK/Atenção → medição: cria um novo e inativa o antigo
    const r2 = planejarChecklist(comMed, [it_({ id: "i1", texto: "Limpeza dos filtros", pedirFoto: true }), it_({ id: "i2", texto: "Corrente do compressor", tipoResposta: "MEDICAO", unidade: "A" }), lista[2], lista[3]]);
    expect(r2).toEqual({ ok: true, plano: {
      atualizar: [],
      criar: [{ texto: "Corrente do compressor", pedirFoto: false, pedirObservacao: false, ordem: 2, tipoResposta: "MEDICAO", unidade: "A" }],
      inativar: ["i2"],
    } });
    // item comum não guarda unidade
    const r3 = planejarChecklist([], [it_({ texto: "Dreno", unidade: "psi" })]);
    expect(r3.ok && r3.plano.criar[0].unidade).toBeNull();
    const ok = (itens: unknown[]) => checklistSchema.safeParse({ itens }).success;
    expect(ok([{ texto: "Pressão", tipoResposta: "MEDICAO", unidade: "psi" }])).toBe(true);
    expect(ok([{ texto: "Pressão", tipoResposta: "MEDICAO" }])).toBe(false);
    expect(ok([{ texto: "Pressão", tipoResposta: "MEDICAO", unidade: "  " }])).toBe(false);
    expect(ok([{ texto: "Pressão", tipoResposta: "MEDICAO", unidade: "x".repeat(21) }])).toBe(false);
  });

  it("corpo: OK/Atenção/Não se aplica ou Medição; texto 2..300; no máximo 100 itens; campo estranho recusado", () => {
    const ok = (itens: unknown[]) => checklistSchema.safeParse({ itens }).success;
    expect(ok([{ texto: "Limpeza" }])).toBe(true);
    expect(ok([{ texto: "Limpeza", tipoResposta: "TEXTO" }])).toBe(false);
    expect(ok([{ texto: "L" }])).toBe(false);
    expect(ok([{ texto: "x".repeat(301) }])).toBe(false);
    expect(ok([{ texto: "Limpeza", empresaId: "e2" }])).toBe(false);
    expect(ok(Array.from({ length: 101 }, (_, i) => ({ texto: `Item ${i}` })))).toBe(false);
  });
});

describe("checklists sugeridos (boas práticas AVAC)", () => {
  const textos = (chave: string) => checklistSugerido(chave).map((i) => i.texto);

  it("os 8 tipos pré-cadastrados, cada um com o seu checklist", () => {
    expect(TIPOS_PADRAO.map((t) => t.nome)).toEqual(["Split Hi-Wall (parede)", "Piso-Teto", "Cassete", "VRF/VRV", "Chiller", "Self-Contained", "Fancoil", "Câmara Fria/Refrigeração"]);
    expect(ITENS_BASE).toHaveLength(17);
    expect(ITENS_BASE_E1).toHaveLength(14);
    expect(textos("AR_CONDICIONADO_SPLIT")).toEqual(ITENS_BASE.map((i) => i.texto));
  });

  it("etapa 2: cada \"Medição de …\" vira itens de MEDIÇÃO (número + unidade), no mesmo lugar; o resto não muda", () => {
    const medicoes = ITENS_BASE.filter((i) => i.tipoResposta === "MEDICAO").map((i) => `${i.texto} (${i.unidade})`);
    expect(medicoes).toEqual([
      "Pressão de sucção (psi)", "Pressão de descarga (psi)",
      "Corrente do compressor (A)", "Corrente dos ventiladores (A)",
      "Temperatura de insuflamento (°C)", "Temperatura de retorno (°C)",
    ]);
    // nenhum item de medição pede foto/observação (só captura) e nenhum item "Medição de…" sobra
    for (const t of TIPOS_PADRAO) {
      expect(t.itens.some((i) => /^Medição de/.test(i.texto))).toBe(false);
      for (const i of t.itens.filter((x) => x.tipoResposta === "MEDICAO")) expect([i.pedirFoto, i.pedirObservacao, !!i.unidade]).toEqual([undefined, undefined, true]);
    }
    // os itens que não são medição ficam iguais e na mesma ordem relativa
    TIPOS_PADRAO_E1.forEach((e1, k) => {
      const semMedicao = (itens: typeof ITENS_BASE) => itens.filter((i) => !i.tipoResposta && !/^Medição de|Temperatura de entrada e saída|Controle de temperatura da câmara/.test(i.texto)).map((i) => i.texto);
      expect(semMedicao(TIPOS_PADRAO[k].itens)).toEqual(semMedicao(e1.itens));
    });
    expect(textos("CAMARA_FRIA")).toContain("Setpoint da câmara");
    expect(textos("CHILLER")).toEqual(expect.arrayContaining(["Temperatura de entrada da água", "Temperatura de saída da água"]));
  });

  it("específicos: Cassete/Piso-Teto (bomba de dreno, aletas); VRF (erros, comunicação, pressões); Câmara (degelo, gaxetas)", () => {
    for (const k of ["CASSETE", "PISO_TETO"]) expect(textos(k).join(" | ")).toMatch(/bomba.*dreno.*\|.*aletas/i);
    expect(textos("VRF").join(" | ")).toMatch(/controlador central/i);
    expect(textos("VRF").join(" | ")).toMatch(/comunicação/i);
    expect(textos("CAMARA_FRIA").join(" | ")).toMatch(/degelo/i);
    expect(textos("CAMARA_FRIA").join(" | ")).toMatch(/gaxetas/i);
    expect(textos("CHILLER").join(" | ")).toMatch(/pressostato/i);
  });

  it("tipo sem padrão (criado pelo usuário): sugere os itens-base", () => {
    expect(checklistSugerido(null)).toBe(ITENS_BASE);
    expect(checklistSugerido("OUTRO")).toBe(ITENS_BASE);
  });
});
