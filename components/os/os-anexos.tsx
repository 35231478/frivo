"use client";

import { useRef, useState } from "react";
import { Download, Eye, FileText, Image as ImageIcon, Loader2, Paperclip, Trash2, AlertTriangle, Upload } from "lucide-react";
import { formatarData } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { ACCEPT_ANEXO, podeVisualizarInline } from "@/lib/anexos";

interface Anexo { id: string; nome: string; tipo: string; tamanho: number; criadoEm: string | Date }

function tamanhoLegivel(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Anexos da OS: enviar, visualizar, baixar e excluir (com confirmação).
 * Enviar/excluir exigem `ordens.editar`; ver/baixar, `ordens.visualizar`.
 */
export function OsAnexos({ osId, anexos: iniciais }: { osId: string; anexos: Anexo[] }) {
  const { pode } = usePermissoes();
  const podeEditar = pode("ordens", "editar");
  const [anexos, setAnexos] = useState<Anexo[]>(iniciais);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [excluindo, setExcluindo] = useState<Anexo | null>(null);
  const [processando, setProcessando] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const base = `/api/ordens/${osId}/anexos`;

  async function enviar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setEnviando(true); setErro("");
    const fd = new FormData();
    fd.append("arquivo", file);
    try {
      const res = await fetch(base, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setAnexos((p) => [data, ...p]);
      else setErro(data.erro ?? "Não foi possível enviar o anexo.");
    } catch { setErro("Erro de conexão."); } finally {
      setEnviando(false);
      if (input.current) input.current.value = "";
    }
  }

  async function confirmarExclusao() {
    if (!excluindo) return;
    setProcessando(true); setErro("");
    try {
      const res = await fetch(`${base}/${excluindo.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setAnexos((p) => p.filter((a) => a.id !== excluindo.id)); setExcluindo(null); }
      else setErro(data.erro ?? "Não foi possível excluir o anexo.");
    } catch { setErro("Erro de conexão."); } finally { setProcessando(false); }
  }

  return (
    <div className="space-y-3">
      {erro && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {erro}
        </div>
      )}

      {anexos.length === 0 && (
        <p className="text-sm text-ink-subtle text-center py-6 flex items-center justify-center gap-2">
          <Paperclip className="w-4 h-4" /> Nenhum anexo nesta OS.
        </p>
      )}

      {anexos.map((a) => {
        const Icone = a.tipo.startsWith("image/") ? ImageIcon : FileText;
        return (
          <div key={a.id} className="flex items-center gap-3 p-2.5 border border-surface-border rounded-lg bg-white">
            <Icone className="w-4 h-4 text-ink-subtle shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink truncate">{a.nome}</p>
              <p className="text-xs text-ink-subtle">{tamanhoLegivel(a.tamanho)} — {formatarData(a.criadoEm)}</p>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              {podeVisualizarInline(a.tipo) && (
                <a href={`${base}/${a.id}?inline=1`} target="_blank" rel="noreferrer" title="Visualizar"
                  className="p-2 rounded-md text-ink-muted hover:text-primary-600 hover:bg-surface-alt">
                  <Eye className="w-4 h-4" />
                </a>
              )}
              <a href={`${base}/${a.id}`} download={a.nome} title="Baixar"
                className="p-2 rounded-md text-ink-muted hover:text-primary-600 hover:bg-surface-alt">
                <Download className="w-4 h-4" />
              </a>
              {podeEditar && (
                <button type="button" title="Excluir anexo" onClick={() => setExcluindo(a)}
                  className="p-2 rounded-md text-ink-muted hover:text-red-600 hover:bg-red-50">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        );
      })}

      {podeEditar && (
        <>
          <input ref={input} type="file" accept={ACCEPT_ANEXO} onChange={enviar} className="hidden" aria-label="Arquivo do anexo" />
          <button type="button" onClick={() => input.current?.click()} disabled={enviando}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-dashed border-surface-border text-ink hover:bg-surface-alt disabled:opacity-60">
            {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Enviar anexo (máx. 5 MB)
          </button>
        </>
      )}

      <Modal aberto={!!excluindo} onFechar={() => setExcluindo(null)} titulo="Excluir anexo?" tamanho="sm">
        <div className="space-y-4">
          <p className="text-sm text-ink">
            O arquivo <strong className="break-all">{excluindo?.nome}</strong> será removido desta OS. A exclusão fica registrada no histórico.
          </p>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setExcluindo(null)} className="px-4 py-2.5 text-sm font-medium rounded-lg border border-surface-border text-ink hover:bg-surface-alt">Voltar</button>
            <button type="button" onClick={confirmarExclusao} disabled={processando}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-60">
              {processando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Sim, excluir
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
