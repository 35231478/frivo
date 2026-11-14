"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { ToggleSwitch, ToggleGroup } from "@/components/ui/toggle-switch";
import { toast } from "@/components/ui/avisos";
import { SomenteLeitura, erroDaResposta, usePodeGerenciarConfig } from "@/components/config/permissao-config";
import type { QrConfig } from "@/lib/qr-config";

type BoolKey = { [K in keyof QrConfig]: QrConfig[K] extends boolean ? K : never }[keyof QrConfig];

/**
 * Configurações › QR Code: o que a página pública do equipamento mostra. Só quem tem Configurações ›
 * gerenciar grava (o servidor recusa de qualquer jeito); sem ela, tudo fica travado e sem o botão Salvar.
 */
export function QrConfigClient({ inicial }: { inicial: QrConfig }) {
  const podeEditar = usePodeGerenciarConfig();
  const [cfg, setCfg] = useState<QrConfig>(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  function toggle(key: BoolKey) {
    setCfg((c) => ({ ...c, [key]: !c[key] }));
  }
  function campo(key: keyof QrConfig, value: string) {
    setCfg((c) => ({ ...c, [key]: value }));
  }

  async function salvar() {
    setErro(""); setSalvando(true);
    try {
      const res = await fetch("/api/configuracoes/qr-code", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) { setErro(await erroDaResposta(res, "Não foi possível salvar.")); return; }
      toast("Configurações do QR Code salvas.");
    } catch { setErro("Sem conexão. Tente de novo."); } finally { setSalvando(false); }
  }

  return (
    <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6 space-y-8" data-qr-config>
      {erro && <div role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3" data-erro-qr>{erro}</div>}
      <fieldset disabled={!podeEditar} className="space-y-8 min-w-0">

      <ToggleGroup title="Acesso público" dica="Informações exibidas na página aberta pelo QR Code.">
        <ToggleSwitch label="Página pública ativa" dica="Desativada, a página pública fica inacessível." checked={cfg.paginaPublicaAtiva} onChange={() => toggle("paginaPublicaAtiva")} />
        <ToggleSwitch label="Mostrar histórico de manutenções" checked={cfg.mostrarHistorico} onChange={() => toggle("mostrarHistorico")} />
        <ToggleSwitch label="Mostrar próxima manutenção agendada" checked={cfg.mostrarProximaManutencao} onChange={() => toggle("mostrarProximaManutencao")} />
        <ToggleSwitch label="Mostrar dados do equipamento" dica="Modelo, marca e número de série." checked={cfg.mostrarDadosEquipamento} onChange={() => toggle("mostrarDadosEquipamento")} />
        <ToggleSwitch label="Mostrar localização do equipamento" checked={cfg.mostrarLocalizacao} onChange={() => toggle("mostrarLocalizacao")} />
      </ToggleGroup>

      <ToggleGroup title="Botões de contato" dica="Ações disponíveis para quem acessa o QR Code.">
        <ToggleSwitch label='Botão "Falar conosco" via WhatsApp' checked={cfg.botaoWhatsapp} onChange={() => toggle("botaoWhatsapp")} />
        <ToggleSwitch label='Botão "Solicitar orçamento"' checked={cfg.botaoOrcamento} onChange={() => toggle("botaoOrcamento")} />
        <ToggleSwitch label='Botão "Abrir chamado"' checked={cfg.botaoChamado} onChange={() => toggle("botaoChamado")} />
      </ToggleGroup>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="WhatsApp para contato">
          <Input value={cfg.whatsappNumero} onChange={(e) => campo("whatsappNumero", e.target.value)} placeholder="(11) 99999-9999" />
        </FormField>
        <FormField label="Link do site">
          <Input value={cfg.linkSite} onChange={(e) => campo("linkSite", e.target.value)} placeholder="https://..." />
        </FormField>
      </div>
      <FormField label="Mensagem de boas-vindas personalizada">
        <Textarea value={cfg.mensagemBoasVindas} onChange={(e) => campo("mensagemBoasVindas", e.target.value)} rows={2} placeholder="Mensagem exibida no topo da página pública" />
      </FormField>

      <ToggleGroup title="Restrições" dica="Ações que exigem login no portal do cliente.">
        <ToggleSwitch label="Chamado somente para clientes logados no portal" checked={cfg.chamadoSomenteLogado} onChange={() => toggle("chamadoSomenteLogado")} />
        <ToggleSwitch label="Histórico completo somente para clientes logados" checked={cfg.historicoSomenteLogado} onChange={() => toggle("historicoSomenteLogado")} />
        <ToggleSwitch label="Formulário de orçamento somente para clientes logados" checked={cfg.orcamentoSomenteLogado} onChange={() => toggle("orcamentoSomenteLogado")} />
      </ToggleGroup>

      </fieldset>

      {podeEditar ? (
        <div className="flex justify-end pt-2 border-t border-surface-linha">
          <Button onClick={salvar} loading={salvando} data-salvar-qr>Salvar configurações</Button>
        </div>
      ) : (
        <SomenteLeitura />
      )}
    </div>
  );
}
