'use strict';

/* =========================================================
 * CONTEÚDO DO APP: edite este arquivo para mudar os textos.
 *
 * Meditações guiadas
 *   id       identificador único (sem espaços nem acentos)
 *   premium  true = só para assinantes
 *   minutes  duração total
 *   ambient  som de fundo: chuva, oceano, vento, riacho, tigela, marrom ou none
 *   audio    (opcional) arquivo gravado com a sua voz, ex.: 'audio/respiracao.mp3'.
 *            Com áudio, a narração por voz sintética é desligada e o texto
 *            continua aparecendo na tela nos tempos indicados em steps.
 *   steps    [segundo em que aparece, texto]
 * ========================================================= */
const GUIDED = [
  {
    id: 'respiracao',
    emoji: '🌿',
    title: 'Respiração consciente',
    minutes: 5,
    ambient: 'riacho',
    steps: [
      [0, 'Sente-se confortavelmente e feche os olhos com suavidade.'],
      [15, 'Leve a atenção para a respiração. Não tente mudá-la, apenas observe.'],
      [45, 'Perceba o ar entrando pelas narinas... e saindo.'],
      [90, 'Se a mente se distrair, tudo bem. Gentilmente, volte para a respiração.'],
      [150, 'Sinta o abdômen subir na inspiração e descer na expiração.'],
      [210, 'Cada respiração é um novo começo. Permaneça aqui, presente.'],
      [270, 'Comece a perceber os sons ao redor e o corpo apoiado.'],
      [290, 'Quando estiver pronto, abra os olhos devagar.'],
    ],
  },
  {
    id: 'corpo',
    premium: true,
    emoji: '🌊',
    title: 'Escaneamento corporal',
    minutes: 10,
    ambient: 'oceano',
    steps: [
      [0, 'Deite-se ou sente-se de forma confortável. Feche os olhos.'],
      [20, 'Respire fundo três vezes, soltando o ar devagar.'],
      [50, 'Leve a atenção aos pés. Note qualquer sensação: calor, frio, formigamento.'],
      [110, 'Suba para as pernas e joelhos. Deixe que relaxem.'],
      [170, 'Agora o quadril e a região lombar. Solte qualquer tensão.'],
      [230, 'Perceba o abdômen e o peito se movendo com a respiração.'],
      [290, 'Leve a atenção para as mãos, os braços e os ombros. Deixe os ombros caírem.'],
      [360, 'Relaxe o pescoço, a mandíbula, a testa e os olhos.'],
      [430, 'Sinta o corpo inteiro, como um todo, respirando.'],
      [520, 'Descanse nessa sensação de calma.'],
      [575, 'Mexa suavemente os dedos e, quando quiser, abra os olhos.'],
    ],
  },
  {
    id: 'gratidao',
    emoji: '🌻',
    title: 'Gratidão',
    minutes: 5,
    ambient: 'tigela',
    steps: [
      [0, 'Feche os olhos e faça uma respiração profunda.'],
      [20, 'Pense em algo simples pelo qual você é grato hoje.'],
      [70, 'Sinta essa gratidão no peito, como um calor suave.'],
      [120, 'Agora pense em uma pessoa que faz bem para você.'],
      [170, 'Envie mentalmente um agradecimento a ela.'],
      [220, 'Agradeça também a si mesmo, por reservar este momento.'],
      [280, 'Respire fundo e abra os olhos, levando essa sensação para o seu dia.'],
    ],
  },
  {
    id: 'ansiedade',
    premium: true,
    emoji: '🍃',
    title: 'Alívio da ansiedade',
    minutes: 7,
    ambient: 'chuva',
    steps: [
      [0, 'Encontre uma posição confortável. Você está seguro aqui.'],
      [15, 'Inspire contando até quatro... e expire contando até seis.'],
      [60, 'Continue nesse ritmo. Expirar mais longo acalma o corpo.'],
      [110, 'Perceba cinco coisas que você sente: os pés no chão, as mãos, a roupa na pele...'],
      [180, 'Os pensamentos são como nuvens. Deixe-os passar, sem se prender.'],
      [250, 'Diga a si mesmo, em silêncio: “Eu estou aqui. Eu estou bem.”'],
      [320, 'Continue respirando devagar, sentindo o corpo mais leve.'],
      [400, 'Quando estiver pronto, volte devagar e abra os olhos.'],
    ],
  },
  {
    id: 'dormir',
    premium: true,
    emoji: '🌙',
    title: 'Para dormir',
    minutes: 10,
    ambient: 'marrom',
    steps: [
      [0, 'Deite-se e deixe o corpo pesar sobre a cama.'],
      [20, 'Solte o ar devagar, como um longo suspiro.'],
      [60, 'Imagine cada parte do corpo ficando pesada e quente.'],
      [140, 'Os pés... as pernas... o quadril... tudo afundando no colchão.'],
      [220, 'Os braços pesados... os ombros soltos... o rosto relaxado.'],
      [320, 'Não há nada para fazer agora. Só descansar.'],
      [420, 'Deixe a respiração ficar lenta e natural.'],
      [500, 'Você pode adormecer quando quiser...'],
    ],
  },
  {
    id: 'foco',
    emoji: '🎯',
    title: 'Foco e clareza',
    minutes: 3,
    ambient: 'none',
    steps: [
      [0, 'Sente-se com a coluna ereta e os olhos fechados.'],
      [10, 'Faça três respirações profundas.'],
      [40, 'Escolha um ponto de atenção: a sensação do ar nas narinas.'],
      [90, 'Cada vez que a mente sair, volte. Isso é treinar o foco.'],
      [150, 'Defina uma intenção clara para a próxima hora.'],
      [170, 'Abra os olhos, pronto para começar.'],
    ],
  },
  {
    id: 'pausa',
    emoji: '⏸️',
    title: 'Pausa de 2 minutos',
    minutes: 2,
    ambient: 'none',
    steps: [
      [0, 'Pare o que estiver fazendo. Solte os ombros.'],
      [10, 'Inspire pelo nariz... e solte o ar devagar pela boca.'],
      [30, 'Observe como você está agora, sem julgar.'],
      [60, 'Sinta os pés no chão e o peso do corpo na cadeira.'],
      [90, 'Mais uma respiração profunda.'],
      [110, 'Volte às suas atividades com calma.'],
    ],
  },
  {
    id: 'manha',
    premium: true,
    emoji: '🌅',
    title: 'Manhã com intenção',
    minutes: 5,
    ambient: 'riacho',
    steps: [
      [0, 'Bom dia. Sente-se e feche os olhos por alguns minutos.'],
      [15, 'Respire fundo e sinta o corpo despertando.'],
      [50, 'Perceba como você acordou hoje: cansado, animado, tranquilo. Tudo bem.'],
      [100, 'Pergunte a si mesmo: como eu quero me sentir hoje?'],
      [150, 'Escolha uma palavra para guiar o seu dia. Repita-a em silêncio.'],
      [220, 'Imagine-se vivendo o dia com essa intenção.'],
      [280, 'Respire fundo, abra os olhos e comece o seu dia.'],
    ],
  },
  {
    id: 'estresse',
    premium: true,
    emoji: '🪨',
    title: 'Soltar o estresse',
    minutes: 8,
    ambient: 'chuva',
    steps: [
      [0, 'Sente-se confortavelmente. Você merece esta pausa.'],
      [15, 'Feche as mãos com força por cinco segundos... e solte.'],
      [40, 'Agora suba os ombros até as orelhas... segure... e solte.'],
      [70, 'Contraia o rosto inteiro... e relaxe.'],
      [100, 'Perceba a diferença entre tensão e relaxamento.'],
      [150, 'A cada expiração, imagine o estresse saindo do corpo como uma fumaça escura.'],
      [230, 'A cada inspiração, imagine uma luz clara e calma entrando.'],
      [320, 'Onde ainda existe tensão? Respire para esse lugar.'],
      [400, 'Fique alguns instantes nessa sensação de leveza.'],
      [460, 'Quando estiver pronto, abra os olhos.'],
    ],
  },
  {
    id: 'autocompaixao',
    premium: true,
    emoji: '💗',
    title: 'Autocompaixão',
    minutes: 8,
    ambient: 'tigela',
    steps: [
      [0, 'Feche os olhos e coloque uma mão sobre o coração.'],
      [20, 'Sinta o calor da sua mão e o coração batendo.'],
      [60, 'Lembre-se de algo que tem sido difícil para você ultimamente.'],
      [110, 'Reconheça: este é um momento de sofrimento. Isso faz parte da vida.'],
      [170, 'Todas as pessoas passam por dificuldades. Você não está sozinho.'],
      [230, 'Diga a si mesmo, com carinho: que eu possa ser gentil comigo.'],
      [300, 'Fale consigo como falaria com um grande amigo.'],
      [380, 'Que eu possa me aceitar como sou.'],
      [450, 'Respire fundo e, quando quiser, abra os olhos.'],
    ],
  },
  {
    id: 'metta',
    premium: true,
    emoji: '🤲',
    title: 'Amor e bondade',
    minutes: 10,
    ambient: 'tigela',
    steps: [
      [0, 'Sente-se confortavelmente e feche os olhos.'],
      [20, 'Comece desejando a si mesmo: que eu seja feliz, que eu esteja em paz.'],
      [100, 'Agora pense em alguém que você ama. Deseje: que você seja feliz, que você esteja em paz.'],
      [200, 'Pense em alguém neutro, como um vizinho ou alguém que você vê na rua. Deseje o mesmo.'],
      [300, 'Agora pense em alguém com quem você tem dificuldade. Se puder, deseje: que você esteja em paz.'],
      [400, 'Por fim, expanda para todos os seres: que todos sejam felizes, que todos estejam em paz.'],
      [520, 'Sinta essa bondade irradiando do seu peito.'],
      [575, 'Abra os olhos devagar.'],
    ],
  },
  {
    id: 'raiva',
    premium: true,
    emoji: '🔥',
    title: 'Acalmar a raiva',
    minutes: 6,
    ambient: 'oceano',
    steps: [
      [0, 'Você está sentindo raiva, e tudo bem. Vamos acolher essa emoção.'],
      [15, 'Respire fundo pelo nariz e solte o ar lentamente pela boca.'],
      [50, 'Onde você sente a raiva no corpo? No peito, no rosto, nas mãos?'],
      [100, 'Apenas observe essa sensação, sem agir sobre ela.'],
      [150, 'Imagine que a raiva é uma onda. Ela sobe, atinge o pico e depois desce.'],
      [220, 'A cada expiração, a onda fica um pouco menor.'],
      [290, 'Agora pergunte: do que eu preciso neste momento?'],
      [340, 'Respire fundo e abra os olhos, com mais clareza.'],
    ],
  },
];

/* =========================================================
 * Jornada: um programa de vários dias.
 * O primeiro dia é grátis; os demais são premium.
 * Cada dia usa uma das meditações acima (campo meditation).
 * ========================================================= */
const PROGRAM = {
  id: 'jornada7',
  title: 'Comece a meditar em 7 dias',
  days: [
    { meditation: 'respiracao', title: 'O poder da respiração', intro: 'Hoje você vai aprender a base de toda meditação: observar a respiração. Não existe jeito certo de respirar, apenas observe.' },
    { meditation: 'foco', title: 'Treinando a atenção', intro: 'A mente vai se distrair, e isso é normal. Meditar é perceber a distração e voltar. Cada volta fortalece o seu foco.' },
    { meditation: 'corpo', title: 'Habitando o corpo', intro: 'Muitas emoções aparecem primeiro no corpo. Hoje você vai percorrer o corpo com atenção, de forma gentil.' },
    { meditation: 'ansiedade', title: 'Acalmando a mente', intro: 'Expirar mais devagar do que inspira avisa o corpo que ele está seguro. Hoje você vai usar isso a seu favor.' },
    { meditation: 'gratidao', title: 'Cultivando a gratidão', intro: 'A gratidão treina o cérebro a perceber o que vai bem. É um dos hábitos mais estudados para o bem-estar.' },
    { meditation: 'autocompaixao', title: 'Sendo gentil consigo', intro: 'Muitas vezes somos mais duros com nós mesmos do que com qualquer outra pessoa. Hoje é dia de mudar isso.' },
    { meditation: 'metta', title: 'Expandindo a bondade', intro: 'Parabéns por chegar ao último dia! Hoje você vai estender a bondade para você, para quem ama e para o mundo.' },
  ],
};
