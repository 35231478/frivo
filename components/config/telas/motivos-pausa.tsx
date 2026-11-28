"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { TelaCadastroApoio } from "@/components/config/tela-cadastro-apoio";

/** D1 — Motivos de pausa da atividade no app do técnico (cadastro padronizado: lib/cadastros/registro.ts). */
export function TelaMotivosPausa() {
  return (
    <TelaCadastroApoio titulo="Motivos de pausa" descricao="O que o técnico escolhe ao pausar uma atividade no app">
      <CadastroPadrao
        entidade="motivos-pausa"
        ajuda="Impedimento avisa o escritório (sino e push) e permite encerrar a visita como “Não concluída — precisa voltar”. Intervalo (almoço) só para o relógio: o tempo pausado não conta como execução. Inativar tira o motivo do app; as pausas já feitas não mudam."
      />
    </TelaCadastroApoio>
  );
}
