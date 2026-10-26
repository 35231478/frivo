/**
 * Fotos & Anexos do serviço — regras puras: legenda das fotos da execução, legenda digitada,
 * agrupamento por equipamento (+ Geral, + equipamento que saiu da OS), nome do arquivo baixado, e o
 * estado do app do técnico com as operações de "foto do serviço" ainda na fila do aparelho.
 */
import { describe, expect, it } from "vitest";
import {
  agruparGaleria, ehImagem, legendaAdicional, legendaExecucao, limparLegenda, nomeArquivoFoto, REFERENCIA_GERAL, type FotoGaleria,
} from "@/lib/os/galeria";
import { estadoDaAtividade } from "@/lib/tecnico/offline/estado";
import type { OperacaoFila, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

const foto = (chave: string, equipamentoId: string | null, enviadoEm: string): FotoGaleria => ({
  chave, origem: "ANEXO", id: chave, src: "", baixar: "", legenda: chave, equipamentoId, atividade: null, item: null, momento: null, enviadoPor: null, enviadoEm,
});

describe("legendas", () => {
  it("foto da execução diz de onde é: item do checklist > antes/depois > atendimento", () => {
    expect(legendaExecucao({ momento: null, item: "Limpeza dos filtros" })).toBe("Checklist: Limpeza dos filtros");
    expect(legendaExecucao({ momento: "ANTES", item: null })).toBe("Antes do serviço");
    expect(legendaExecucao({ momento: "DEPOIS", item: null })).toBe("Depois do serviço");
    expect(legendaExecucao({ momento: null, item: null })).toBe("Foto do atendimento");
    expect(legendaAdicional("Troca do controle")).toBe("Serviço adicional: Troca do controle");
  });

  it("legenda digitada: sem espaços sobrando, de 2 a 200 caracteres", () => {
    expect(limparLegenda("  Placa   da\ncondensadora ")).toBe("Placa da condensadora");
    expect(limparLegenda("ok")).toBe("ok");
    expect(limparLegenda(" x ")).toBeNull();
    expect(limparLegenda("a".repeat(201))).toBeNull();
    expect(limparLegenda("a".repeat(200))).toHaveLength(200);
    expect(limparLegenda(null)).toBeNull();
    expect(limparLegenda(42)).toBeNull();
  });

  it("imagem × documento pelo tipo; nome do arquivo baixado vem da legenda", () => {
    expect(ehImagem("image/jpeg")).toBe(true);
    expect(ehImagem("application/pdf")).toBe(false);
    expect(nomeArquivoFoto("Placa da condensadora — Split nº 2!", "cmabc123456")).toBe("placa-da-condensadora-split-n-2-123456.jpg");
    expect(nomeArquivoFoto("???", "x1")).toBe("foto-x1.jpg");
  });
});

describe("agrupamento por equipamento", () => {
  it("uma seção por equipamento da OS na ordem dela (inclusive vazios), Geral por último; dentro, da mais antiga para a mais nova", () => {
    const s = agruparGaleria({
      equipamentos: [{ id: "eqA", titulo: "Split A", detalhe: null }, { id: "eqB", titulo: "Split B", detalhe: "TAG B" }],
      fotos: [foto("a2", "eqA", "2026-10-20T12:00:00Z"), foto("g1", null, "2026-10-19T12:00:00Z"), foto("a1", "eqA", "2026-10-20T11:00:00Z")],
    });
    expect(s.map((x) => [x.chave, x.titulo, x.geral, x.fotos.map((f) => f.chave)])).toEqual([
      ["eqA", "Split A", false, ["a1", "a2"]],
      ["eqB", "Split B", false, []],
      [REFERENCIA_GERAL, "Geral da OS", true, ["g1"]],
    ]);
  });

  it("foto de equipamento que não está mais na lista ganha a seção dele (nunca some)", () => {
    const s = agruparGaleria({ equipamentos: [], fotos: [foto("x", "eqSumiu", "2026-10-20T12:00:00Z")] });
    expect(s.map((x) => [x.chave, x.titulo, x.fotos.length])).toEqual([["eqSumiu", "Equipamento fora da OS", 1], [REFERENCIA_GERAL, "Geral da OS", 0]]);
  });
});

describe("app do técnico: fotos do serviço na fila do aparelho", () => {
  const retrato = (fotosServico?: unknown[]) => ({
    cartao: {}, equipamentosUnidade: [], checklistsPorTipo: {}, geradoEm: "",
    execucao: {
      atividade: { id: "aA", titulo: "Preventiva", status: "EM_ANDAMENTO", tipoOs: null },
      os: { id: "osA", numero: "OS-1", status: "EM_EXECUCAO", clienteId: "c1", unidadeId: null },
      bloqueada: false, equipamentos: [], adicionais: [], conclusao: { ok: false, semEquipamento: true, pendencias: [], atendidos: 0, naoAtendidos: 0, mensagem: null },
      ...(fotosServico && { fotosServico }),
    },
  }) as unknown as RetratoAtividade;
  let seq = 0;
  const op = (o: Record<string, unknown>) => ({ id: `op${++seq}`, atividadeId: "aA", seq, criadoEm: "", estado: "pendente", tentativas: 0, ...o }) as unknown as OperacaoFila;

  it("retrato antigo (sem fotosServico) vira lista vazia; a foto da fila aparece pendente, com a imagem local; repetir o clientId não duplica", () => {
    expect(estadoDaAtividade(retrato(), []).fotosServico).toEqual([]);
    const nova = op({ tipo: "fotoOs", dados: { dataUrl: "data:image/jpeg;base64,AAA", equipamentoId: "eqA", legenda: "  Placa ", clientId: "c-1" } });
    const x = estadoDaAtividade(retrato([{ id: "f0", clientId: null, equipamentoId: null, legenda: "Fachada" }]), [nova, { ...nova, id: "op-repetida", seq: 99 }]);
    expect(x.fotosServico).toEqual([
      { id: "f0", clientId: null, equipamentoId: null, legenda: "Fachada" },
      { id: null, clientId: "c-1", equipamentoId: "eqA", legenda: "Placa", local: "data:image/jpeg;base64,AAA", pendente: true },
    ]);
  });

  it("remover pela fila: pelo clientId (ainda no aparelho) ou pelo id (já no servidor); outra atividade não mexe", () => {
    const r = retrato([{ id: "f0", clientId: null, equipamentoId: null, legenda: "Fachada" }, { id: "f1", clientId: "c-1", equipamentoId: "eqA", legenda: "Placa" }]);
    expect(estadoDaAtividade(r, [op({ tipo: "fotoOsRemover", dados: { clientId: "c-1" } })]).fotosServico!.map((f) => f.id)).toEqual(["f0"]);
    expect(estadoDaAtividade(r, [op({ tipo: "fotoOsRemover", dados: { id: "f0" } })]).fotosServico!.map((f) => f.id)).toEqual(["f1"]);
    expect(estadoDaAtividade(r, [op({ tipo: "fotoOsRemover", atividadeId: "outra", dados: { id: "f0" } })]).fotosServico).toHaveLength(2);
  });
});
