"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FileSignature, CheckCircle2, AlertCircle, ArrowRight } from "lucide-react";

interface ConverterContratoProps {
  orcamentoId: string;
}

export function ConverterContrato({ orcamentoId }: ConverterContratoProps) {
  const router = useRouter();
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState<{ contratoId: string; numero: string } | null>(null);

  async function converter() {
    if (!confirm("Converter esta proposta aprovada em um contrato ativo?")) return;
    setCarregando(true);
    setErro("");
    try {
      const res = await fetch(`/api/orcamentos/${orcamentoId}/gerar-contrato`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.erro ?? "Erro ao converter a proposta.");
        return;
      }
      setSucesso({ contratoId: data.contratoId, numero: data.numero });
      router.refresh();
    } catch {
      setErro("Erro de conexão.");
    } finally {
      setCarregando(false);
    }
  }

  if (sucesso) {
    return (
      <div className="bg-success-50 border-2 border-success-500 text-success-700 rounded-xl px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-6 h-6 shrink-0" />
          <p className="font-semibold">Contrato {sucesso.numero} criado com sucesso!</p>
        </div>
        <Link href={`/contratos/${sucesso.contratoId}/editar`} className="inline-flex items-center gap-1.5 font-semibold hover:underline">
          Ver contrato <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-success-50/60 border border-success-500/40 rounded-xl px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
      <div>
        <p className="font-semibold text-ink flex items-center gap-2"><FileSignature className="w-4 h-4 text-success-600" /> Proposta aprovada pelo cliente</p>
        <p className="text-sm text-ink-muted">Gere o contrato com recorrência de OS já configurada a partir desta proposta.</p>
        {erro && <p className="text-sm text-red-600 mt-1 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> {erro}</p>}
      </div>
      <Button type="button" variant="primary" loading={carregando} onClick={converter}>
        <FileSignature className="w-4 h-4" /> Converter em Contrato
      </Button>
    </div>
  );
}
