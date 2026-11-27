"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Smartphone, Check, ShieldCheck, Camera, MapPinned, MonitorSmartphone, Timer } from "lucide-react";
import { toast } from "@/components/ui/avisos";
import { Dica } from "@/components/ui/dica";
import { Button } from "@/components/ui/button";
import { ToggleSwitch, ToggleGroup } from "@/components/ui/toggle-switch";
import { configAppParaPayload, type ConfigApp } from "@/lib/tecnico/config-app";

/**
 * App do colaborador: 3 seções de toggles que governam o que o colaborador VÊ e PODE FAZER no app.
 * Por empresa (global). Salva na mesma Configuracao da empresa (/api/configuracoes).
 */
export function AppColaboradorClient({ inicial }: { inicial: ConfigApp }) {
  const router = useRouter();
  const [cfg, setCfg] = useState<ConfigApp>(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const set = (k: keyof ConfigApp) => (v: boolean) => setCfg((c) => ({ ...c, [k]: v }));

  async function salvar() {
    setErro(""); setSalvando(true);
    try {
      const res = await fetch("/api/configuracoes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configAppParaPayload(cfg)),
      });
      // Recusado: as chaves ficam como a pessoa deixou e a tela diz por quê
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErro(e.erro ?? "Não foi possível salvar as preferências."); return; }
      toast("Preferências do app salvas.");
      router.refresh();
    } catch { setErro("Sem conexão. Tente de novo."); } finally { setSalvando(false); }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header className="flex items-center gap-3">
        <span className="p-2 bg-surface-alt rounded-lg"><Smartphone className="w-5 h-5 text-ink-muted" aria-hidden /></span>
        <h1 className="page-title flex items-center gap-1.5">App do colaborador
          <Dica texto="O que o colaborador vê e pode fazer no app. Vale para a empresa toda; o técnico não vê esta tela." rotulo="App do colaborador" lado="direita" />
        </h1>
      </header>

      {erro && <div role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3" data-erro-app>{erro}</div>}

      {/* ========== Privacidade e comercial ========== */}
      <section className="bg-white rounded-card border border-surface-border p-6">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck className="w-5 h-5 text-frivo-600" />
          <h2 className="text-lg font-semibold text-ink">Privacidade e comercial</h2>
        </div>
        <ToggleGroup title="O que o colaborador enxerga do cliente">
          <ToggleSwitch
            label="Exibir dados do cliente no app"
            dica="Desligado: o app não mostra o nome, o endereço nem a descrição do cliente — só a OS, o tipo e os equipamentos."
            checked={cfg.exibirDadosCliente} onChange={set("exibirDadosCliente")}
          />
          <ToggleSwitch
            label="Exibir contatos do cliente no app"
            dica="Desligado: esconde os botões de Ligar/WhatsApp do cliente no app."
            checked={cfg.exibirContatosCliente} onChange={set("exibirContatosCliente")}
          />
          <ToggleSwitch
            label="Esconder valor de produtos e serviços"
            dica="Ligado: o colaborador não vê preço de produtos nem de serviços no app."
            checked={cfg.esconderValores} onChange={set("esconderValores")}
          />
        </ToggleGroup>
      </section>

      {/* ========== Execução e prova ========== */}
      <section className="bg-white rounded-card border border-surface-border p-6">
        <div className="flex items-center gap-2 mb-4">
          <Camera className="w-5 h-5 text-frivo-600" />
          <h2 className="text-lg font-semibold text-ink">Execução e prova</h2>
        </div>
        <ToggleGroup title="Fotos e execução">
          <ToggleSwitch
            label="Marca d'água nas fotos"
            dica="Ligado: carimba cada foto tirada no app. A data e a hora entram sempre; escolha abaixo o que mais gravar."
            checked={cfg.marcaDagua} onChange={set("marcaDagua")}
          />
          {cfg.marcaDagua && (
            <div className="pl-4 py-2 border-l-2 border-surface-linha ml-1 space-y-0.5" data-marca-dagua-itens>
              <p className="text-xs text-ink-muted py-2">A marca d'água vai registrar:</p>
              <div className="flex items-center gap-2 py-1.5 text-sm text-ink-muted">
                <Check className="w-4 h-4 text-ok" /> Data e hora <span className="text-xs text-ink-subtle">(sempre)</span>
              </div>
              <ToggleSwitch label="Identificador da OS" checked={cfg.marcaDaguaOs} onChange={set("marcaDaguaOs")} />
              <ToggleSwitch label="Endereço" checked={cfg.marcaDaguaEndereco} onChange={set("marcaDaguaEndereco")} />
              <ToggleSwitch
                label="Coordenadas"
                dica="Grava a localização (GPS) do aparelho no momento da foto. O aparelho pede a permissão de localização."
                checked={cfg.marcaDaguaCoordenadas} onChange={set("marcaDaguaCoordenadas")}
              />
            </div>
          )}
          <ToggleSwitch
            label="Exigir localização ativa para usar o app"
            dica="Ligado: sem a localização (GPS) ligada e permitida, o app fica bloqueado."
            checked={cfg.exigirLocalizacao} onChange={set("exigirLocalizacao")}
          />
          <ToggleSwitch
            label="Foto somente pela câmera"
            dica="Ligado: bloqueia enviar foto da galeria — só a câmera do aparelho (no celular)."
            checked={cfg.fotoSomenteCamera} onChange={set("fotoSomenteCamera")}
          />
          <ToggleSwitch
            label="Campo de conclusão obrigatório"
            dica="Ligado: o colaborador precisa preencher o resumo da conclusão para concluir a atividade."
            checked={cfg.conclusaoObrigatoria} onChange={set("conclusaoObrigatoria")}
          />
          <ToggleSwitch
            label="Permitir cadastrar equipamento em campo"
            dica="Ligado: na OS, o colaborador cadastra o equipamento que falta na unidade. Desligado: só vincula os existentes."
            checked={cfg.cadastrarEquipamento} onChange={set("cadastrarEquipamento")}
          />
          <ToggleSwitch
            label="Avisar o cliente (a caminho / cheguei)"
            dica="Ligado: na OS, o colaborador avisa o cliente por e-mail ao sair e ao chegar. Desligado: os botões somem."
            checked={cfg.avisarCliente} onChange={set("avisarCliente")}
          />
          <ToggleSwitch
            label="Mostrar “O que levar” (materiais previstos)"
            dica="Ligado: o app soma os materiais lançados nas OS do dia, para carregar o veículo. É previsão: não baixa estoque."
            checked={cfg.oQueLevar} onChange={set("oQueLevar")}
          />
          <ToggleSwitch
            label="Lançar despesas pelo app"
            dica="Ligado: o colaborador lança a despesa de campo com a foto do cupom, e o escritório aprova em Financeiro › Despesas de campo. Desligado: o botão some e nada é aceito."
            checked={cfg.lancarDespesas} onChange={set("lancarDespesas")}
          />
        </ToggleGroup>
      </section>

      {/* ========== Atividade esquecida em andamento ========== */}
      <section className="bg-white rounded-card border border-surface-border p-6" data-secao-andamento>
        <div className="flex items-center gap-2 mb-4">
          <Timer className="w-5 h-5 text-frivo-600" />
          <h2 className="text-lg font-semibold text-ink flex items-center gap-1.5">Atividade esquecida em andamento
            <Dica texto="Passado este tempo com a atividade em andamento, o app avisa o técnico e o sino avisa o gestor. O app também avisa no fim do expediente e quando a atividade começou em outro dia. Ao concluir depois disso, o app sugere o horário real de término." rotulo="Atividade esquecida em andamento" lado="direita" />
          </h2>
        </div>
        <label className="flex items-center gap-3 text-sm text-ink">
          <span className="font-medium">Avisar depois de</span>
          <input type="number" min={1} max={24} step={1} inputMode="numeric" value={cfg.alertaAndamentoHoras} data-alerta-horas
            onChange={(e) => setCfg((c) => ({ ...c, alertaAndamentoHoras: Number(e.target.value) }))}
            className="w-20 rounded-lg border border-surface-border px-3 py-2 text-sm tabular-nums" aria-label="Horas em andamento até o aviso" />
          <span>horas em andamento</span>
        </label>
        {!(Number.isInteger(cfg.alertaAndamentoHoras) && cfg.alertaAndamentoHoras >= 1 && cfg.alertaAndamentoHoras <= 24) && (
          <p className="text-xs text-atrasado-texto mt-2" data-alerta-horas-invalido>Use de 1 a 24 horas.</p>
        )}
      </section>

      {/* ========== Localização (dado sensível) ========== */}
      <section className="bg-white rounded-card border border-surface-border p-6" data-secao-localizacao>
        <div className="flex items-center gap-2 mb-4">
          <MapPinned className="w-5 h-5 text-frivo-600" />
          <h2 className="text-lg font-semibold text-ink">Localização</h2>
        </div>
        <ToggleGroup title="Mapa dos técnicos">
          <ToggleSwitch
            label="Rastrear localização dos técnicos"
            dica="Ligado: o app envia a posição do aparelho, com o app aberto, e ela aparece em Operações › Mapa. Desligado: nada é capturado."
            checked={cfg.rastrearLocalizacao} onChange={set("rastrearLocalizacao")}
          />
        </ToggleGroup>
        <p className="text-xs text-ink-muted mt-3" data-aviso-lgpd>
          Localização é dado pessoal (LGPD). Ligue só depois de informar os colaboradores e ter o consentimento deles.
          {cfg.rastrearLocalizacao ? " Com isto ligado, o app mostra ao técnico que a localização está sendo compartilhada." : ""}
        </p>
      </section>

      {/* ========== Dispositivo ========== */}
      <section className="bg-white rounded-card border border-surface-border p-6">
        <div className="flex items-center gap-2 mb-4">
          <MonitorSmartphone className="w-5 h-5 text-frivo-600" />
          <h2 className="text-lg font-semibold text-ink">Dispositivo</h2>
        </div>
        <ToggleGroup title="Acesso por aparelho">
          <ToggleSwitch
            label="Apenas um dispositivo ativo por colaborador"
            dica="Ligado: entrar num novo aparelho desconecta o anterior. O colaborador fica logado em um aparelho de cada vez."
            checked={cfg.umDispositivo} onChange={set("umDispositivo")}
          />
        </ToggleGroup>
      </section>

      <div className="flex justify-end">
        <Button onClick={salvar} loading={salvando} disabled={!(Number.isInteger(cfg.alertaAndamentoHoras) && cfg.alertaAndamentoHoras >= 1 && cfg.alertaAndamentoHoras <= 24)} data-salvar>Salvar preferências</Button>
      </div>
    </div>
  );
}
