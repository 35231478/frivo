"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { formatarData, cn } from "@/lib/utils";
import { Upload, FileText, Image as ImageIcon, File, Trash2, Eye, X, FileCheck } from "lucide-react";

interface Anexo {
  id: string;
  nome: string;
  tipo: string;
  tamanho: number;
  categoria?: string | null;
  criadoEm: string | Date;
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconeDoTipo(tipo: string) {
  if (tipo.startsWith("image/")) return <ImageIcon className="w-4 h-4 text-purple-500" />;
  if (tipo.includes("pdf")) return <FileText className="w-4 h-4 text-red-500" />;
  if (tipo.includes("word") || tipo.includes("document")) return <FileText className="w-4 h-4 text-blue-500" />;
  if (tipo.includes("excel") || tipo.includes("spreadsheet")) return <FileText className="w-4 h-4 text-green-500" />;
  return <File className="w-4 h-4 text-gray-400" />;
}

interface ContratoDocumentosProps {
  contratoId: string;
  anexosIniciais: Anexo[];
}

export function ContratoDocumentos({ contratoId, anexosIniciais }: ContratoDocumentosProps) {
  const [anexos, setAnexos] = useState<Anexo[]>(anexosIniciais);
  const [uploading, setUploading] = useState<"ASSINADO" | "ANEXO" | null>(null);
  const [erro, setErro] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputAssinado = useRef<HTMLInputElement>(null);
  const inputAnexo = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>, categoria: "ASSINADO" | "ANEXO") {
    const file = e.target.files?.[0];
    if (!file) return;
    setErro(""); setUploading(categoria);
    const formData = new FormData();
    formData.append("arquivo", file);
    formData.append("categoria", categoria);
    try {
      const res = await fetch(`/api/contratos/${contratoId}/anexos`, { method: "POST", body: formData });
      if (!res.ok) { const err = await res.json(); setErro(err.erro ?? "Erro ao enviar arquivo."); return; }
      const novo = await res.json();
      setAnexos((prev) => [novo, ...prev]);
    } catch { setErro("Erro de conexão ao enviar arquivo."); }
    finally {
      setUploading(null);
      if (inputAssinado.current) inputAssinado.current.value = "";
      if (inputAnexo.current) inputAnexo.current.value = "";
    }
  }

  async function remover(id: string) {
    if (!confirm("Remover este documento?")) return;
    try {
      const res = await fetch(`/api/contratos/${contratoId}/anexos/${id}`, { method: "DELETE" });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao remover."); return; }
      setAnexos((prev) => prev.filter((a) => a.id !== id));
    } catch { setErro("Erro de conexão."); }
  }

  async function visualizar(id: string, tipo: string) {
    try {
      const res = await fetch(`/api/contratos/${contratoId}/anexos/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (tipo.startsWith("image/") || tipo.includes("pdf")) {
        setPreviewUrl(data.conteudo);
      } else {
        const link = document.createElement("a");
        link.href = data.conteudo; link.download = data.nome; link.click();
      }
    } catch {}
  }

  return (
    <div className="space-y-4">
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}

      <input ref={inputAssinado} type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" onChange={(e) => handleUpload(e, "ASSINADO")} className="hidden" />
      <input ref={inputAnexo} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp" onChange={(e) => handleUpload(e, "ANEXO")} className="hidden" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Button type="button" variant="secondary" loading={uploading === "ASSINADO"} onClick={() => inputAssinado.current?.click()} className="justify-center border-dashed">
          <FileCheck className="w-4 h-4" /> {uploading === "ASSINADO" ? "Enviando..." : "Contrato assinado (PDF)"}
        </Button>
        <Button type="button" variant="secondary" loading={uploading === "ANEXO"} onClick={() => inputAnexo.current?.click()} className="justify-center border-dashed">
          <Upload className="w-4 h-4" /> {uploading === "ANEXO" ? "Enviando..." : "Outros anexos"}
        </Button>
      </div>
      <p className="text-xs text-gray-400 text-center -mt-1">PDF, DOC, XLS ou imagens — máx. 5 MB</p>

      {anexos.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">Nenhum documento anexado.</p>
      ) : (
        <div className="space-y-2">
          {anexos.map((a) => (
            <div key={a.id} className="flex items-center gap-3 p-2.5 border border-gray-200 rounded-lg group hover:border-gray-300">
              {iconeDoTipo(a.tipo)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm text-gray-800 truncate">{a.nome}</p>
                  {a.categoria === "ASSINADO" && (
                    <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700")}>Assinado</span>
                  )}
                </div>
                <p className="text-xs text-gray-400">{formatarTamanho(a.tamanho)} — {formatarData(a.criadoEm)}</p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button type="button" onClick={() => visualizar(a.id, a.tipo)} className="p-1 text-gray-400 hover:text-frivo-600 rounded" title="Visualizar/baixar">
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => remover(a.id)} className="p-1 text-gray-400 hover:text-red-600 rounded" title="Remover">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setPreviewUrl(null)}>
          <div className="relative bg-white rounded-xl max-w-4xl max-h-[90vh] overflow-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setPreviewUrl(null)} className="absolute top-3 right-3 bg-white/90 rounded-full p-1.5 shadow hover:bg-gray-100 z-10">
              <X className="w-4 h-4" />
            </button>
            {previewUrl.startsWith("data:image/") ? (
              <img src={previewUrl} alt="Preview" className="max-w-full max-h-[85vh] rounded-xl" />
            ) : (
              <iframe src={previewUrl} className="w-[800px] h-[80vh] rounded-xl" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
