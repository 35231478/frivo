"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Trash2, ImageIcon } from "lucide-react";

interface LogoUploadProps {
  clienteId: string;
  logoInicial?: string | null;
  /** Variante enxuta (ao lado dos dados básicos): preview menor e dica inline. */
  compacto?: boolean;
}

export function LogoUpload({ clienteId, logoInicial, compacto }: LogoUploadProps) {
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
        <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-xs rounded-lg px-3 py-1.5">{erro}</div>
      )}

      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleUpload} className="hidden" />

      {logo ? (
        <div className="flex items-center gap-4">
          <img src={logo} alt="Logo" className={`${compacto ? "w-14 h-14" : "w-20 h-20"} object-contain rounded-lg border border-surface-border bg-white p-1`} />
          <div className={compacto ? "flex items-center gap-2" : "flex flex-col gap-1.5"}>
            <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} loading={uploading} className="text-xs py-1 px-2.5 h-auto">
              <Upload className="w-3 h-3" /> Trocar
            </Button>
            <Button type="button" variant="ghost" onClick={removerLogo} className="text-xs text-atrasado hover:text-atrasado-texto py-1 px-2.5 h-auto">
              <Trash2 className="w-3 h-3" /> Excluir
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`flex flex-col items-center justify-center ${compacto ? "w-16 h-16" : "w-24 h-24"} border-2 border-dashed border-surface-border rounded-lg hover:border-frivo-400 hover:bg-frivo-50/50 transition-colors cursor-pointer`}
        >
          {uploading ? (
            <span className="text-xs text-ink-muted">Enviando…</span>
          ) : (
            <>
              <ImageIcon className={compacto ? "w-5 h-5 text-ink-subtle" : "w-6 h-6 text-ink-subtle"} />
              <span className="text-[11px] text-ink-muted mt-1">Enviar logo</span>
            </>
          )}
        </button>
      )}
      {!compacto && <p className="text-xs text-ink-muted">PNG, JPG ou WEBP — máx. 2 MB</p>}
    </div>
  );
}
