"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { ToggleSwitch, ToggleGroup } from "@/components/ui/toggle-switch";
import type { QrConfig } from "@/lib/qr-config";
import { Check } from "lucide-react";

type BoolKey = { [K in keyof QrConfig]: QrConfig[K] extends boolean ? K : never }[keyof QrConfig];

export function QrConfigClient({ inicial }: { inicial: QrConfig }) {
  const [cfg, setCfg] = useState<QrConfig>(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState(false);

  function toggle(key: BoolKey) {
    setCfg((c) => ({ ...c, [key]: !c[key] }));
    setSucesso(false);
  }
  function campo(key: keyof QrConfig, value: string) {
    setCfg((c) => ({ ...c, [key]: value }));
    setSucesso(false);
  }

  async function salvar() {
    setErro(""); setSucesso(false); setSalvando(true);
    try {
      const res = await fetch("/api/configuracoes/qr-code", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao salvar."); return; }
      setSucesso(true);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-8">
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{erro}</div>}
      {sucesso && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 flex items-center gap-2">
          <Check className="w-4 h-4" /> Configurações salvas.
        </div>
      )}

      <ToggleGroup title="Acesso Público" description="O que aparece na página aberta pelo QR Code">
        <ToggleSwitch label="Página pública ativa" description="Desligue para bloquear totalmente o acesso público" checked={cfg.paginaPublicaAtiva} onChange={() => toggle("paginaPublicaAtiva")} />
        <ToggleSwitch label="Mostrar histórico de manutenções" checked={cfg.mostrarHistorico} onChange={() => toggle("mostrarHistorico")} />
        <ToggleSwitch label="Mostrar próxima manutenção agendada" checked={cfg.mostrarProximaManutencao} onChange={() => toggle("mostrarProximaManutencao")} />
        <ToggleSwitch label="Mostrar dados do equipamento" description="Modelo, marca e número de série" checked={cfg.mostrarDadosEquipamento} onChange={() => toggle("mostrarDadosEquipamento")} />
        <ToggleSwitch label="Mostrar localização do equipamento" checked={cfg.mostrarLocalizacao} onChange={() => toggle("mostrarLocalizacao")} />
      </ToggleGroup>

      <ToggleGroup title="Botões de Contato" description="Ações disponíveis para quem acessa o QR Code">
        <ToggleSwitch label='Botão "Falar conosco" via WhatsApp' checked={cfg.botaoWhatsapp} onChange={() => toggle("botaoWhatsapp")} />
        <ToggleSwitch label='Botão "Solicitar orçamento"' checked={cfg.botaoOrcamento} onChange={() => toggle("botaoOrcamento")} />
        <ToggleSwitch label='Botão "Abrir chamado"' checked={cfg.botaoChamado} onChange={() => toggle("botaoChamado")} />
      </ToggleGroup>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Número WhatsApp para contato" hint="Com DDD, ex: (11) 99999-9999">
          <Input value={cfg.whatsappNumero} onChange={(e) => campo("whatsappNumero", e.target.value)} placeholder="(11) 99999-9999" />
        </FormField>
        <FormField label="Link do site">
          <Input value={cfg.linkSite} onChange={(e) => campo("linkSite", e.target.value)} placeholder="https://..." />
        </FormField>
      </div>
      <FormField label="Mensagem de boas-vindas personalizada">
        <Textarea value={cfg.mensagemBoasVindas} onChange={(e) => campo("mensagemBoasVindas", e.target.value)} rows={2} placeholder="Mensagem exibida no topo da página pública" />
      </FormField>

      <ToggleGroup title="Restrições" description="Exigir login no portal do cliente para certas ações">
        <ToggleSwitch label="Chamado somente para clientes logados no portal" checked={cfg.chamadoSomenteLogado} onChange={() => toggle("chamadoSomenteLogado")} />
        <ToggleSwitch label="Histórico completo somente para clientes logados" checked={cfg.historicoSomenteLogado} onChange={() => toggle("historicoSomenteLogado")} />
        <ToggleSwitch label="Formulário de orçamento somente para clientes logados" checked={cfg.orcamentoSomenteLogado} onChange={() => toggle("orcamentoSomenteLogado")} />
      </ToggleGroup>

      <div className="flex justify-end pt-2 border-t border-gray-100">
        <Button onClick={salvar} loading={salvando}>Salvar configurações</Button>
      </div>
    </div>
  );
}
