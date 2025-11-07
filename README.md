# Mapa de Horários Acadêmicos

Aplicação front-end simples para construir cronogramas semanais de cursos.

## Como usar

1. Acesse `http://localhost:3000` (após iniciar o servidor) em um navegador moderno (Chrome, Edge, Firefox).
2. Utilize o menu de ícones para abrir o painel de cadastros de períodos, professores, salas, disciplinas ou configurações. Cada painel permite adicionar, buscar, editar e remover itens conforme necessário.
3. Ao cadastrar disciplinas é possível informar um código opcional, que é validado para evitar duplicidade. Cada disciplina recebe automaticamente uma cor que é reaproveitada nas células do cronograma para facilitar a identificação visual.
4. No cadastro de professores você pode, opcionalmente, vincular um docente a várias disciplinas utilizando o seletor com os botões **+** e **−**, além de marcar se ele pertence à área específica do curso. Essas informações alimentam as sugestões exibidas no modal de atribuição, mas continuam totalmente opcionais para manter flexibilidade.
5. Selecione a visão desejada (por período, professor ou sala) e escolha o item para visualizar.
6. Clique em um bloco do cronograma para atribuir/editar uma disciplina. Ative a seleção múltipla para marcar vários horários ao mesmo tempo e aplicar a mesma configuração para todos, inclusive substituindo lançamentos existentes quando desejar. As células preenchidas exibem a disciplina com sua cor dedicada e os dias da semana permanecem fixos no topo para facilitar a navegação. Use os botões **Editar seleção** e **Limpar** para confirmar ou desfazer a seleção em lote.
7. O painel de edição sugere professores e salas livres naquele horário, indicando com destaque os docentes vinculados à disciplina escolhida e sinalizando quando o professor pertence à área do curso; conflitos continuam sendo validados ao salvar seleções múltiplas.
8. Utilize a seção **Configurações** para nomear o planejamento atual e clicar em **Salvar configuração**. A lista abaixo é carregada do servidor e permite abrir, exportar ou remover cronogramas diretamente pelo painel (use **Atualizar lista** sempre que quiser sincronizar o conteúdo com outras pessoas ou abas).
9. Ainda nas configurações, mantenha um rascunho rápido no navegador com os botões de salvar/recarregar, exporte um JSON da versão atual ou importe arquivos salvos anteriormente — o conteúdo importado é carregado imediatamente, gravado no servidor com o nome informado (ou com o carimbo de data e hora da importação) e também mantém o rascunho local atualizado.

O cronograma em edição continua sendo preservado automaticamente no armazenamento local do navegador para facilitar rascunhos rápidos. As configurações nomeadas, porém, passam a ser guardadas no servidor e ficam disponíveis para qualquer pessoa que acesse a mesma instância da aplicação.

## Executando o servidor

1. Com o Node.js instalado, execute `npm start` na pasta do projeto. O servidor integrado não possui dependências externas e inicializa diretamente com `node server.js`.
2. A interface web e os endpoints REST ficam disponíveis em `http://localhost:3000`.
3. Os cronogramas nomeados são gravados no arquivo `data/configurations.json` (criado automaticamente caso não exista). É possível fazer backup manual deste arquivo ou versioná-lo de acordo com a sua necessidade.

### Persistência de dados

A aplicação combina dois mecanismos de armazenamento:

* **Rascunho local** – o estado atual permanece no `localStorage` do navegador, permitindo continuar de onde parou mesmo sem salvar no servidor.
* **Biblioteca no servidor** – cada configuração nomeada é enviada para a API e fica disponível na lista de configurações, podendo ser carregada, sobrescrita, exportada ou removida pela interface.
