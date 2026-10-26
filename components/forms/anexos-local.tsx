"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Image, File, Trash2, Eye, X } from "lucide-react";

export interface AnexoLocal {
  _tempId: string;
  nome: string;
  tipo: string;
  tamanho: number;
  conteudo: string;
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconeDoTipo(tipo: string) {
  if (tipo.startsWith("image/")) return <Image className="w-4 h-4 text-acento" />;
  if (tipo.includes("pdf")) return <FileText className="w-4 h-4 text-atrasado" />;
  if (tipo.includes("word") || tipo.includes("document")) return <FileText className="w-4 h-4 text-acento" />;
  if (tipo.includes("excel") || tipo.includes("spreadsheet")) return <FileText className="w-4 h-4 text-ok-texto" />;
  return <File className="w-4 h-4 text-ink-muted" />;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const TIPOS_PERMITIDOS = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png", "image/jpeg", "image/webp",
];

interface AnexosLocalProps {
  anexos: AnexoLocal[];
  onChange: (anexos: AnexoLocal[]) => void;
}

export function AnexosLocal({ anexos, onChange }: AnexosLocalProps) {
  const [erro, setErro] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErro("");

    if (!TIPOS_PERMITIDOS.includes(file.type)) {
      setErro("Tipo de arquivo não permitido. Envie PDF, DOC, XLS ou imagem.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setErro("Arquivo muito grande. Tamanho máximo: 5 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const conteudo = reader.result as string;
      onChange([...anexos, {
        _tempId: crypto.randomUUID(),
        nome: file.name,
        tipo: file.type,
        tamanho: file.size,
        conteudo,
      }]);
    };
    reader.readAsDataURL(file);
    if (inputRef.current) inputRef.current.value = "";
  }

  function remover(id: string) {
    onChange(anexos.filter((a) => a._tempId !== id));
  }

  return (
    <div className="space-y-3">
      {erro && <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2">{erro}</div>}

      <input ref={inputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp" onChange={handleFile} className="hidden" />

      {anexos.length > 0 && (
        <div className="space-y-2">
          {anexos.map((a) => (
            <div key={a._tempId} className="flex items-center gap-3 p-2.5 border border-surface-border rounded-lg group hover:border-surface-border">
              {iconeDoTipo(a.tipo)}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink truncate">{a.nome}</p>
                <p className="text-xs text-ink-muted">{formatarTamanho(a.tamanho)}</p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {(a.tipo.startsWith("image/") || a.tipo.includes("pdf")) && (
                  <button type="button" onClick={() => setPreviewUrl(a.conteudo)} className="p-1 text-ink-muted hover:text-frivo-600 rounded" title="Visualizar">
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                )}
                <button type="button" onClick={() => remover(a._tempId)} className="p-1 text-ink-muted hover:text-atrasado rounded" title="Remover">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} className="w-full justify-center border-dashed">
        <Upload className="w-4 h-4" /> Enviar anexo
      </Button>
      <p className="text-xs text-ink-muted text-center">PDF, DOC, XLS ou imagens — máx. 5 MB</p>

      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setPreviewUrl(null)}>
          <div className="relative bg-white rounded-card max-w-4xl max-h-[90vh] overflow-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setPreviewUrl(null)} className="absolute top-3 right-3 bg-white/90 rounded-full p-1.5 shadow hover:bg-surface-linha z-10">
              <X className="w-4 h-4" />
            </button>
            {previewUrl.startsWith("data:image/") ? (
              <img src={previewUrl} alt="Preview" className="max-w-full max-h-[85vh] rounded-card" />
            ) : (
              <iframe src={previewUrl} className="w-[800px] h-[80vh] rounded-card" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
