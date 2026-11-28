"use client";

import { confirmar, toast } from "@/components/ui/avisos";
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
import { chaveHojeBR } from "@/lib/fuso";
import { InputData } from "@/components/ui/input-data";
import { GavetaPedido } from "@/components/pedido-cliente/gaveta-pedido";
import { usePermissoes } from "@/components/providers/permissoes-provider";

interface MedicaoAcoesProps {
  medicaoId: string;
  numero: string;
  tokenPublico: string;
  status: string;
  /** Fatura avulsa: textos dizem "fatura" */
  avulsa?: boolean;
}

type Painel = "PC" | "NF" | "BOLETO" | "PAGAMENTO" | null;

/** O que o toast diz quando a ação dá certo (o documento é "medição" ou "fatura"). */
const FEITO = (acao: string, doc: string): string => ({
  ENVIAR: `${doc} enviada para aprovação.`,
  APROVAR_MANUAL: `Aprovação registrada: a ${doc.toLowerCase()} seguiu no ciclo.`,
  REGISTRAR_PC: "Pedido do cliente informado.",
  REGISTRAR_NF: "Nota fiscal registrada.",
  REGISTRAR_BOLETO: "Boleto registrado.",
  REGISTRAR_PAGAMENTO: `Pagamento registrado: ${doc.toLowerCase()} quitada.`,
  CANCELAR: `${doc} cancelada.`,
}[acao] ?? "Pronto.");

export function MedicaoAcoes({ medicaoId, numero, tokenPublico, status, avulsa }: MedicaoAcoesProps) {
  const router = useRouter();
  // Enviar, aprovar, registrar PC/NF/boleto/pagamento e cancelar mexem no faturamento: só para quem
  // tem Financeiro › medições (a mesma permissão que a rota da ação exige). Ver a página do cliente
  // é leitura e continua para quem só consulta.
  const podeMexer = usePermissoes().pode("financeiro", "medicoes");
  const doc = avulsa ? "Fatura" : "Medição";
  const [carregando, setCarregando] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tipo: "ok" | "erro"; msg: string } | null>(null);
  const [painel, setPainel] = useState<Painel>(null);

  // Campos dos painéis
  const [nfNumero, setNfNumero] = useState("");
  const [nfUrl, setNfUrl] = useState("");
  const [boletoUrl, setBoletoUrl] = useState("");
  const [boletoCodigo, setBoletoCodigo] = useState("");
  const [dataPagamento, setDataPagamento] = useState(chaveHojeBR());
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

      // Sucesso é toast (padrão da casa); o erro de validação fica na tela, onde a pessoa está olhando
      if (viaAposta === "mailto") {
        if (!data.mailtoUrl) { setFeedback({ tipo: "erro", msg: "Cliente sem e-mail de faturamento cadastrado." }); return false; }
        toast(FEITO(acao, doc));
        window.location.href = data.mailtoUrl;
      } else if (viaAposta === "whatsapp") {
        if (!data.whatsappUrl) { setFeedback({ tipo: "erro", msg: "Cliente sem WhatsApp de faturamento cadastrado." }); return false; }
        toast(FEITO(acao, doc));
        window.open(data.whatsappUrl, "_blank", "noopener");
      } else if (viaAposta === "copiar") {
        await navigator.clipboard.writeText(publicUrl);
        toast("Link copiado.");
      } else {
        toast(FEITO(acao, doc));
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
            : "bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2 flex items-center gap-2"
        }>
          {feedback.tipo === "ok" ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {feedback.msg}
        </div>
      )}

      <div className="flex flex-wrap gap-2" data-acoes-medicao>
        {/* RASCUNHO → enviar para aprovação */}
        {podeMexer && status === "RASCUNHO" && (
          <>
            <Button variant="primary" data-enviar-email onClick={() => executar("ENVIAR", {}, "mailto")} loading={carregando === "mailto"}>
              <Mail className="w-4 h-4" /> Enviar p/ aprovação (E-mail)
            </Button>
            <Button variant="secondary" onClick={() => executar("ENVIAR", {}, "whatsapp")} loading={carregando === "whatsapp"}>
              <MessageCircle className="w-4 h-4" /> Enviar (WhatsApp)
            </Button>
            <Button variant="outline" onClick={() => executar("ENVIAR", {}, "copiar")} loading={carregando === "copiar"}>
              <Link2 className="w-4 h-4" /> Copiar link
            </Button>
            <Link href={`/financeiro/medicoes/${medicaoId}/editar`} data-editar-medicao className="btn-secondary">
              <Pencil className="w-4 h-4" /> Editar
            </Link>
          </>
        )}

        {/* AGUARDANDO_APROVACAO */}
        {podeMexer && status === "AGUARDANDO_APROVACAO" && (
          <>
            <Button variant="primary" onClick={() => executar("ENVIAR", {}, "copiar")} loading={carregando === "copiar"}>
              <Link2 className="w-4 h-4" /> Reenviar / copiar link
            </Button>
            <Button variant="success" data-aprovar-manual onClick={() => executar("APROVAR_MANUAL")} loading={carregando === "APROVAR_MANUAL"}>
              <FileCheck className="w-4 h-4" /> Registrar aprovação manual
            </Button>
          </>
        )}

        {/* AGUARDANDO_PC */}
        {podeMexer && status === "AGUARDANDO_PC" && (
          <Button variant="primary" data-registrar-pc onClick={() => setPainel("PC")}>
            <ScrollText className="w-4 h-4" /> Informar pedido do cliente
          </Button>
        )}

        {/* PC_RECEBIDO → registrar NF */}
        {podeMexer && status === "PC_RECEBIDO" && (
          <Button variant="primary" data-registrar-nf onClick={() => setPainel(painel === "NF" ? null : "NF")}>
            <Receipt className="w-4 h-4" /> Registrar NF emitida
          </Button>
        )}

        {/* NF_EMITIDA → registrar boleto */}
        {podeMexer && status === "NF_EMITIDA" && (
          <Button variant="primary" data-registrar-boleto onClick={() => setPainel(painel === "BOLETO" ? null : "BOLETO")}>
            <Receipt className="w-4 h-4" /> Registrar boleto gerado
          </Button>
        )}

        {/* Registrar pagamento — qualquer status ativo */}
        {podeMexer && status !== "RASCUNHO" && status !== "PAGO" && status !== "CANCELADA" && (
          <Button variant="success" data-registrar-pagamento onClick={() => setPainel(painel === "PAGAMENTO" ? null : "PAGAMENTO")}>
            <DollarSign className="w-4 h-4" /> Registrar pagamento
          </Button>
        )}

        {/* Link público sempre disponível */}
        {status !== "RASCUNHO" && (
          <a href={publicUrl} target="_blank" rel="noopener" data-pagina-cliente className="btn-secondary">
            <Send className="w-4 h-4" /> Ver página do cliente
          </a>
        )}

        {/* Cancelar */}
        {podeMexer && status !== "PAGO" && status !== "CANCELADA" && (
          <Button
            variant="ghost"
            size="sm"
            data-cancelar-medicao
            onClick={async () => {
              if (await confirmar({
                mensagem: `Cancelar ${doc.toLowerCase()} ${numero}? As contas a receber geradas voltam a previsto.`,
                perigo: true, confirmarTexto: avulsa ? "Cancelar fatura" : "Cancelar medição", cancelarTexto: "Voltar",
              })) executar("CANCELAR");
            }}
            loading={carregando === "CANCELAR"}
          >
            <Ban className="w-3.5 h-3.5" /> Cancelar
          </Button>
        )}
      </div>

      {/* Pedido do cliente (o antigo "PC"): a MESMA gaveta da OS e do orçamento — o pedido fica nas OS/orçamentos da
          fatura, entra na NFS-e e a fatura segue para a nota (lib/pedido-cliente) */}
      {painel === "PC" && <GavetaPedido aberto onFechar={() => setPainel(null)} alvo={{ medicaoId }} />}

      {/* Painel: NF */}
      {painel === "NF" && (
        <div className="border border-surface-border bg-surface-alt/60 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-ink">Registrar nota fiscal</h4>
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
        <div className="border border-surface-border bg-surface-alt/60 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-ink">Registrar boleto</h4>
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
        <div className="border border-surface-border bg-surface-alt/60 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-ink">Registrar pagamento</h4>
          <FormGrid cols={2}>
            <FormField label="Data do pagamento" required>
              <InputData value={dataPagamento} onChange={(v) => setDataPagamento(v)} />
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
