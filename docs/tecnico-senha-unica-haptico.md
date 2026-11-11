# App do técnico — troca de senha em um lugar só e vibração leve na barra inferior

🟢 **Sem mudança de banco. A autenticação não foi alterada.**

## 1. "Trocar senha" em um lugar só

**Antes:** a troca de senha aparecia duas vezes no Perfil — um card "Trocar senha" solto **e** dentro
de Meus dados › Segurança. As duas chamavam a mesma rota (`/api/perfil/senha`).

**Agora:** fica **só em Perfil › Meus dados › Segurança**. O card solto saiu
(`components/tecnico/trocar-senha.tsx` foi apagado). O Perfil fica com: Sincronização · Checklist do
veículo · Meus dados · Sair.

Meus dados **já tinha** a troca de senha (não precisou mover nada). Para nenhuma função sumir, conferi
o que o card fazia e o que o caminho que ficou faz:

| O que o card fazia | Em Meus dados › Segurança |
|---|---|
| Senha atual + nova + confirmação, campos de senha | Igual |
| Requisitos da senha ao vivo | Igual |
| Valida antes de enviar (fraca, confirmação diferente) | Igual |
| Recusa "nova igual à atual" antes de enviar | **Acrescentei** (o servidor já recusava; agora a tela avisa antes) |
| Mostra o motivo quando o servidor recusa | Igual |
| Só a própria senha, guardada como hash | Igual (é a mesma rota) |
| Sem sinal: explicava e desabilitava o botão | **Diferente:** tenta, mostra "Erro de conexão." e mantém o que foi digitado |
| Alvos de toque de 44 px | **Ajustei:** no app, abas, campos e botões de Meus dados passam a ter 44 px (eram 40, 42 e 28/40) |

- O ajuste de 44 px vale **só dentro do app** (`data-meus-dados-app`). A tela "Meu perfil" do painel
  não muda de tamanho.
- A validação "nova igual à atual" entrou no componente compartilhado, então o painel também passa a
  avisar antes de enviar. A regra é a mesma que o servidor já aplicava.

## 2. Vibração leve (haptic) na barra inferior

Tocar em **Meu dia**, **Agenda** ou **Perfil** dá um pulso de **10 ms** (`navigator.vibrate(10)`).

- **Android** (Chrome e PWA instalado): vibra.
- **iPhone:** não vibra. Todos os navegadores do iOS usam o motor do Safari (WebKit), que não tem
  vibração pela web. Lá é um **no-op silencioso**: sem erro, sem aviso, a barra funciona igual.
- **Onde o navegador bloqueia ou falha:** também silêncio (a chamada fica dentro de `try/catch`).
- Só a barra inferior vibra. Abrir o app não vibra; o atalho da foto no topo também não.

### Pronto para o haptic nativo (Capacitor)

`lib/haptico.ts` tem uma função só, `toqueLeve()`, que escolhe o caminho nesta ordem:

1. **Haptic nativo registrado** — `registrarHapticoNativo(fn)`. É o encaixe para o app de loja:
   ```ts
   import { Haptics, ImpactStyle } from "@capacitor/haptics";
   registrarHapticoNativo(() => Haptics.impact({ style: ImpactStyle.Light }));
   ```
2. **Plugin de Haptics do Capacitor detectado** (`window.Capacitor.Plugins.Haptics`, só em plataforma
   nativa): impacto leve, sem registrar nada.
3. **`navigator.vibrate`** — o que roda hoje.

Os caminhos 1 e 2 estão testados com dublês, **não em aparelho**: o app ainda não é empacotado e
nenhuma dependência do Capacitor foi adicionada. Quando empacotar, basta o passo 1 (ou instalar o
plugin) — a barra não precisa mudar.

## Arquivos

- `components/tecnico/perfil.tsx` (card removido; 44 px em Meus dados no app)
- `components/tecnico/trocar-senha.tsx` (**apagado**)
- `components/perfil/perfil-client.tsx` (aviso "nova igual à atual" antes de enviar)
- `lib/haptico.ts` (novo) · `components/tecnico/app-tecnico.tsx` (pulso na barra inferior)

## Testes

- `tecnico-trocar-senha` (12): a rota real com papel TECNICO (3, sem mudança) e a tela pelo caminho
  único — o card não existe mais, campos de senha, requisitos ao vivo, 44 px, validação antes de
  enviar, corpo enviado, botão de cima = botão de baixo, recusa do servidor, sem sinal, fluxo tela →
  rota real. **Os testes de tela foram reescritos de propósito:** antes exercitavam o card removido.
- `tecnico-haptico` (13): pulso de 10 ms, sem suporte, vibração que lança erro, sem `navigator`,
  nativo registrado, plugin do Capacitor, falha do lado nativo, e a barra inferior de verdade (um
  pulso por toque nos três botões, navegação intacta sem suporte).
- `tecnico-avatar-perfil`: a lista de seções do Perfil perdeu "Trocar senha" — **mudança intencional**.

## Medido no navegador (Chromium, app real)

- Alvos em Meus dados no app: abas 44 px, campos 44 px, "Trocar senha" 44 px (os dois botões).
- Barra inferior: 62 px de altura por botão.
- Três toques na barra → `navigator.vibrate` chamado com `[10, 10, 10]`.
- **Não testei em WebKit de verdade** (não está instalado neste ambiente): o comportamento do iPhone
  está coberto pelo teste que roda sem `navigator.vibrate`.

## Prints

`docs/prints/tecnico-senha-unica-haptico/` (desktop e celular): o Perfil sem o card, Meus dados ›
Segurança e a barra inferior. A vibração não aparece em imagem.
