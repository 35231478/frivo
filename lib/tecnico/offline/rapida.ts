/**
 * Guarda da CÂMERA RÁPIDA no aparelho (IndexedDB, loja `dados` do banco do técnico). Cada foto é
 * gravada no disparo — a imagem numa chave só dela, o índice da atividade em outra —, então fechar o
 * app, ficar sem sinal ou reiniciar o celular não perde nada. As fotos ficam aqui até terem
 * equipamento (pelo QR ou pelo técnico); aí viram gravações da fila de sempre e saem da guarda.
 */
import type { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { SESSAO_VAZIA, comGrupoSalvo, semFotos, separarEm, type Destino, type FotoRapida, type GrupoRapido, type SessaoRapida } from "@/lib/tecnico/camera-rapida";

const chaveSessao = (atividadeId: string) => `rapida:${atividadeId}`;
const chaveFoto = (fotoId: string) => `rapida-foto:${fotoId}`;

/** Avisa as telas abertas de que a guarda mudou */
export const EVENTO_RAPIDA = "frivo:rapida";
const avisar = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO_RAPIDA)); };

export class GuardaRapida {
  /** Uma alteração por vez (dois disparos seguidos não pisam no índice um do outro) */
  private vez: Promise<unknown> = Promise.resolve();
  constructor(private banco: BancoTecnico) {}

  private emOrdem<T>(f: () => Promise<T>): Promise<T> {
    const r = this.vez.then(f, f);
    this.vez = r.catch(() => undefined);
    return r;
  }

  async sessao(atividadeId: string): Promise<SessaoRapida> {
    const s = await this.banco.ler<SessaoRapida>(chaveSessao(atividadeId));
    return s ? { fotos: s.fotos ?? [], salvos: s.salvos ?? [] } : { ...SESSAO_VAZIA };
  }

  private async mudar(atividadeId: string, f: (s: SessaoRapida) => SessaoRapida): Promise<SessaoRapida> {
    const nova = f(await this.sessao(atividadeId));
    await this.banco.gravar(chaveSessao(atividadeId), nova);
    avisar();
    return nova;
  }

  /** Guarda uma foto: PRIMEIRO a imagem, depois o índice (foto no índice sem imagem não pode existir). */
  adicionar(atividadeId: string, foto: FotoRapida, dataUrl: string): Promise<SessaoRapida> {
    return this.emOrdem(async () => {
      await this.banco.gravar(chaveFoto(foto.id), dataUrl);
      return this.mudar(atividadeId, (s) => (s.fotos.some((f) => f.id === foto.id) ? s : { ...s, fotos: [...s.fotos, foto] }));
    });
  }

  imagem(fotoId: string): Promise<string | null> { return this.banco.ler<string>(chaveFoto(fotoId)); }

  /** A foto passa a começar um grupo novo. */
  separar(atividadeId: string, fotoId: string): Promise<SessaoRapida> {
    return this.emOrdem(() => this.mudar(atividadeId, (s) => separarEm(s, fotoId)));
  }

  /** O grupo virou gravações da fila: sai da guarda (índice primeiro, imagens depois) e fica o resumo. */
  gravado(atividadeId: string, grupo: GrupoRapido, destino: Destino): Promise<SessaoRapida> {
    return this.emOrdem(async () => {
      const s = await this.mudar(atividadeId, (x) => comGrupoSalvo(x, grupo, destino));
      await this.banco.apagar(grupo.fotos.map((f) => chaveFoto(f.id)));
      return s;
    });
  }

  /** O técnico descartou fotos (decisão dele, confirmada na tela). */
  descartar(atividadeId: string, fotoIds: string[]): Promise<SessaoRapida> {
    return this.emOrdem(async () => {
      const s = await this.mudar(atividadeId, (x) => semFotos(x, fotoIds));
      await this.banco.apagar(fotoIds.map(chaveFoto));
      return s;
    });
  }

  /** Atividade encerrada: não sobra nada desta câmera no aparelho. */
  limpar(atividadeId: string): Promise<void> {
    return this.emOrdem(async () => {
      const s = await this.sessao(atividadeId);
      await this.banco.apagar([chaveSessao(atividadeId), ...s.fotos.map((f) => chaveFoto(f.id))]);
      avisar();
    });
  }
}
