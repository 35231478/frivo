# App do técnico — foto no cabeçalho e Perfil enxuto

**Sem mudança de banco.** A foto já existe (`usuarios.avatar`, a de "Meus dados › Foto de perfil", e
`tecnicos.avatar`, a do cadastro do colaborador); a preferência do app de rota continua guardada no
aparelho.

## 1. Foto do técnico no cabeçalho

### O que já existia
- O topo do app só tinha a marca e o indicador de sincronização; o cabeçalho do Perfil mostrava um
  ícone genérico (o "avatar vazio"), mesmo com foto cadastrada.
- A foto de perfil só aparecia dentro de "Meus dados".

### O que mudou
- **Topo do app:** à direita, ao lado do indicador de sincronização, aparece a **foto de perfil** de
  quem está logado. Toca e abre o Perfil (alvo de 44 px).
- **Cabeçalho do Perfil:** a mesma foto, no lugar do ícone genérico.
- **Sem foto:** as **iniciais** (primeiro e último nome), no padrão de avatar do sistema.
- **De onde vem a foto:** a de "Meus dados › Foto de perfil"; se o técnico ainda não escolheu a dele,
  a foto do cadastro do colaborador (posta pelo escritório).
- **Trocar a foto em "Meus dados" atualiza o topo na hora**, sem recarregar.
- Funciona sem sinal: a foto vem junto com a página que o aparelho guarda.

## 2. Perfil limpo — "App de rota" sai da frente

### O que já existia
- O Perfil tinha um card "App de rota" (Perguntar / Google Maps / Waze) entre a Sincronização e o resto.

### O que mudou
- O card saiu. A escolha fica **dentro de "Meus dados"**, numa área discreta chamada **Preferências**:
  "App que abre em “Rota no mapa”, neste aparelho." — as mesmas três opções.
- O Perfil fica com: **Sincronização · Checklist do veículo · Trocar senha · Meus dados · Sair**.
- O **botão de rota de cada OS continua igual**: na primeira vez pergunta o app e lembra a escolha.
  Só o texto do aviso mudou, para dizer onde trocar agora: "Troque em Perfil › Meus dados."

### Mantive
- **"Checklist do veículo"** continua no Perfil. Ele não estava na sua lista, mas é uma ação do dia
  a dia e o Perfil é o único caminho até ele no app — não tirei. Se quiser levá-lo para outro lugar
  (ex.: "Meu dia"), é um ajuste pequeno.

## Testes
`tecnico-avatar-perfil` (14): foto e iniciais no topo e no Perfil, toque de 44 px, troca de foto na
hora, de onde vem a foto (usuário → cadastro do colaborador → iniciais), o Perfil sem o card, a
preferência dentro de "Meus dados" e o botão de rota das OS igual a antes.

## Prints
`docs/prints/tecnico-avatar-perfil/` — desktop e celular.
