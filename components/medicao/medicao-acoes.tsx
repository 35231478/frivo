"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import {
  Mail, MessageCircle, Link2, Send, Ban, Pencil, Check, AlertCircle,
  FileCheck, ScrollText, Receipt, DollarSign,
} from "lucide-react";

interface MedicaoAcoesProps {
  medicaoId: string;
  numero: string;
  tokenPublico: string;
  status: string;
}

type Painel = "PC" | "NF" | "BOLETO" | "PAGAMENTO" | null;

export function MedicaoAcoes({ medicaoId, numero, tokenPublico, status }: MedicaoAcoesProps) {
  const router = useRouter();
  const [carregando, setCarregando] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tipo: "ok" | "erro"; msg: string } | null>(null);
  const [painel, setPainel] = useState<Painel>(null);

  // Campos dos painéis
  const [pcNumero, setPcNumero] = useState("");
  const [pcAnexoUrl, setPcAnexoUrl] = useState("");
  const [nfNumero, setNfNumero] = useState("");
  const [nfUrl, setNfUrl] = useState("");
  const [boletoUrl, setBoletoUrl] = useState("");
  const [boletoCodigo, setBoletoCodigo] = useState("");
  const [dataPagamento, setDataPagamento] = useState(new Date().toISOString().slice(0, 10));
  const [formaPagamento, setFormaPagamento] = useState("BOLETO");

  const publicUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/medicao/${tokenPublico}`
      : `/medicao/${tokenPublico}`;

  async function executar(acao: string, extra: Record<string, unknown> = {}, viaAposta?: "mailto" | "whatsapp" | "copiar") {
    setCarregando(viaAposta ?? acao);
    setFeedback(null);
    try {
      const res = await fetch(`/api/medicoes/${medicaoId}/acao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao, ...extra }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFeedback({ tipo: "erro", msg: err.erro ?? "Erro ao processar ação." });
        return false;
      }
      const data = await res.json();

      if (viaAposta === "mailto") {
        if (data.mailtoUrl) window.location.href = data.mailtoUrl;
        else setFeedback({ tipo: "erro", msg: "Cliente sem e-mail de faturamento cadastrado." });
      } else if (viaAposta === "whatsapp") {
        if (data.whatsappUrl) window.open(data.whatsappUrl, "_blank", "noopener");
        else setFeedback({ tipo: "erro", msg: "Cliente sem WhatsApp de faturamento cadastrado." });
      } else if (viaAposta === "copiar") {
        await navigator.clipboard.writeText(publicUrl);
        setFeedback({ tipo: "ok", msg: "Link copiado!" });
      }
      setPainel(null);
      router.refresh();
      return true;
    } catch {
      setFeedback({ tipo: "erro", msg: "Erro de conexão." });
      return false;
    } finally {
      setCarregando(null);
    }
  }

  return (
    <div className="space-y-3">
      {feedback && (
        <div className={
          feedback.tipo === "ok"
            ? "bg-success-50 border border-success-200 text-success-700 text-sm rounded-lg px-3 py-2 flex items-center gap-2"
            : "bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 flex items-center gap-2"
        }>
          {feedback.tipo === "ok" ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {feedback.msg}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {/* RASCUNHO → enviar para aprovação */}
        {status === "RASCUNHO" && (
          <>
            <Button variant="primary" onClick={() => executar("ENVIAR", {}, "mailto")} loading={carregando === "mailto"}>
              <Mail className="w-4 h-4" /> Enviar p/ aprovação (E-mail)
            </Button>
            <Button variant="success" onClick={() => executar("ENVIAR", {}, "whatsapp")} loading={carregando === "whatsapp"}>
              <MessageCircle className="w-4 h-4" /> Enviar (WhatsApp)
            </Button>
            <Button variant="outline" onClick={() => executar("ENVIAR", {}, "copiar")} loading={carregando === "copiar"}>
              <Link2 className="w-4 h-4" /> Copiar link
            </Button>
            <Link href={`/financeiro/medicoes/${medicaoId}/editar`} className="btn-secondary">
              <Pencil className="w-4 h-4" /> Editar
            </Link>
          </>
        )}

        {/* AGUARDANDO_APROVACAO */}
        {status === "AGUARDANDO_APROVACAO" && (
          <>
            <Button variant="primary" onClick={() => executar("ENVIAR", {}, "copiar")} loading={carregando === "copiar"}>
              <Link2 className="w-4 h-4" /> Reenviar / copiar link
            </Button>
            <Button variant="success" onClick={() => executar("APROVAR_MANUAL")} loading={carregando === "APROVAR_MANUAL"}>
              <FileCheck className="w-4 h-4" /> Registrar aprovação manual
            </Button>
          </>
        )}

        {/* AGUARDANDO_PC */}
        {status === "AGUARDANDO_PC" && (
          <Button variant="primary" onClick={() => setPainel(painel === "PC" ? null : "PC")}>
            <ScrollText className="w-4 h-4" /> Registrar PC recebido
          </Button>
        )}

        {/* PC_RECEBIDO → registrar NF */}
        {status === "PC_RECEBIDO" && (
          <Button variant="primary" onClick={() => setPainel(painel === "NF" ? null : "NF")}>
            <Receipt className="w-4 h-4" /> Registrar NF emitida
          </Button>
        )}

        {/* NF_EMITIDA → registrar boleto */}
        {status === "NF_EMITIDA" && (
          <Button variant="primary" onClick={() => setPainel(painel === "BOLETO" ? null : "BOLETO")}>
            <Receipt className="w-4 h-4" /> Registrar boleto gerado
          </Button>
        )}

        {/* Registrar pagamento — qualquer status ativo */}
        {status !== "RASCUNHO" && status !== "PAGO" && status !== "CANCELADA" && (
          <Button variant="success" onClick={() => setPainel(painel === "PAGAMENTO" ? null : "PAGAMENTO")}>
            <DollarSign className="w-4 h-4" /> Registrar pagamento
          </Button>
        )}

        {/* Link público sempre disponível */}
        {status !== "RASCUNHO" && (
          <a href={publicUrl} target="_blank" rel="noopener" className="btn-secondary">
            <Send className="w-4 h-4" /> Ver página do cliente
          </a>
        )}

        {/* Cancelar */}
        {status !== "PAGO" && status !== "CANCELADA" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { if (confirm("Cancelar esta medição?")) executar("CANCELAR"); }}
            loading={carregando === "CANCELAR"}
          >
            <Ban className="w-3.5 h-3.5" /> Cancelar
          </Button>
        )}
      </div>

      {/* Painel: PC */}
      {painel === "PC" && (
        <div className="border border-primary-200 bg-primary-50/30 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-bold text-primary-700">Registrar Pedido de Compra (PC)</h4>
          <FormGrid cols={2}>
            <FormField label="Número do PC" required>
              <Input value={pcNumero} onChange={(e) => setPcNumero(e.target.value)} placeholder="Ex.: PC-2026-001" />
            </FormField>
            <FormField label="Link do anexo (URL)" hint="Opcional">
              <Input value={pcAnexoUrl} onChange={(e) => setPcAnexoUrl(e.target.value)} placeholder="https://..." />
            </FormField>
          </FormGrid>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPainel(null)}>Cancelar</Button>
            <Button onClick={() => executar("REGISTRAR_PC", { pcNumero, pcAnexoUrl })} loading={carregando === "REGISTRAR_PC"}>
              <Check className="w-4 h-4" /> Confirmar PC
            </Button>
          </div>
        </div>
      )}

      {/* Painel: NF */}
      {painel === "NF" && (
        <div className="border border-primary-200 bg-primary-50/30 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-bold text-primary-700">Registrar Nota Fiscal</h4>
          <FormGrid cols={2}>
            <FormField label="Número da NF" required>
              <Input value={nfNumero} onChange={(e) => setNfNumero(e.target.value)} placeholder="Ex.: 12345" />
            </FormField>
            <FormField label="Link da NF (URL)" hint="Opcional">
              <Input value={nfUrl} onChange={(e) => setNfUrl(e.target.value)} placeholder="https://..." />
            </FormField>
          </FormGrid>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPainel(null)}>Cancelar</Button>
            <Button onClick={() => executar("REGISTRAR_NF", { nfNumero, nfUrl })} loading={carregando === "REGISTRAR_NF"}>
              <Check className="w-4 h-4" /> Confirmar NF
            </Button>
          </div>
        </div>
      )}

      {/* Painel: Boleto */}
      {painel === "BOLETO" && (
        <div className="border border-primary-200 bg-primary-50/30 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-bold text-primary-700">Registrar Boleto</h4>
          <FormGrid cols={2}>
            <FormField label="Link do boleto (URL)" hint="Opcional">
              <Input value={boletoUrl} onChange={(e) => setBoletoUrl(e.target.value)} placeholder="https://..." />
            </FormField>
            <FormField label="Linha digitável / código de barras" hint="Opcional">
              <Input value={boletoCodigo} onChange={(e) => setBoletoCodigo(e.target.value)} placeholder="00000.00000 ..." />
            </FormField>
          </FormGrid>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPainel(null)}>Cancelar</Button>
            <Button onClick={() => executar("REGISTRAR_BOLETO", { boletoUrl, boletoCodigoBarras: boletoCodigo })} loading={carregando === "REGISTRAR_BOLETO"}>
              <Check className="w-4 h-4" /> Confirmar boleto
            </Button>
          </div>
        </div>
      )}

      {/* Painel: Pagamento */}
      {painel === "PAGAMENTO" && (
        <div className="border border-success-200 bg-success-50/30 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-bold text-success-700">Registrar Pagamento</h4>
          <FormGrid cols={2}>
            <FormField label="Data do pagamento" required>
              <Input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
            </FormField>
            <FormField label="Forma de pagamento">
              <Select value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)}>
                {Object.entries(LABELS_FORMA_PAGAMENTO).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Select>
            </FormField>
          </FormGrid>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPainel(null)}>Cancelar</Button>
            <Button variant="success" onClick={() => executar("REGISTRAR_PAGAMENTO", { dataPagamento, formaPagamento })} loading={carregando === "REGISTRAR_PAGAMENTO"}>
              <Check className="w-4 h-4" /> Confirmar pagamento
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
