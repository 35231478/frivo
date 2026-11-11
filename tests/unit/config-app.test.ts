/**
 * App do colaborador: o ConfigApp (permissões do app por empresa) — padrões, normalização da linha
 * de Configuracao e o payload de volta para o PUT. Também os utilitários da marca d'água (data/hora,
 * coordenadas) e o caminho sem carimbo. Puro, sem banco.
 */
import { describe, expect, it } from "vitest";
import {
  CONFIG_APP_PADRAO, SELECT_CONFIG_APP, configAppParaPayload, normalizarConfigApp, type ConfigApp,
} from "@/lib/tecnico/config-app";
import { dataHoraMarca } from "@/lib/fuso";
import { formatarCoord } from "@/lib/tecnico/geo";
import { aplicarMarcaDagua } from "@/lib/imagem-cliente";

describe("ConfigApp — padrões (espelham os @default do schema)", () => {
  it("os padrões combinam com o que o produto pediu", () => {
    expect(CONFIG_APP_PADRAO).toEqual({
      exibirDadosCliente: true,
      exibirContatosCliente: true,
      esconderValores: true,
      marcaDagua: true,
      marcaDaguaOs: true,
      marcaDaguaEndereco: false,
      marcaDaguaCoordenadas: false,
      exigirLocalizacao: false,
      fotoSomenteCamera: false,
      conclusaoObrigatoria: false,
      umDispositivo: true,
      cadastrarEquipamento: true, // cadastro de equipamento em campo: nasce LIGADO
    });
  });

  it("SELECT_CONFIG_APP cobre exatamente as 12 colunas app*", () => {
    expect(Object.keys(SELECT_CONFIG_APP).sort()).toEqual([
      "appCadastrarEquipamento", "appConclusaoObrigatoria", "appEsconderValores", "appExibirContatosCliente", "appExibirDadosCliente",
      "appExigirLocalizacao", "appFotoSomenteCamera", "appMarcaDagua", "appMarcaDaguaCoordenadas",
      "appMarcaDaguaEndereco", "appMarcaDaguaOs", "appUmDispositivo",
    ]);
    expect(Object.values(SELECT_CONFIG_APP).every((v) => v === true)).toBe(true);
  });
});

describe("normalizarConfigApp", () => {
  it("empresa sem linha (null): todos os padrões", () => {
    expect(normalizarConfigApp(null)).toEqual(CONFIG_APP_PADRAO);
    expect(normalizarConfigApp(undefined)).toEqual(CONFIG_APP_PADRAO);
  });

  it("linha da empresa: cada coluna app* vira o campo amigável; faltante cai no padrão", () => {
    const n = normalizarConfigApp({
      appExibirDadosCliente: false, appEsconderValores: false, appFotoSomenteCamera: true,
      appExigirLocalizacao: true, appUmDispositivo: false, appMarcaDaguaCoordenadas: true,
    });
    expect(n.exibirDadosCliente).toBe(false);
    expect(n.esconderValores).toBe(false);
    expect(n.fotoSomenteCamera).toBe(true);
    expect(n.exigirLocalizacao).toBe(true);
    expect(n.umDispositivo).toBe(false);
    expect(n.marcaDaguaCoordenadas).toBe(true);
    // não informados: padrão
    expect(n.exibirContatosCliente).toBe(true);
    expect(n.marcaDagua).toBe(true);
    expect(n.conclusaoObrigatoria).toBe(false);
  });
});

describe("configAppParaPayload (ida e volta)", () => {
  it("round-trip: payload normalizado volta ao mesmo ConfigApp", () => {
    const c: ConfigApp = { ...CONFIG_APP_PADRAO, esconderValores: false, fotoSomenteCamera: true, marcaDaguaEndereco: true };
    const payload = configAppParaPayload(c);
    expect(payload.appEsconderValores).toBe(false);
    expect(payload.appFotoSomenteCamera).toBe(true);
    expect(payload.appMarcaDaguaEndereco).toBe(true);
    expect(normalizarConfigApp(payload)).toEqual(c);
  });
});

describe("marca d'água — utilitários", () => {
  it("dataHoraMarca: DD/MM/AAAA HH:mm em Brasília", () => {
    // 2026-11-10T17:32:00Z = 14:32 em São Paulo (UTC-3)
    expect(dataHoraMarca(new Date("2026-11-10T17:32:00.000Z"))).toBe("10/11/2026 14:32");
  });

  it("formatarCoord: lat, lng com 6 casas", () => {
    expect(formatarCoord({ lat: -23.5505199, lng: -46.6333094, precisao: 12 })).toBe("-23.550520, -46.633309");
  });

  it("aplicarMarcaDagua sem linhas devolve a mesma foto (sem canvas)", async () => {
    const d = "data:image/jpeg;base64,/9j/abc";
    expect(await aplicarMarcaDagua(d, [])).toBe(d);
    expect(await aplicarMarcaDagua(d, ["", "   "])).toBe(d);
  });
});
