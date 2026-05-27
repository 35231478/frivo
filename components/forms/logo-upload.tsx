"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Trash2, ImageIcon } from "lucide-react";

interface LogoUploadProps {
  clienteId: string;
  logoInicial?: string | null;
}

export function LogoUpload({ clienteId, logoInicial }: LogoUploadProps) {
  const [logo, setLogo] = useState<string | null>(logoInicial ?? null);
  const [uploading, setUploading] = useState(false);
  const [erro, setErro] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErro("");
    setUploading(true);

    const formData = new FormData();
    formData.append("logo", file);

    try {
      const res = await fetch(`/api/clientes/${clienteId}/logo`, {
        method: "PUT",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        setErro(err.erro ?? "Erro ao enviar logo.");
        return;
      }
      const data = await res.json();
      setLogo(data.logo);
    } catch {
      setErro("Erro de conexão.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function removerLogo() {
    try {
      const res = await fetch(`/api/clientes/${clienteId}/logo`, { method: "DELETE" });
      if (!res.ok) return;
      setLogo(null);
    } catch {}
  }

  return (
    <div className="space-y-2">
      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-1.5">{erro}</div>
      )}

      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleUpload} className="hidden" />

      {logo ? (
        <div className="flex items-center gap-4">
          <img src={logo} alt="Logo" className="w-20 h-20 object-contain rounded-lg border border-gray-200 bg-white p-1" />
          <div className="flex flex-col gap-1.5">
            <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} loading={uploading} className="text-xs py-1 px-2.5 h-auto">
              <Upload className="w-3 h-3" /> Trocar
            </Button>
            <Button type="button" variant="ghost" onClick={removerLogo} className="text-xs text-red-500 hover:text-red-700 py-1 px-2.5 h-auto">
              <Trash2 className="w-3 h-3" /> Remover
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex flex-col items-center justify-center w-24 h-24 border-2 border-dashed border-gray-300 rounded-lg hover:border-frivo-400 hover:bg-frivo-50/50 transition-colors cursor-pointer"
        >
          {uploading ? (
            <span className="text-xs text-gray-400">Enviando…</span>
          ) : (
            <>
              <ImageIcon className="w-6 h-6 text-gray-300" />
              <span className="text-xs text-gray-400 mt-1">Enviar logo</span>
            </>
          )}
        </button>
      )}
      <p className="text-xs text-gray-400">PNG, JPG ou WEBP — máx. 2 MB</p>
    </div>
  );
}
