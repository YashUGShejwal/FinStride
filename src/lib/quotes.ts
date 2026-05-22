export interface MotivationQuote {
    id: string;
    text: string;
    category: 'ENGINEER' | 'REALITY' | 'LEGACY';
  }
  
  export const FINSTRIDE_QUOTES: MotivationQuote[] = [
    {
      id: 'q1',
      text: 'Ego wants the 9:15 AM roulette. Discipline wants the 30 LPA architecture. Build the architecture.',
      category: 'ENGINEER'
    },
    {
      id: 'q2',
      text: 'Remember the Chemistry theory. You mastered the boring parts in 15 days when you dropped the ego. Drop it again here.',
      category: 'ENGINEER'
    },
    {
      id: 'q3',
      text: 'A ₹6.5 Lakh tuition fee is only fully wasted if you open the casino tab again.',
      category: 'REALITY'
    },
    {
      id: 'q4',
      text: 'The TVS iQube parked downstairs is real wealth. The code running FinStride is real leverage. The F&O terminal is an illusion designed to eat your salary.',
      category: 'LEGACY'
    },
    {
      id: 'q5',
      text: 'If a piece of code fails validation, you do not push it to production. Treat your hard-earned capital with the exact same strict engineering logic.',
      category: 'ENGINEER'
    },
    {
      id: 'q6',
      text: 'When the market spikes and panic sets in, close the terminal, go downstairs, look at your father, and drink a glass of water. Real life is outside the screen.',
      category: 'LEGACY'
    },
    {
      id: 'q7',
      text: 'Stop trying to predict global geopolitical headlines. You write backend systems; optimize what you completely control.',
      category: 'ENGINEER'
    },
    {
      id: 'q8',
      text: 'You are not a loser for relapsing. You are a builder who survived the wound. Keep the slate clean.',
      category: 'REALITY'
    }
  ];