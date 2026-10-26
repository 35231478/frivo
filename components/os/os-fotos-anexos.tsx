"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera, Download, Eye, FileText, ImagePlus, LayoutGrid, Loader2, Paperclip, Trash2, Upload, Wrench, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Lightbox } from "@/components/ui/lightbox";
import { confirmar, toast } from "@/components/ui/avisos";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { cn, formatarDataHora } from "@/lib/utils";
import { podeVisualizarInline } from "@/lib/anexos";
import {
  agruparGaleria, LEGENDA_MAX, limparLegenda, MSG_LEGENDA, MSG_REFERENCIA, nomeArquivoFoto, REFERENCIA_GERAL,
  type DocumentoGaleria, type FotoGaleria, type Galeria, type SecaoGaleria,
} from "@/lib/os/galeria";

const ACCEPT_DOCUMENTO = ".pdf,.doc,.docx,.xls,.xlsx";

function tamanhoLegivel(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** De onde veio a foto (chip na miniatura). */
function origemFoto(f: FotoGaleria): { rotulo: string; classe: string } {
  if (f.origem === "EXECUCAO") return { rotulo: "Execução", classe: "pill-acento" };
  if (f.origem === "ADICIONAL") return { rotulo: "Serviço adicional", classe: "pill-atencao" };
  if (f.semReferencia) return { rotulo: "Sem referência", classe: "pill-previsto" };
  return f.atividade ? { rotulo: "App do técnico", classe: "pill-ok" } : { rotulo: "Escritório", classe: "pill-previsto" };
}
const quemQuando = (f: { enviadoPor: string | null; enviadoEm: string }) =>
  [f.enviadoPor ?? "Autor não registrado", formatarDataHora(f.enviadoEm)].join(" · ");

/** Por que esta foto não pode ser excluída aqui (null = pode). */
function travaExclusao(f: FotoGaleria): string | null {
  if (f.origem === "ANEXO") return null;
  if (f.atividade && !f.atividade.aberta) return "Atividade concluída: reabra a atividade para excluir fotos da execução.";
  return null;
}

/**
 * "FOTOS & ANEXOS DO SERVIÇO": todas as fotos da OS num lugar só — as da execução (checklist,
 * antes/depois), as dos serviços adicionais e as enviadas pelo escritório e pelo app do técnico —
 * organizadas por EQUIPAMENTO + "Geral da OS". Foto nova exige a referência e a legenda.
 * Documentos (PDF, planilhas...) ficam à parte, sem equipamento. Enviar/excluir: OS › editar.
 */
export function OsFotosAnexos({ osId, galeria: inicial, onMudou }: { osId: string; galeria: Galeria; onMudou?: (g: Galeria) => void }) {
  const { pode } = usePermissoes();
  const podeEditar = pode("ordens", "editar");
  const [galeria, setGaleria] = useState<Galeria>(inicial);
  const [enviarFoto, setEnviarFoto] = useState<{ referencia: string } | null>(null);
  const [lightbox, setLightbox] = useState<{ secao: string; indice: number } | null>(null);
  const [enviandoDoc, setEnviandoDoc] = useState(false);
  const inputDoc = useRef<HTMLInputElement>(null);

  // A contagem da aba acompanha o que foi enviado/excluído aqui
  const primeira = useRef(true);
  useEffect(() => { if (primeira.current) { primeira.current = false; return; } onMudou?.(galeria); }, [galeria]); // eslint-disable-line react-hooks/exhaustive-deps

  const secoes = useMemo(() => agruparGaleria(galeria), [galeria]);
  const nomeSecao = useMemo(() => new Map(secoes.map((s) => [s.chave, s.titulo])), [secoes]);
  const total = galeria.fotos.length;
  const comFoto = secoes.filter((s) => !s.geral && s.fotos.length).length;
  const secaoAberta = lightbox ? secoes.find((s) => s.chave === lightbox.secao) : null;

  async function excluirFoto(f: FotoGaleria) {
    const ok = await confirmar({
      titulo: "Excluir foto?", perigo: true, confirmarTexto: "Excluir foto",
      mensagem: `A foto “${f.legenda}” sai desta OS${f.origem === "ANEXO" ? "" : " (e da execução da atividade)"}. A exclusão fica registrada no histórico, com o seu nome.`,
    });
    if (!ok) return;
    const url = f.origem === "ANEXO" ? `/api/ordens/${osId}/anexos/${f.id}` : `/api/ordens/${osId}/fotos/${f.id}?origem=${f.origem}`;
    const res = await fetch(url, { method: "DELETE" }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (!res?.ok) { toast(data?.erro ?? "Não foi possível excluir a foto.", "erro"); return; }
    setGaleria((g) => ({ ...g, fotos: g.fotos.filter((x) => x.chave !== f.chave) }));
    setLightbox(null);
    toast("Foto excluída.");
  }

  async function excluirDocumento(d: DocumentoGaleria) {
    const ok = await confirmar({
      titulo: "Excluir documento?", perigo: true, confirmarTexto: "Excluir documento",
      mensagem: `O arquivo “${d.nome}” sai desta OS. A exclusão fica registrada no histórico, com o seu nome.`,
    });
    if (!ok) return;
    const res = await fetch(`/api/ordens/${osId}/anexos/${d.id}`, { method: "DELETE" }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (!res?.ok) { toast(data?.erro ?? "Não foi possível excluir o documento.", "erro"); return; }
    setGaleria((g) => ({ ...g, documentos: g.documentos.filter((x) => x.id !== d.id) }));
    toast("Documento excluído.");
  }

  async function enviarDocumento(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setEnviandoDoc(true);
    const fd = new FormData();
    fd.append("arquivo", file);
    try {
      const res = await fetch(`/api/ordens/${osId}/anexos`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.erro ?? "Não foi possível enviar o documento.", "erro"); return; }
      if (data.tipo === "documento") setGaleria((g) => ({ ...g, documentos: [data.documento, ...g.documentos] }));
      toast(`Documento “${file.name}” adicionado.`);
    } catch { toast("Erro de conexão. Tente de novo.", "erro"); } finally { setEnviandoDoc(false); }
  }

  return (
    <div className="space-y-6" data-fotos-anexos>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Fotos &amp; anexos do serviço</h3>
          <p className="text-sm text-ink-muted mt-1" data-resumo-fotos>
            {total
              ? `${plural(total, "foto", "fotos")}${comFoto ? ` em ${plural(comFoto, "equipamento", "equipamentos")}` : ""} · ${plural(galeria.documentos.length, "documento", "documentos")}`
              : "Ainda sem fotos. As da execução (checklist, antes e depois) aparecem aqui sozinhas, no equipamento de cada uma."}
          </p>
        </div>
        {podeEditar && (
          <div className="flex flex-col sm:flex-row gap-2">
            <Button onClick={() => setEnviarFoto({ referencia: "" })} data-adicionar-foto><Camera className="w-4 h-4" aria-hidden="true" /> Adicionar foto</Button>
            <Button variant="secondary" onClick={() => inputDoc.current?.click()} loading={enviandoDoc} data-adicionar-documento>
              <Upload className="w-4 h-4" aria-hidden="true" /> Adicionar documento
            </Button>
            <input ref={inputDoc} type="file" accept={ACCEPT_DOCUMENTO} onChange={enviarDocumento} className="hidden" aria-label="Arquivo do documento" />
          </div>
        )}
      </div>

      <div className="space-y-4">
        {secoes.map((s) => (
          <SecaoFotos
            key={s.chave} secao={s} podeEditar={podeEditar}
            onAbrir={(indice) => setLightbox({ secao: s.chave, indice })}
            onAdicionar={() => setEnviarFoto({ referencia: s.chave })}
            onExcluir={excluirFoto}
          />
        ))}
      </div>

      <section className="space-y-3" data-secao-documentos aria-labelledby="titulo-documentos">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-ink-subtle" aria-hidden="true" />
          <h4 id="titulo-documentos" className="section-title">Documentos</h4>
          <span className="text-xs text-ink-muted">({galeria.documentos.length})</span>
        </div>
        {galeria.documentos.length === 0 ? (
          <p className="text-sm text-ink-muted rounded-lg border border-dashed border-surface-border px-4 py-4 flex items-center gap-2" data-documentos-vazio>
            <Paperclip className="w-4 h-4 shrink-0 text-ink-subtle" aria-hidden="true" />
            Nenhum documento. Laudos, ART, notas e planilhas (PDF, DOC, XLS) entram aqui — sem precisar de equipamento.
          </p>
        ) : (
          <ul className="divide-y divide-surface-linha rounded-lg border border-surface-border bg-white">
            {galeria.documentos.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2.5" data-documento={d.id}>
                <FileText className="w-5 h-5 text-ink-subtle shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink truncate">{d.nome}</p>
                  <p className="text-xs text-ink-muted truncate">{[d.legenda, tamanhoLegivel(d.tamanho), quemQuando(d)].filter(Boolean).join(" · ")}</p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {podeVisualizarInline(d.tipo) && (
                    <a href={d.src} target="_blank" rel="noreferrer" aria-label={`Ver ${d.nome}`} title="Ver"
                      className="p-2 rounded-md text-ink-muted hover:text-acento hover:bg-surface-page"><Eye className="w-4 h-4" aria-hidden="true" /></a>
                  )}
                  <a href={d.baixar} download={d.nome} aria-label={`Baixar ${d.nome}`} title="Baixar"
                    className="p-2 rounded-md text-ink-muted hover:text-acento hover:bg-surface-page"><Download className="w-4 h-4" aria-hidden="true" /></a>
                  {podeEditar && (
                    <button type="button" onClick={() => excluirDocumento(d)} aria-label={`Excluir ${d.nome}`} title="Excluir"
                      className="p-2 rounded-md text-ink-muted hover:text-atrasado hover:bg-atrasado-claro"><Trash2 className="w-4 h-4" aria-hidden="true" /></button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {enviarFoto && (
        <ModalEnviarFoto
          osId={osId} equipamentos={galeria.equipamentos} referenciaInicial={enviarFoto.referencia}
          onFechar={() => setEnviarFoto(null)}
          onEnviada={(f) => {
            setGaleria((g) => ({ ...g, fotos: [...g.fotos, f] }));
            setEnviarFoto(null);
            toast(`Foto adicionada em “${nomeSecao.get(f.equipamentoId ?? REFERENCIA_GERAL) ?? "Geral da OS"}”.`);
          }}
        />
      )}

      {lightbox && secaoAberta && secaoAberta.fotos.length > 0 && (
        <Lightbox
          indice={Math.min(lightbox.indice, secaoAberta.fotos.length - 1)}
          onIndice={(i) => setLightbox({ secao: secaoAberta.chave, indice: i })}
          onFechar={() => setLightbox(null)}
          itens={secaoAberta.fotos.map((f) => ({
            src: f.src, baixar: f.baixar, nomeArquivo: nomeArquivoFoto(f.legenda, f.id), titulo: f.legenda,
            detalhes: [
              secaoAberta.titulo,
              f.atividade ? `Atividade: ${f.atividade.titulo}` : null,
              `Enviada por ${quemQuando(f)}`,
            ],
          }))}
        />
      )}
    </div>
  );
}

function SecaoFotos({ secao: s, podeEditar, onAbrir, onAdicionar, onExcluir }: {
  secao: SecaoGaleria; podeEditar: boolean; onAbrir: (i: number) => void; onAdicionar: () => void; onExcluir: (f: FotoGaleria) => void;
}) {
  const Icone = s.geral ? LayoutGrid : Wrench;
  const idTitulo = `secao-fotos-${s.chave}`;
  return (
    <section className="rounded-card border border-surface-border bg-white" data-secao-fotos={s.chave} aria-labelledby={idTitulo}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-linha">
        <span className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", s.geral ? "bg-surface-page text-ink-muted" : "bg-acento-claro text-acento")}>
          <Icone className="w-4 h-4" aria-hidden="true" />
        </span>
        <div className="flex-1 min-w-0">
          <h4 id={idTitulo} className="text-sm font-semibold text-ink truncate">{s.titulo}</h4>
          {s.detalhe && <p className="text-xs text-ink-muted truncate">{s.detalhe}</p>}
        </div>
        <span className="text-xs text-ink-muted shrink-0" data-qtd-fotos>{plural(s.fotos.length, "foto", "fotos")}</span>
        {podeEditar && (
          <Button variant="outline" size="sm" onClick={onAdicionar} aria-label={`Adicionar foto em ${s.titulo}`} data-adicionar-foto-secao>
            <ImagePlus className="w-4 h-4" aria-hidden="true" /> <span className="hidden sm:inline">Foto</span>
          </Button>
        )}
      </div>
      {s.fotos.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink-subtle" data-secao-vazia>
          {s.geral ? "Nenhuma foto geral (fachada, quadro elétrico, área de trabalho…)." : "Nenhuma foto deste equipamento ainda."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 p-3 sm:p-4">
          {s.fotos.map((f, i) => {
            const origem = origemFoto(f);
            const trava = travaExclusao(f);
            return (
              <li key={f.chave} className="relative flex flex-col rounded-lg border border-surface-border overflow-hidden bg-white" data-foto={f.chave}>
                <button type="button" onClick={() => onAbrir(i)} className="relative block aspect-[4/3] bg-surface-page focus:outline-none focus-visible:ring-2 focus-visible:ring-acento"
                  aria-label={`Ampliar foto: ${f.legenda}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.src} alt="" loading="lazy" className="w-full h-full object-cover" />
                  <span className={cn(origem.classe, "absolute left-1.5 top-1.5 shadow-sm")}>{origem.rotulo}</span>
                </button>
                <div className="p-2 space-y-0.5 min-w-0">
                  <p className="text-sm font-medium text-ink leading-snug line-clamp-2" title={f.legenda} data-legenda>{f.legenda}</p>
                  {f.atividade && <p className="text-xs text-ink-muted truncate" title={f.atividade.titulo}>{f.atividade.titulo}</p>}
                  <p className="text-[11px] text-ink-subtle truncate" title={quemQuando(f)}>{quemQuando(f)}</p>
                </div>
                {podeEditar && (
                  <button
                    type="button" onClick={() => !trava && onExcluir(f)} disabled={!!trava} title={trava ?? "Excluir foto"}
                    aria-label={trava ? `Não dá para excluir “${f.legenda}”: ${trava}` : `Excluir foto: ${f.legenda}`} data-excluir-foto
                    className="absolute right-1.5 top-1.5 rounded-full bg-white/90 p-1.5 text-ink-muted shadow-sm hover:text-atrasado hover:bg-white disabled:opacity-50 disabled:hover:text-ink-muted"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Foto nova: escolher a imagem (comprimida no navegador), a QUE SE REFERE e a legenda — os três obrigatórios. */
function ModalEnviarFoto({ osId, equipamentos, referenciaInicial, onFechar, onEnviada }: {
  osId: string; equipamentos: Galeria["equipamentos"]; referenciaInicial: string;
  onFechar: () => void; onEnviada: (f: FotoGaleria) => void;
}) {
  const [imagem, setImagem] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const [referencia, setReferencia] = useState(referenciaInicial);
  const [legenda, setLegenda] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [erro, setErro] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const legendaOk = !!limparLegenda(legenda);
  const faltas = [!imagem && "Escolha a foto.", !referencia && MSG_REFERENCIA, !legendaOk && MSG_LEGENDA].filter(Boolean) as string[];

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) { setErro("Escolha uma imagem (JPG, PNG, WEBP ou HEIC). Documento vai em “Adicionar documento”."); return; }
    setLendo(true); setErro("");
    try {
      const { reduzirImagem, FOTO_GALERIA } = await import("@/lib/imagem-cliente");
      const { imagem: reduzida } = await reduzirImagem(f, FOTO_GALERIA.ladoMax, FOTO_GALERIA.qualidade);
      setImagem(reduzida.dataUrl);
    } catch {
      setErro("Não foi possível ler a foto. Tente outra.");
    } finally { setLendo(false); }
  }

  async function enviar() {
    setTentou(true);
    if (faltas.length) return;
    setEnviando(true); setErro("");
    try {
      const { dataUrlParaArquivo } = await import("@/lib/imagem-cliente");
      const fd = new FormData();
      fd.append("arquivo", dataUrlParaArquivo(imagem!, nomeArquivoFoto(legenda, Date.now().toString(36))));
      fd.append("referencia", referencia);
      fd.append("legenda", legenda.trim());
      const res = await fetch(`/api/ordens/${osId}/anexos`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.tipo !== "foto") { setErro(data.erro ?? "Não foi possível enviar a foto."); toast(data.erro ?? "Não foi possível enviar a foto.", "erro"); return; }
      onEnviada(data.foto);
    } catch {
      setErro("Erro de conexão. Tente de novo.");
    } finally { setEnviando(false); }
  }

  return (
    <Modal aberto titulo="Adicionar foto do serviço" onFechar={onFechar}>
      <div className="space-y-4" data-modal-foto>
        <div>
          <input ref={input} type="file" accept="image/*" onChange={escolher} className="hidden" aria-label="Foto" data-input-foto />
          {imagem ? (
            <div className="relative rounded-lg overflow-hidden border border-surface-border bg-surface-page">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagem} alt="Foto escolhida" className="w-full max-h-64 object-contain" data-previa-foto />
              <Button variant="secondary" size="sm" className="absolute right-2 bottom-2" onClick={() => input.current?.click()}>Trocar foto</Button>
            </div>
          ) : (
            <button type="button" onClick={() => input.current?.click()} disabled={lendo}
              className={cn("w-full rounded-lg border-2 border-dashed px-4 py-8 flex flex-col items-center gap-2 text-sm font-semibold transition-colors",
                tentou && !imagem ? "border-atrasado/50 text-atrasado-texto" : "border-acento/30 text-acento hover:bg-acento-claro/40")}>
              {lendo ? <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" /> : <Camera className="w-6 h-6" aria-hidden="true" />}
              {lendo ? "Preparando a foto…" : "Escolher ou tirar a foto"}
              <span className="text-xs font-normal text-ink-muted">A foto é reduzida no seu aparelho antes de enviar.</span>
            </button>
          )}
        </div>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink">A que esta foto se refere? <span className="text-atrasado" aria-hidden="true">*</span></span>
          <Select value={referencia} onChange={(e) => setReferencia(e.target.value)} required aria-required="true" error={tentou && !referencia}
            placeholder="Escolha o equipamento ou “Geral da OS”" data-referencia-foto>
            {equipamentos.map((e) => <option key={e.id} value={e.id}>{e.titulo}{e.detalhe ? ` — ${e.detalhe}` : ""}</option>)}
            <option value={REFERENCIA_GERAL}>Geral da OS (não é de um equipamento)</option>
          </Select>
          {!equipamentos.length && <span className="block text-xs text-ink-muted">Esta OS ainda não tem equipamento vinculado: use “Geral da OS” ou vincule o equipamento na aba Atividades.</span>}
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink">Legenda <span className="text-atrasado" aria-hidden="true">*</span></span>
          <Input value={legenda} onChange={(e) => setLegenda(e.target.value)} maxLength={LEGENDA_MAX} required aria-required="true"
            placeholder="Ex.: Dreno desobstruído, placa da condensadora" error={tentou && !legendaOk} data-legenda-foto />
          <span className="block text-xs text-ink-muted text-right tabular-nums">{legenda.length}/{LEGENDA_MAX}</span>
        </label>

        {(erro || (tentou && faltas.length > 0)) && (
          <div role="alert" className="flex items-start gap-2 text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" data-erro-foto>
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{erro || faltas.join(" ")}</span>
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button onClick={enviar} loading={enviando} disabled={lendo} data-enviar-foto>Adicionar foto</Button>
        </div>
      </div>
    </Modal>
  );
}
