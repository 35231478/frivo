"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Upload do XML da NF-e de compra (arrastar ou escolher). Deu certo → abre a central de lançamento da
 * nota. Nota repetida (mesma chave) → aviso com o link da que já existe; nada é importado de novo.
 * `de`: de onde a pessoa veio (ex.: "contas-pagar", o atalho do Financeiro) — o "voltar" da nota leva para lá.
 */
export function ImportarNota({ de }: { de?: string | null }) {
  const sufixo = de ? `?de=${encodeURIComponent(de)}` : "";
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [erro, setErro] = useState<{ texto: string; notaId?: string } | null>(null);

  async function enviar(arquivo: File | undefined) {
    if (!arquivo) return;
    setErro(null);
    if (!/\.xml$/i.test(arquivo.name) && arquivo.type !== "text/xml" && arquivo.type !== "application/xml") {
      setErro({ texto: "Envie o arquivo .xml da NF-e (não o PDF/DANFE)." });
      return;
    }
    setEnviando(true);
    try {
      const fd = new FormData();
      fd.append("xml", arquivo);
      const r = await fetch("/api/compras/notas", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro({ texto: j.erro ?? "Não foi possível importar.", notaId: j.notaId }); return; }
      router.push(`/estoque/notas/${j.nota.id}${sufixo}`);
    } catch {
      setErro({ texto: "Sem conexão. Tente de novo." });
    } finally {
      setEnviando(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div
        role="button" tabIndex={0} data-upload-xml
        onClick={() => input.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => { e.preventDefault(); setArrastando(false); enviar(e.dataTransfer.files?.[0]); }}
        className={cn("flex flex-col sm:flex-row items-center gap-3 rounded-card border-2 border-dashed px-5 py-5 cursor-pointer transition-colors text-center sm:text-left",
          arrastando ? "border-primary-500 bg-primary-50" : "border-surface-border bg-white hover:border-primary-300 hover:bg-primary-50/40")}
      >
        <div className="p-3 rounded-full bg-primary-50 shrink-0">
          {enviando ? <Loader2 className="w-6 h-6 text-primary-600 animate-spin" /> : <FileUp className="w-6 h-6 text-primary-600" />}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-ink">{enviando ? "Lendo a nota…" : "Importar XML da NF-e de compra"}</p>
          <p className="text-xs text-ink-muted">Arraste o arquivo .xml aqui ou clique para escolher. Layout 4.00 · a mesma nota não entra duas vezes.</p>
        </div>
        <input ref={input} type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={(e) => enviar(e.target.files?.[0])} data-input-xml />
      </div>
      {erro && (
        <p role="alert" className="flex items-start gap-2 text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{erro.texto}{erro.notaId && <> <Link href={`/estoque/notas/${erro.notaId}${sufixo}`} className="font-semibold underline">Abrir a nota importada</Link></>}</span>
        </p>
      )}
    </div>
  );
}
