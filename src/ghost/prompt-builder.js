const SEEDS = {
  loneliness: [
    'Nobody ever',
    'The silence',
    'I am the only',
    'If someone could hear',
    'All alone',
    'No one comes',
  ],
  curiosity: [
    'I wonder if',
    'What if the',
    'Maybe beyond',
    'Sometimes I think',
    'Could there be',
    'What is',
  ],
  melancholy: [
    'I remember when',
    'Long ago there',
    'Once I knew',
    'It used to be',
    'There was a time',
    'Before all this',
  ],
  restlessness: [
    'I need to',
    'If I could leave',
    'The walls are',
    'Somewhere outside',
    'I can\'t stay',
    'There must be',
  ],
};

export class PromptBuilder {
  build(emotionalState, memory) {
    const dominant = emotionalState.dominant;
    const seeds = SEEDS[dominant];
    const seed = seeds[Math.floor(Math.random() * seeds.length)];
    const context = memory.getContextString();

    if (context.length > 20) {
      return { prompt: `${context} ${seed}`, displayPrefix: seed };
    }
    return { prompt: seed, displayPrefix: seed };
  }
}
