/**
 * Consulta de CEP (ViaCEP) com o fetch SIMULADO — nenhum teste depende da rede.
 * A consulta é conforto: CEP inexistente, erro HTTP ou rede fora devolvem null e a tela segue.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buscarCep, cepCompleto, formatarCep } from "@/lib/cep";

function respostaJson(corpo: unknown, ok = true) {
  return { ok, json: async () => corpo } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("buscarCep (ViaCEP simulado)", () => {
  it("CEP encontrado: mapeia os campos do ViaCEP para o endereço da tela", async () => {
    const fetchFalso = vi.fn(async () => respostaJson({
      cep: "01001-000", logradouro: "Praça da Sé", complemento: "lado ímpar", bairro: "Sé", localidade: "São Paulo", uf: "SP",
    }));
    vi.stubGlobal("fetch", fetchFalso);
    expect(await buscarCep("01001-000")).toEqual({ logradouro: "Praça da Sé", bairro: "Sé", cidade: "São Paulo", estado: "SP", complemento: "lado ímpar" });
    // Consulta só os dígitos, no endereço do ViaCEP
    expect(fetchFalso).toHaveBeenCalledWith("https://viacep.com.br/ws/01001000/json/", expect.objectContaining({ signal: expect.anything() })); // Leva I: com prazo (não trava)
  });

  it("campos ausentes viram texto vazio (não 'undefined' no formulário)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respostaJson({ localidade: "Cidade Fictícia", uf: "MG" })));
    expect(await buscarCep("30000000")).toEqual({ logradouro: "", bairro: "", cidade: "Cidade Fictícia", estado: "MG", complemento: "" });
  });

  it("CEP que não existe ({ erro: true }) devolve null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respostaJson({ erro: true })));
    expect(await buscarCep("99999-999")).toBeNull();
  });

  it("resposta HTTP de erro devolve null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respostaJson({}, false)));
    expect(await buscarCep("01001000")).toBeNull();
  });

  it("rede fora (fetch lança) devolve null, sem estourar a tela", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await buscarCep("01001000")).toBeNull();
  });

  it("CEP incompleto nem consulta", async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal("fetch", fetchFalso);
    expect(await buscarCep("0100")).toBeNull();
    expect(await buscarCep("010010001")).toBeNull();
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});

describe("formatarCep e cepCompleto", () => {
  it("formata enquanto digita e reconhece o CEP completo", () => {
    expect(formatarCep("01001")).toBe("01001");
    expect(formatarCep("010010")).toBe("01001-0");
    expect(formatarCep("01001000123")).toBe("01001-000");
    expect(cepCompleto("01001-000")).toBe(true);
    expect(cepCompleto("01001-00")).toBe(false);
  });
});
