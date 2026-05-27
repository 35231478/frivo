"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { formatarData } from "@/lib/utils";
import { Upload, FileText, Image, File, Trash2, Eye, X } from "lucide-react";

interface Anexo {
  id: string;
  nome: string;
  tipo: string;
  tamanho: number;
  criadoEm: string | Date;
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconeDoTipo(tipo: string) {
  if (tipo.startsWith("image/")) return <Image className="w-4 h-4 text-purple-500" />;
  if (tipo.includes("pdf")) return <FileText className="w-4 h-4 text-red-500" />;
  if (tipo.includes("word") || tipo.includes("document")) return <FileText className="w-4 h-4 text-blue-500" />;
  if (tipo.includes("excel") || tipo.includes("spreadsheet")) return <FileText className="w-4 h-4 text-green-500" />;
  return <File className="w-4 h-4 text-gray-400" />;
}

interface AnexosManagerProps {
  clienteId: string;
  anexosIniciais: Anexo[];
}

export function AnexosManager({ clienteId, anexosIniciais }: AnexosManagerProps) {
  const [anexos, setAnexos] = useState<Anexo[]>(anexosIniciais);
  const [uploading, setUploading] = useState(false);
  const [erro, setErro] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErro("");
    setUploading(true);

    const formData = new FormData();
    formData.append("arquivo", file);

    try {
      const res = await fetch(`/api/clientes/${clienteId}/anexos`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        setErro(err.erro ?? "Erro ao enviar arquivo.");
        return;
      }
      const novo = await res.json();
      setAnexos((prev) => [novo, ...prev]);
    } catch {
      setErro("Erro de conexão ao enviar arquivo.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remover(id: string) {
    if (!confirm("Remover este anexo?")) return;
    try {
      const res = await fetch(`/api/clientes/${clienteId}/anexos/${id}`, { method: "DELETE" });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao remover."); return; }
      setAnexos((prev) => prev.filter((a) => a.id !== id));
    } catch {
      setErro("Erro de conexão.");
    }
  }

  async function visualizar(id: string, tipo: string) {
    try {
      const res = await fetch(`/api/clientes/${clienteId}/anexos/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (tipo.startsWith("image/") || tipo.includes("pdf")) {
        setPreviewUrl(data.conteudo);
      } else {
        const link = document.createElement("a");
        link.href = data.conteudo;
        link.download = data.nome;
        link.click();
      }
    } catch {}
  }

  return (
    <div className="space-y-3">
      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp"
        onChange={handleUpload}
        className="hidden"
      />

      {anexos.length > 0 && (
        <div className="space-y-2">
          {anexos.map((a) => (
            <div key={a.id} className="flex items-center gap-3 p-2.5 border border-gray-200 rounded-lg group hover:border-gray-300">
              {iconeDoTipo(a.tipo)}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 truncate">{a.nome}</p>
                <p className="text-xs text-gray-400">{formatarTamanho(a.tamanho)} — {formatarData(a.criadoEm)}</p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button type="button" onClick={() => visualizar(a.id, a.tipo)} className="p-1 text-gray-400 hover:text-frivo-600 rounded" title="Visualizar">
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

      <Button
        type="button"
        variant="secondary"
        loading={uploading}
        onClick={() => inputRef.current?.click()}
        className="w-full justify-center border-dashed"
      >
        <Upload className="w-4 h-4" />
        {uploading ? "Enviando..." : "Enviar anexo"}
      </Button>
      <p className="text-xs text-gray-400 text-center">PDF, DOC, XLS ou imagens — máx. 5 MB</p>

      {/* Modal de preview */}
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
