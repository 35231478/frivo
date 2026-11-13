"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Smartphone, Check, ShieldCheck, Camera, MapPinned, MonitorSmartphone } from "lucide-react";
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
  const [sucesso, setSucesso] = useState(false);

  const set = (k: keyof ConfigApp) => (v: boolean) => { setCfg((c) => ({ ...c, [k]: v })); setSucesso(false); };

  async function salvar() {
    setErro(""); setSucesso(false); setSalvando(true);
    try {
      const res = await fetch("/api/configuracoes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configAppParaPayload(cfg)),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErro(e.erro ?? "Não foi possível salvar."); return; }
      setSucesso(true);
      router.refresh();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header className="flex items-start gap-3">
        <span className="rounded-card bg-primary-50 text-primary-700 p-2.5"><Smartphone className="w-6 h-6" /></span>
        <div>
          <h1 className="text-xl font-bold text-ink">App do colaborador</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            O que o colaborador vê e pode fazer no app. Vale para a empresa toda; o técnico não vê esta tela.
          </p>
        </div>
      </header>

      {erro && <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3">{erro}</div>}
      {sucesso && (
        <div className="bg-ok-claro border border-ok/20 text-ok-texto text-sm rounded-lg px-4 py-3 flex items-center gap-2" data-sucesso>
          <Check className="w-4 h-4" /> Preferências do app salvas.
        </div>
      )}

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
        </ToggleGroup>
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
        <Button onClick={salvar} loading={salvando} data-salvar>Salvar preferências</Button>
      </div>
    </div>
  );
}
