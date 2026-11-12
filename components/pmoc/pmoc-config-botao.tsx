"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { toast } from "@/components/ui/avisos";
import { DIAS_AVISO_MAX, DIAS_AVISO_MIN } from "@/lib/pmoc-avisos";

/**
 * Configurações do PMOC desta empresa: com quantos dias de antecedência avisar do vencimento e o
 * texto técnico que os planos novos recebem. Quem edita PMOC altera; o servidor confere de novo.
 */
export function PmocConfigBotao() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [dias, setDias] = useState("");
  const [texto, setTexto] = useState("");
  const [textoDoSistema, setTextoDoSistema] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function abrir() {
    setAberto(true); setErro(""); setCarregando(true);
    try {
      const res = await fetch("/api/pmocs/configuracao");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível carregar."); return; }
      setDias(String(d.diasAviso)); setTextoDoSistema(d.textoDoSistema ?? ""); setTexto(d.textoPadrao ?? d.textoDoSistema ?? "");
    } catch { setErro("Erro de conexão."); } finally { setCarregando(false); }
  }
  async function salvar() {
    setErro(""); setSalvando(true);
    try {
      const res = await fetch("/api/pmocs/configuracao", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diasAviso: dias === "" ? NaN : Number(dias), textoPadrao: texto }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível salvar."); return; }
      toast("Configurações do PMOC salvas.");
      setAberto(false);
      router.refresh();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <>
      <button type="button" onClick={abrir} data-config-pmoc
        className="inline-flex items-center gap-2 border border-surface-border bg-white text-ink hover:bg-surface-alt px-3 py-2.5 rounded-lg text-sm font-medium">
        <Settings className="w-4 h-4" /> Configurações
      </button>
      <Modal aberto={aberto} onFechar={() => setAberto(false)} titulo="Configurações do PMOC" tamanho="lg">
        <fieldset disabled={carregando} className="space-y-4" data-form-config-pmoc>
          <FormField label="Avisar quantos dias antes da expiração" required hint={`De ${DIAS_AVISO_MIN} a ${DIAS_AVISO_MAX} dias`}
            dica="A partir desse prazo o plano aparece no sino e no dashboard como perto de expirar.">
            <Input aria-label="Dias de antecedência do aviso" type="number" inputMode="numeric" min={DIAS_AVISO_MIN} max={DIAS_AVISO_MAX} step={1}
              value={dias} onChange={(e) => setDias(e.target.value)} className="max-w-[10rem]" />
          </FormField>
          <FormField label="Texto técnico dos planos novos" hint="Entra na descrição de cada PMOC criado; o plano pode ajustar o dele."
            dica="É o texto de apresentação e base normativa que sai no documento do plano.">
            <Textarea aria-label="Texto técnico padrão" value={texto} onChange={(e) => setTexto(e.target.value)} rows={12} className="text-[13px] leading-relaxed" />
          </FormField>
          {texto !== textoDoSistema && (
            <button type="button" onClick={() => setTexto(textoDoSistema)} className="text-xs text-primary-600 hover:underline" data-restaurar-texto>Restaurar o texto do sistema</button>
          )}
          {erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" data-erro-config>{erro}</p>}
          <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
            <Button type="button" variant="secondary" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button type="button" loading={salvando} onClick={salvar} data-salvar-config>Salvar</Button>
          </div>
        </fieldset>
      </Modal>
    </>
  );
}
