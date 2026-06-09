"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FormSection } from "@/components/ui/form-field";
import { QrCode, Download, Unlink, Plus, Link2 } from "lucide-react";

type QrRef = { id: string; codigo: string };

export function EquipamentoQrSection({ equipamentoId, qrInicial }: { equipamentoId: string; qrInicial: QrRef | null }) {
  const [qr, setQr] = useState<QrRef | null>(qrInicial);
  const [imagem, setImagem] = useState("");
  const [urlPublica, setUrlPublica] = useState("");
  const [disponiveis, setDisponiveis] = useState<{ id: string; codigo: string }[]>([]);
  const [selecionado, setSelecionado] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  const carregarImagem = useCallback(async (qrId: string) => {
    try {
      const res = await fetch(`/api/qrcodes/${qrId}`);
      if (res.ok) {
        const d = await res.json();
        setImagem(d.imagem ?? "");
        setUrlPublica(d.urlPublica ?? "");
      }
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => {
    if (qr) carregarImagem(qr.id);
  }, [qr, carregarImagem]);

  // Carrega QR Codes não vinculados para o select "vincular existente"
  useEffect(() => {
    if (qr) return;
    fetch("/api/qrcodes?vinculado=false")
      .then((r) => r.json())
      .then((lista) => setDisponiveis(lista.map((q: any) => ({ id: q.id, codigo: q.codigo }))))
      .catch(() => {});
  }, [qr]);

  async function gerar() {
    setErro(""); setCarregando(true);
    try {
      const res = await fetch(`/api/equipamentos/${equipamentoId}/qrcode`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao gerar."); return; }
      const d = await res.json();
      setQr({ id: d.id, codigo: d.codigo });
    } catch { setErro("Erro de conexão."); } finally { setCarregando(false); }
  }

  async function vincularExistente() {
    if (!selecionado) { setErro("Selecione um QR Code."); return; }
    setErro(""); setCarregando(true);
    try {
      const res = await fetch(`/api/equipamentos/${equipamentoId}/qrcode`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qrcodeId: selecionado }),
      });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao vincular."); return; }
      const d = await res.json();
      setQr({ id: d.id, codigo: d.codigo });
    } catch { setErro("Erro de conexão."); } finally { setCarregando(false); }
  }

  async function desvincular() {
    setErro(""); setCarregando(true);
    try {
      const res = await fetch(`/api/equipamentos/${equipamentoId}/qrcode`, { method: "DELETE" });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao desvincular."); return; }
      setQr(null); setImagem(""); setUrlPublica(""); setSelecionado("");
    } catch { setErro("Erro de conexão."); } finally { setCarregando(false); }
  }

  function baixar() {
    if (!imagem || !qr) return;
    const a = document.createElement("a");
    a.href = imagem;
    a.download = `${qr.codigo}.png`;
    a.click();
  }

  return (
    <FormSection title="QR Code">
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2.5 mb-3">{erro}</div>}

      {qr ? (
        <div className="flex flex-col sm:flex-row gap-5 items-start">
          <div className="shrink-0 border border-gray-200 rounded-lg p-2 bg-white">
            {imagem ? <img src={imagem} alt={qr.codigo} className="w-40 h-40" /> : <div className="w-40 h-40 flex items-center justify-center text-ink-subtle"><QrCode className="w-10 h-10" /></div>}
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div>
              <p className="text-xs text-ink-muted">Código</p>
              <p className="font-mono font-medium text-ink">{qr.codigo}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Link público</p>
              {urlPublica ? (
                <a href={urlPublica} target="_blank" rel="noreferrer" className="text-sm text-primary-600 hover:underline break-all">{urlPublica}</a>
              ) : <span className="text-sm text-ink-subtle">—</span>}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" variant="secondary" size="sm" onClick={baixar} disabled={!imagem}>
                <Download className="w-3.5 h-3.5" /> Baixar QR Code
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={desvincular} loading={carregando} className="text-red-500">
                <Unlink className="w-3.5 h-3.5" /> Desvincular
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">Este equipamento ainda não possui um QR Code.</p>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <Button type="button" onClick={gerar} loading={carregando}>
              <Plus className="w-4 h-4" /> Gerar QR Code
            </Button>
            <span className="text-xs text-ink-subtle sm:pb-2.5">ou</span>
            <div className="flex gap-2 items-center flex-1">
              <Select value={selecionado} onChange={(e) => setSelecionado(e.target.value)} placeholder="Vincular QR existente" className="max-w-xs">
                {disponiveis.map((q) => <option key={q.id} value={q.id}>{q.codigo}</option>)}
              </Select>
              <Button type="button" variant="secondary" onClick={vincularExistente} loading={carregando} disabled={!selecionado}>
                <Link2 className="w-4 h-4" /> Vincular
              </Button>
            </div>
          </div>
        </div>
      )}
    </FormSection>
  );
}
