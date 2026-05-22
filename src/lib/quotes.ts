export interface MotivationQuote {
  id: string;
  text: string;
  category: 'ENGINEER' | 'REALITY' | 'LEGACY';
  audience: 'PERSONAL' | 'GENERAL';
}

export const FINSTRIDE_QUOTES: MotivationQuote[] = [
  // --- YASH'S PERSONAL QUOTES (Protected) ---
  {
    id: 'q1',
    text: 'Ego wants the 9:15 AM roulette. Discipline wants the 30 LPA architecture. Build the architecture.',
    category: 'ENGINEER',
    audience: 'PERSONAL'
  },
  {
    id: 'q2',
    text: 'Remember the Chemistry theory. You mastered the boring parts in 15 days when you dropped the ego. Drop it again here.',
    category: 'ENGINEER',
    audience: 'PERSONAL'
  },
  {
    id: 'q3',
    text: 'A ₹6.5 Lakh tuition fee is only fully wasted if you open the casino tab again.',
    category: 'REALITY',
    audience: 'PERSONAL'
  },
  {
    id: 'q4',
    text: 'The TVS iQube parked downstairs is real wealth. The code running FinStride is real leverage. The F&O terminal is an illusion designed to eat your salary.',
    category: 'LEGACY',
    audience: 'PERSONAL'
  },
  {
    id: 'q5',
    text: 'If a piece of code fails validation, you do not push it to production. Treat your hard-earned capital with the exact same strict engineering logic.',
    category: 'ENGINEER',
    audience: 'PERSONAL'
  },
  {
    id: 'q6',
    text: 'When the market spikes and panic sets in, close the terminal, go downstairs, look at your father, and drink a glass of water. Real life is outside the screen.',
    category: 'LEGACY',
    audience: 'PERSONAL'
  },
  {
    id: 'q7',
    text: 'Stop trying to predict global geopolitical headlines. You write backend systems; optimize what you completely control.',
    category: 'ENGINEER',
    audience: 'PERSONAL'
  },
  {
    id: 'q8',
    text: 'You are not a loser for relapsing. You are a builder who survived the wound. Keep the slate clean.',
    category: 'REALITY',
    audience: 'PERSONAL'
  },

  // --- GENERAL SYSTEM QUOTES (For everyone) ---
  {
    id: 'g1',
    text: 'Small, consistent daily deposits of effort compound significantly faster than sudden windfalls.',
    category: 'REALITY',
    audience: 'GENERAL'
  },
  {
    id: 'g2',
    text: 'A budget is not a restriction. It is an architectural blueprint for where you want your life to go.',
    category: 'ENGINEER',
    audience: 'GENERAL'
  },
  {
    id: 'g3',
    text: 'Focus entirely on the systems you build, not the chaotic outcomes you cannot control.',
    category: 'ENGINEER',
    audience: 'GENERAL'
  },
  {
    id: 'g4',
    text: 'Peace of mind is the highest ROI asset you will ever own. Protect it ruthlessly.',
    category: 'LEGACY',
    audience: 'GENERAL'
  },
  {
    id: 'g5',
    text: 'Financial independence is just software engineering applied to your bank account: optimize inflows, eliminate memory leaks.',
    category: 'ENGINEER',
    audience: 'GENERAL'
  }
];