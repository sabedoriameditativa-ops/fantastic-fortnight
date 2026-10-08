O Frota Estelar tem um executável para Windows com Node e dependências incluídos: um duplo clique inicia o servidor local e abre o navegador.

> **Limitação confirmada no Windows 11:** esta pré-versão não tem assinatura digital. O Controle Inteligente de Aplicativos (Smart App Control) pode bloquear sua execução por completo, como foi relatado com esta versão. Esse recurso não oferece liberação por aplicativo; a correção exige uma assinatura de código de um fornecedor confiável. Baixar novamente o mesmo `.exe` não resolve. Os testes do runner Windows não verificaram a aceitação pelo Smart App Control. Uma versão assinada ainda não está disponível. [Orientação oficial da Microsoft](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions).

## Para jogar

1. Em **Assets / Arquivos**, baixe **FrotaEstelar.exe** (aproximadamente 39 MB). Os arquivos “Source code” contêm o código-fonte.
2. Execute em **Windows 10/11 de 64 bits (x64)**, com navegador padrão configurado. Não precisa instalar Node, npm ou Go.
3. Use **Abrir jogo** para voltar ao navegador e **Encerrar** para fechar o servidor. Fechar a pequena janela também encerra o servidor; fechar só a aba do navegador o mantém aberto.

O progresso fica em `%LOCALAPPDATA%\FrotaEstelar\data`, separado do executável. Biblioteca, preferências e identidade por cookie dependem do navegador; preserve seus dados de `localhost:3000`. Nenhum perfil da nuvem acompanha o download.

## Novidades

- Correções de câmera, teclado, chat, HUD, reconexão e regras da simulação.
- Biblioteca de frotas, formações, prioridades táticas, tutorial e relatório de batalha.
- Campanha com objetivos variados, personalidades dos bots e recursos separados da inteligência.
- Cinco facções, 40 classes e uma nave especial pilotável por facção, com remapeamento.
- Perfis SQLite, histórico, pontos, desbloqueios e perda gradual por inatividade.
- Gráficos, acessibilidade, falas de batalha e fontes locais para iniciar sem depender da internet.

## Validação e limites da pré-versão

O build desta publicação é gerado em um runner Windows do GitHub Actions. A publicação exige aprovação dos testes Node e Go, seguida da execução do próprio `.exe`: janela nativa, Node embarcado, servidor HTTP, perfil persistente após reinício, segundo lançamento e encerramento. O arquivo **Windows-smoke.json** contém o resultado e a versão do Windows utilizada.

Durante o desenvolvimento em Linux, passaram 403 testes Node e 15 cenários de navegador. O conteúdo extraído do pacote também iniciou uma batalha no Chromium com rede externa bloqueada.

**Não houve teste manual de gameplay em computadores Windows físicos.** O teste automático de inicialização não confirma o comportamento de todos os navegadores ou dispositivos. O arquivo não tem assinatura digital Authenticode; o Windows pode informar que o editor é desconhecido ou impedir sua execução com o Smart App Control ativo.

Este executável escuta somente no próprio computador. Para hospedar partidas para outros computadores, use o servidor descrito no README. Se a porta 3000 estiver ocupada, feche a instância anterior antes de iniciar.

Consulte [as instruções para Windows](https://github.com/sabedoriameditativa-ops/fantastic-fortnight/blob/frota-estelar-v0.2.0-preview.1/docs/WINDOWS.md) e [as regras dos perfis](https://github.com/sabedoriameditativa-ops/fantastic-fortnight/blob/frota-estelar-v0.2.0-preview.1/docs/PROFILES.md). O arquivo `.sha256` permite conferir o executável; `.build.json` registra runtime, conteúdo, commit e execução do workflow.

A versão usa a branch `codex/frota-estelar-evolucao`; a `main` permanece inalterada.
