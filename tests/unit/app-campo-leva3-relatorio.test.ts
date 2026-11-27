/**
 * App de campo, leva 3 (PR B) — RELATÓRIO AO CLIENTE (regra pura e o PDF):
 *  - a mensagem e o link do WhatsApp (com o número do cliente, DDI 55 quando falta; sem número, escolhe o contato);
 *  - o link do PDF (o mesmo token da página);
 *  - quando pode mandar: só concluída e com tudo desta OS já no servidor;
 *  - o PDF: medições com a faixa e o "fora do esperado", materiais, assinatura do cliente, teto das fotos.
 */
import { describe, expect, it } from "vitest";
import { linkPdfRelatorio, linkWhatsappRelatorio, mensagemRelatorio, situacaoEnvio } from "@/lib/tecnico/relatorio-cliente";
import {
  MAX_BYTES_FOTOS, gerarRelatorioAtividadePdf, nomeArquivoRelatorio, resultadoItem, semDelta, type DadosRelatorioAtividadePdf,
} from "@/lib/relatorio-atividade-pdf";
import type { BlocoEquipamento, ItemChecklistTipo } from "@/lib/relatorio-os/dados";
import { PNG, dataUrl, textoDoPdf } from "./pmoc-pdf-util";

const REL = { link: "/relatorio/atividade/a1?t=TOKEN", empresa: "Polar Clima", osNumero: "OS-1301" };

describe("mensagem e link do WhatsApp", () => {
  it("a mensagem leva a empresa, a OS e o link (sem o nome do cliente)", () => {
    expect(mensagemRelatorio(REL, "https://app.frivo.com.br/relatorio/atividade/a1?t=TOKEN"))
      .toBe("Olá! Segue o relatório da visita técnica da Polar Clima (OS-1301): https://app.frivo.com.br/relatorio/atividade/a1?t=TOKEN");
  });

  it("número brasileiro sem DDI ganha o 55; com DDI fica como está; a máscara sai", () => {
    expect(linkWhatsappRelatorio("(11) 98765-4321", "oi")).toBe("https://wa.me/5511987654321?text=oi");
    expect(linkWhatsappRelatorio("1133334444", "oi")).toBe("https://wa.me/551133334444?text=oi");
    expect(linkWhatsappRelatorio("+55 11 98765-4321", "oi")).toBe("https://wa.me/5511987654321?text=oi");
    expect(linkWhatsappRelatorio("351912345678", "oi")).toBe("https://wa.me/351912345678?text=oi");
  });

  it("sem número (ou curto demais), o WhatsApp abre para escolher o contato", () => {
    expect(linkWhatsappRelatorio(null, "oi")).toBe("https://wa.me/?text=oi");
    expect(linkWhatsappRelatorio(undefined, "oi")).toBe("https://wa.me/?text=oi");
    expect(linkWhatsappRelatorio("98765-432", "oi")).toBe("https://wa.me/?text=oi");
  });

  it("a mensagem vai codificada (o link com ? e & não se perde)", () => {
    const u = linkWhatsappRelatorio("11987654321", "Olá: /r?t=a&b=1");
    expect(u).toBe(`https://wa.me/5511987654321?text=${encodeURIComponent("Olá: /r?t=a&b=1")}`);
    expect(decodeURIComponent(u.split("?text=")[1])).toBe("Olá: /r?t=a&b=1");
  });
});

describe("link do PDF", () => {
  it("o mesmo caminho + /pdf, com o mesmo token", () => {
    expect(linkPdfRelatorio("/relatorio/atividade/a1?t=TOKEN")).toBe("/relatorio/atividade/a1/pdf?t=TOKEN");
    expect(linkPdfRelatorio("/relatorio/atividade/a1/?t=TOKEN")).toBe("/relatorio/atividade/a1/pdf?t=TOKEN");
    expect(linkPdfRelatorio("/relatorio/atividade/a1")).toBe("/relatorio/atividade/a1/pdf");
  });
});

describe("quando o técnico pode mandar", () => {
  it("sem relatório: nada aparece", () => {
    expect(situacaoEnvio({ concluida: true, noAparelho: 0, temRelatorio: false })).toBeNull();
  });
  it("não concluída: ainda não", () => {
    expect(situacaoEnvio({ concluida: false, noAparelho: 0, temRelatorio: true })).toBe("nao-concluida");
    expect(situacaoEnvio({ concluida: false, noAparelho: 3, temRelatorio: true })).toBe("nao-concluida");
  });
  it("concluída com gravação no aparelho: espera a sincronização (o cliente nunca abre um relatório incompleto)", () => {
    expect(situacaoEnvio({ concluida: true, noAparelho: 1, temRelatorio: true })).toBe("aguardando");
  });
  it("concluída e tudo no servidor: pronto", () => {
    expect(situacaoEnvio({ concluida: true, noAparelho: 0, temRelatorio: true })).toBe("pronto");
  });
});

const item = (x: Partial<ItemChecklistTipo>): ItemChecklistTipo => ({ texto: "Item", status: null, observacao: null, medicao: null, ...x } as ItemChecklistTipo);

describe("resultado de cada item no PDF", () => {
  it("OK/Atenção pelo rótulo; sem resposta, traço", () => {
    expect(resultadoItem(item({ status: "OK" }))).toBe("OK");
    expect(resultadoItem(item({}))).toBe("-");
  });
  it("medição sem faixa: só o valor (com a unidade quando tem)", () => {
    expect(resultadoItem(item({ medicao: { valor: 6.8, unidade: "A" } }))).toBe("6,8 A");
    expect(resultadoItem(item({ medicao: { valor: 12, unidade: null } }))).toBe("12");
  });
  it("dentro da faixa: o esperado entre parênteses", () => {
    expect(resultadoItem(item({ medicao: { valor: 120, unidade: "psi", faixa: { min: 115, max: 140 }, fora: false } }))).toBe("120 psi (esperado 115–140 psi)");
  });
  it("fora da faixa: em destaque, com o esperado", () => {
    expect(resultadoItem(item({ medicao: { valor: 95, unidade: "psi", faixa: { min: 115, max: 140 }, fora: true } }))).toBe("95 psi - FORA DO ESPERADO (115–140 psi)");
  });
  it("ΔT vira 'delta T' (a fonte do PDF não tem o Δ)", () => {
    expect(semDelta("Diferença de temperatura (ΔT)")).toBe("Diferença de temperatura (delta T)");
  });
  it("nome do arquivo sem caracteres proibidos", () => {
    expect(nomeArquivoRelatorio("REL-12", "OS/13:01")).toBe("Relatório REL-12 - OS-13-01.pdf");
  });
});

const bloco = (x: Partial<BlocoEquipamento> = {}): BlocoEquipamento => ({
  id: "eq1", local: { principal: "Consultório 1", complemento: null, unidade: "Matriz" }, titulo: "Split consultório 1", descricao: "Split consultório 1",
  fabricante: "Daikin FTXS", tag: null, numeroSerie: null, checklist: [], fotos: [], observacoes: [],
  resumoChecklist: { ok: 1, atencao: 0, naoSeAplica: 0, medicoes: 2, foraDaFaixa: 1 },
  checklistTipo: [{ atividade: "a1", itens: [
    item({ texto: "Limpeza dos filtros de ar", status: "OK" }),
    item({ texto: "Pressão de sucção", medicao: { valor: 95, unidade: "psi", faixa: { min: 115, max: 140 }, fora: true } }),
    item({ texto: "Diferença de temperatura do ar (ΔT)", medicao: { valor: 11.6, unidade: "°C", faixa: { min: 8, max: 14 }, fora: false } }),
  ] }],
  ...x,
});
const dados = (x: Partial<DadosRelatorioAtividadePdf> = {}): DadosRelatorioAtividadePdf => ({
  empresa: { nome: "Polar Clima Ltda", nomeFantasia: "Polar Clima" },
  os: { numero: "OS-1301", criadoEm: new Date("2026-11-20T12:00:00Z"), dataConclusao: new Date("2026-11-27T15:00:00Z"), cliente: { nome: "Clínica Exemplo" }, unidade: { nome: "Matriz" } },
  atividade: { titulo: "Preventiva mensal PMOC", tecnico: { nome: "Rafael Moura" }, dataAgendada: new Date("2026-11-27T13:00:00Z"), duracaoMin: 90 },
  equipamentos: [bloco()], adicionais: [], fotosServico: [], materiais: [], aceite: null, numero: "REL-7", geradoEm: new Date("2026-11-27T15:05:00Z"),
  ...x,
});

describe("o PDF da atividade", () => {
  it("é um PDF, com o título, o equipamento, as medições com a faixa e o fora do esperado", async () => {
    const { bytes, nomeArquivo } = await gerarRelatorioAtividadePdf(dados());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(nomeArquivo).toBe("Relatório REL-7 - OS-1301.pdf");
    const t = await textoDoPdf(bytes);
    for (const s of ["RELATÓRIO DE ATIVIDADE", "REL-7", "Clínica Exemplo", "OS-1301", "Split consultório 1", "Limpeza dos filtros de ar",
      "95 psi - FORA DO ESPERADO (115–140 psi)", "Diferença de temperatura do ar (delta T)", "11,6 °C (esperado 8–14 °C)", "1 fora do esperado", "Rafael Moura"]) {
      expect(t, s).toContain(s);
    }
    expect(t).not.toContain("Materiais usados");
    expect(t).not.toContain("Cliente ·");
  });

  it("materiais usados: tabela com o equipamento (ou traço) e a quantidade", async () => {
    const t = await textoDoPdf((await gerarRelatorioAtividadePdf(dados({ materiais: [
      { descricao: "Fluido refrigerante R-410A", quantidade: 0.8, unidade: "kg", equipamento: "Split consultório 2" },
      { descricao: "Filtro de ar lavável", quantidade: 3, unidade: "un", equipamento: null },
    ] }))).bytes);
    for (const s of ["Materiais usados", "Fluido refrigerante R-410A", "Split consultório 2", "0,8 kg", "Filtro de ar lavável", "3 un"]) expect(t, s).toContain(s);
  });

  it("cliente que assinou no local: nome, como e quando, com a imagem da assinatura", async () => {
    const sem = await gerarRelatorioAtividadePdf(dados({ aceite: { nome: "Carla Mendes", assinatura: null, confirmadoEm: new Date("2026-11-27T15:00:00Z"), noLocal: false } }));
    const com = await gerarRelatorioAtividadePdf(dados({ aceite: { nome: "Carla Mendes", assinatura: dataUrl(PNG, "image/png"), confirmadoEm: new Date("2026-11-27T15:00:00Z"), noLocal: true } }));
    const ts = await textoDoPdf(sem.bytes), tc = await textoDoPdf(com.bytes);
    expect(ts).toContain("Carla Mendes");
    expect(ts).toContain("Cliente · confirmou pelo link em 27/11/2026");
    expect(tc).toContain("Cliente · assinou no local em 27/11/2026");
    expect(Buffer.from(com.bytes).toString("latin1")).toMatch(/\/Subtype\s*\/Image/);
    expect(Buffer.from(sem.bytes).toString("latin1")).not.toMatch(/\/Subtype\s*\/Image/);
  });

  it("fotos: as que abrem entram; passou do teto, sai o aviso de que estão no link", async () => {
    const pequena = { url: dataUrl(PNG, "image/png"), legenda: "Antes do serviço" };
    const ok = await gerarRelatorioAtividadePdf(dados({ equipamentos: [bloco({ fotos: [pequena] })] }));
    expect(await textoDoPdf(ok.bytes)).toContain("Antes do serviço");
    expect(await textoDoPdf(ok.bytes)).not.toContain("não couberam");
    const enorme = { url: `data:image/png;base64,${"A".repeat(Math.ceil(MAX_BYTES_FOTOS / 0.75) + 10)}`, legenda: "Grande demais" };
    const corte = await gerarRelatorioAtividadePdf(dados({ equipamentos: [bloco({ fotos: [pequena, enorme] })] }));
    const t = await textoDoPdf(corte.bytes);
    expect(t).toContain("1 foto(s) não couberam neste PDF e estão no link do relatório.");
    expect(t).toContain("Antes do serviço");
    expect(t).not.toContain("Grande demais");
    expect(corte.bytes.length).toBeLessThan(MAX_BYTES_FOTOS);
  });

  it("foto que não é data URL (link externo) não derruba o PDF: só fica de fora", async () => {
    const t = await textoDoPdf((await gerarRelatorioAtividadePdf(dados({ fotosServico: [{ url: "https://exemplo.invalid/f.jpg", legenda: "Externa" }] }))).bytes);
    expect(t).toContain("Fotos do serviço");
    expect(t).not.toContain("Externa");
  });
});
