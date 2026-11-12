"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, FileText, Paperclip, Trash2, Upload, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { confirmar, toast } from "@/components/ui/avisos";
import { ACCEPT_ANEXO } from "@/lib/anexos";
import { cn } from "@/lib/utils";

interface AnexoMeta { id: string; tipo: string; nome: string; mime: string; tamanho: number; legenda: string | null; origem: string | null }
interface FotoOs { origem: "EXECUCAO" | "ADICIONAL" | "ANEXO"; id: string; src: string; legenda: string; equipamento: string | null }
interface GrupoFotos { os: { id: string; numero: string }; fotos: FotoOs[] }

const MAX = 12;
const tamanho = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/**
 * Anexos da proposta (datasheet, catálogo e fotos das OS vinculadas) — vão junto no documento do
 * cliente. Só mudam em RASCUNHO; depois de enviado, a lista fica só para consulta.
 */
export function AnexosProposta({ orcamentoId, editavel, temOs, podeVerOs }: { orcamentoId: string; editavel: boolean; temOs: boolean; podeVerOs: boolean }) {
  const router = useRouter();
  const [anexos, setAnexos] = useState<AnexoMeta[] | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [escolhendo, setEscolhendo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const base = `/api/orcamentos/${orcamentoId}/anexos`;

  const carregar = useCallback(async () => {
    const r = await fetch(base).catch(() => null);
    setAnexos(r?.ok ? await r.json() : []);
  }, [base]);
  useEffect(() => { carregar(); }, [carregar]);

  const depois = async () => { await carregar(); router.refresh(); };

  async function enviar(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivos = [...(e.target.files ?? [])];
    if (inputRef.current) inputRef.current.value = "";
    if (!arquivos.length) return;
    setEnviando(true);
    try {
      for (const f of arquivos) {
        const fd = new FormData();
        fd.append("arquivo", f);
        const r = await fetch(base, { method: "POST", body: fd });
        if (!r.ok) { const j = await r.json().catch(() => ({})); toast(`${f.name}: ${j.erro ?? "não foi possível enviar."}`, "erro"); break; }
      }
      await depois();
    } catch { toast("Sem conexão. Tente de novo.", "erro"); } finally { setEnviando(false); }
  }

  async function remover(a: AnexoMeta) {
    const ok = await confirmar({ titulo: "Tirar da proposta?", mensagem: `“${a.legenda ?? a.nome}” deixa de ir no documento do cliente.`, confirmarTexto: "Tirar" });
    if (!ok) return;
    const r = await fetch(`${base}/${a.id}`, { method: "DELETE" }).catch(() => null);
    if (!r?.ok) { const j = await r?.json().catch(() => ({})); toast(j?.erro ?? "Não foi possível tirar o anexo.", "erro"); return; }
    await depois();
  }

  const fotos = (anexos ?? []).filter((a) => a.tipo === "FOTO");
  const arquivos = (anexos ?? []).filter((a) => a.tipo !== "FOTO");
  const cheio = (anexos?.length ?? 0) >= MAX;

  return (
    <section className="space-y-4" data-anexos-orcamento aria-labelledby="titulo-anexos-proposta">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="titulo-anexos-proposta" className="card-title flex items-center gap-2"><Paperclip className="w-4 h-4 text-primary-600" aria-hidden /> Anexos da proposta</h2>
          <p className="text-xs text-ink-muted mt-0.5">
            Fotos saem no registro fotográfico do documento; arquivos (datasheet, catálogo) saem como anexos para baixar. Até {MAX}.
          </p>
        </div>
        {editavel && (
          <div className="flex flex-wrap gap-2">
            <input ref={inputRef} type="file" accept={ACCEPT_ANEXO} multiple className="hidden" onChange={enviar} data-input-anexo-proposta />
            <Button type="button" variant="secondary" size="sm" onClick={() => inputRef.current?.click()} loading={enviando} disabled={cheio} data-enviar-anexo>
              <Upload className="w-3.5 h-3.5" aria-hidden /> Enviar arquivo
            </Button>
            {temOs && podeVerOs && (
              <Button type="button" variant="secondary" size="sm" onClick={() => setEscolhendo(true)} disabled={cheio} data-escolher-fotos-os>
                <Camera className="w-3.5 h-3.5" aria-hidden /> Fotos da OS
              </Button>
            )}
          </div>
        )}
      </div>

      {!editavel && (
        <p className="text-xs text-ink-muted" data-anexos-somente-leitura>Os anexos só mudam com o orçamento em rascunho: o documento enviado fica como foi enviado.</p>
      )}

      {anexos === null ? (
        <p className="text-sm text-ink-muted">Carregando…</p>
      ) : anexos.length === 0 ? (
        <p className="text-sm text-ink-muted" data-sem-anexos>Nenhum anexo. {editavel ? "Envie um datasheet ou escolha fotos da OS para irem junto." : ""}</p>
      ) : (
        <div className="space-y-4">
          {fotos.length > 0 && (
            <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3" aria-label="Fotos da proposta">
              {fotos.map((f) => (
                <li key={f.id} className="rounded-lg border border-surface-border overflow-hidden bg-white" data-anexo-foto={f.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${base}/${f.id}?inline=1`} alt={f.legenda ?? f.nome} className="w-full aspect-[4/3] object-cover bg-surface-alt" loading="lazy" />
                  <div className="flex items-start justify-between gap-1 px-2 py-1.5">
                    <p className="text-[11px] leading-snug min-w-0">
                      <span className="block text-ink truncate" title={f.legenda ?? f.nome}>{f.legenda ?? f.nome}</span>
                      {f.origem && <span className="block text-ink-subtle">{f.origem}</span>}
                    </p>
                    {editavel && (
                      <button type="button" onClick={() => remover(f)} aria-label={`Tirar a foto “${f.legenda ?? f.nome}” da proposta`} className="p-1 -mr-1 rounded text-ink-subtle hover:text-atrasado hover:bg-atrasado-claro">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {arquivos.length > 0 && (
            <ul className="divide-y divide-surface-linha border border-surface-border rounded-lg" aria-label="Arquivos da proposta">
              {arquivos.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2" data-anexo-arquivo={a.id}>
                  <a href={`${base}/${a.id}`} className="flex items-center gap-2 min-w-0 text-sm text-primary-600 hover:underline">
                    <FileText className="w-4 h-4 shrink-0" aria-hidden />
                    <span className="truncate">{a.nome}</span>
                    <span className="text-xs text-ink-subtle shrink-0">{tamanho(a.tamanho)}</span>
                  </a>
                  {editavel && (
                    <button type="button" onClick={() => remover(a)} aria-label={`Tirar “${a.nome}” da proposta`} className="p-1 rounded text-ink-subtle hover:text-atrasado hover:bg-atrasado-claro">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {escolhendo && (
        <EscolherFotosOs
          base={base}
          restam={MAX - (anexos?.length ?? 0)}
          onFechar={() => setEscolhendo(false)}
          onCopiadas={async () => { setEscolhendo(false); await depois(); }}
        />
      )}
    </section>
  );
}

function EscolherFotosOs({ base, restam, onFechar, onCopiadas }: { base: string; restam: number; onFechar: () => void; onCopiadas: () => void }) {
  const [grupos, setGrupos] = useState<GrupoFotos[] | null>(null);
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let ativo = true;
    fetch(`${base}/fotos-os`).then((r) => (r.ok ? r.json() : [])).then((d) => { if (ativo) setGrupos(Array.isArray(d) ? d : []); }).catch(() => { if (ativo) setGrupos([]); });
    return () => { ativo = false; };
  }, [base]);

  const chave = (f: FotoOs) => `${f.origem}:${f.id}`;
  const alternar = (k: string) => setMarcadas((m) => (m.includes(k) ? m.filter((x) => x !== k) : m.length >= restam ? m : [...m, k]));

  async function copiar() {
    setSalvando(true);
    try {
      const fotos = marcadas.map((k) => { const [origem, id] = k.split(":"); return { origem, id }; });
      const r = await fetch(`${base}/fotos-os`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fotos }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.erro ?? "Não foi possível adicionar as fotos.", "erro"); return; }
      toast(`${marcadas.length} foto(s) adicionada(s) à proposta.`);
      onCopiadas();
    } catch { toast("Sem conexão. Tente de novo.", "erro"); } finally { setSalvando(false); }
  }

  const total = grupos?.reduce((s, g) => s + g.fotos.length, 0) ?? 0;
  return (
    <Modal aberto onFechar={onFechar} titulo="Fotos da OS para a proposta" tamanho="lg">
      <div className="space-y-4" data-modal-fotos-os>
        {grupos === null ? (
          <p className="text-sm text-ink-muted">Carregando fotos…</p>
        ) : total === 0 ? (
          <p className="text-sm text-ink-muted" data-sem-fotos-os>As OS vinculadas ainda não têm fotos em Fotos & Anexos.</p>
        ) : (
          grupos.filter((g) => g.fotos.length).map((g) => (
            <fieldset key={g.os.id} className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{g.os.numero}</legend>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {g.fotos.map((f) => {
                  const k = chave(f);
                  const sel = marcadas.includes(k);
                  return (
                    <label key={k} className={cn("relative rounded-lg border-2 overflow-hidden cursor-pointer", sel ? "border-acento" : "border-surface-border")} data-foto-os={k}>
                      <input type="checkbox" className="sr-only" checked={sel} onChange={() => alternar(k)} aria-label={`${f.legenda}${f.equipamento ? ` — ${f.equipamento}` : ""}`} />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.src} alt="" className="w-full aspect-[4/3] object-cover bg-surface-alt" loading="lazy" />
                      <span className="block px-2 py-1 text-[11px] leading-snug text-ink">
                        {f.legenda}
                        {f.equipamento && <span className="block text-ink-subtle truncate">{f.equipamento}</span>}
                      </span>
                      {sel && <span className="absolute top-1.5 right-1.5 rounded-full bg-acento text-white p-0.5"><Check className="w-3.5 h-3.5" aria-hidden /></span>}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-surface-linha">
          <p className="text-xs text-ink-muted">{marcadas.length} marcada(s) · cabem mais {restam}</p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
            <Button type="button" onClick={copiar} disabled={!marcadas.length} loading={salvando} data-confirmar-fotos-os>Adicionar à proposta</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
