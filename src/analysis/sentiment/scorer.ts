import { configManager } from '../../config/manager.js';
import type { EarningsEvent, FinnhubNews, InsiderTx } from '../../data/finnhub.js';
import type { MarketauxArticle } from '../../data/marketaux.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('sentiment-scorer');

export interface SentimentInput {
  finnhubNews: FinnhubNews[];
  marketauxNews: MarketauxArticle[];
  insiderTransactions: InsiderTx[];
  earnings: EarningsEvent[];
  finraShortVolumePct?: number | null; // FINRA short volume % (0-100)
}

export interface ArticleSentiment {
  title: string;
  source: string;
  score: number;
  recencyWeight: number;
}

export interface SentimentAnalysis {
  articles: ArticleSentiment[];
  insiderNetBuying: number;
  daysToEarnings: number | null;
  score: number;
}

// Pre-compiled word-boundary regex patterns to avoid partial matches (e.g. "bull" in "bulletin")
const BULLISH_PATTERNS = [
  'upgrade',
  'beat',
  'exceeds',
  'surge',
  'rally',
  'growth',
  'breakout',
  'outperform',
  'bullish',
  'soar',
  'record high',
  'strong',
  'profit',
  'revenue beat',
  'positive',
  'upside',
  'buy rating',
  'raised',
  'momentum',
  'gains',
  'optimistic',
  'expansion',
].map((kw) => new RegExp(`\\b${kw}\\b`, 'i'));

const BEARISH_PATTERNS = [
  'downgrade',
  'miss',
  'decline',
  'crash',
  'plunge',
  'loss',
  'lawsuit',
  'investigation',
  'bankruptcy',
  'recall',
  'bearish',
  'underperform',
  'weak',
  'negative',
  'warning',
  'cut',
  'sell rating',
  'lowered',
  'concern',
  'risk',
  'pessimistic',
  'contraction',
].map((kw) => new RegExp(`\\b${kw}\\b`, 'i'));

export function scoreSentiment(input: SentimentInput): number {
  const analysis = analyzeSentiment(input);
  return analysis.score;
}

export function analyzeSentiment(input: SentimentInput): SentimentAnalysis {
  const articles: ArticleSentiment[] = [];
  const now = Date.now();

  // Primary: Marketaux news with built-in sentiment scores
  for (const article of input.marketauxNews) {
    const ageMs = now - new Date(article.publishedAt).getTime();
    const recencyWeight = computeRecencyWeight(ageMs);

    articles.push({
      title: article.title,
      source: article.source,
      score: article.sentimentScore ?? 0,
      recencyWeight,
    });
  }

  // Fallback: keyword-based scoring for Finnhub news (only if no Marketaux data)
  if (articles.length === 0) {
    for (const article of input.finnhubNews) {
      const ageMs = now - article.datetime * 1000;
      const recencyWeight = computeRecencyWeight(ageMs);
      const score = keywordScore(`${article.headline} ${article.summary}`);

      articles.push({
        title: article.headline,
        source: article.source,
        score,
        recencyWeight,
      });
    }
  }

  // Compute weighted news sentiment (scaled to 0-100)
  let newsScore = 50;
  if (articles.length > 0) {
    let weightedSum = 0;
    let totalWeight = 0;
    for (const a of articles) {
      weightedSum += a.score * a.recencyWeight;
      totalWeight += a.recencyWeight;
    }
    // Average sentiment is typically -1 to 1, scale to 0-100
    const avgSentiment = totalWeight > 0 ? weightedSum / totalWeight : 0;
    newsScore = Math.max(0, Math.min(100, 50 + avgSentiment * 50));
  }

  // Read insider config
  let roleMultipliers: Record<string, number> = { ceo: 3, cfo: 3, director: 2, vp: 1, other: 1 };
  let clusterWindowDays = 14;
  let clusterMinCount = 3;
  let clusterBonus = 15;
  let insiderDivisor = 500;
  try {
    roleMultipliers = configManager.get<Record<string, number>>('scoring.insider.roleMultipliers');
  } catch {
    /* use defaults */
  }
  try {
    clusterWindowDays = configManager.get<number>('scoring.insider.clusterWindowDays');
  } catch {
    /* use defaults */
  }
  try {
    clusterMinCount = configManager.get<number>('scoring.insider.clusterMinCount');
  } catch {
    /* use defaults */
  }
  try {
    clusterBonus = configManager.get<number>('scoring.insider.clusterBonus');
  } catch {
    /* use defaults */
  }
  try {
    insiderDivisor = configManager.get<number>('scoring.insider.divisor');
  } catch {
    /* use defaults */
  }

  // Insider transaction sentiment with role-based weighting
  let insiderNetBuying = 0;
  for (const tx of input.insiderTransactions) {
    // Determine role multiplier from name
    const name = (tx.name ?? '').toLowerCase();
    let multiplier = roleMultipliers.other ?? 1;
    if (name.includes('ceo') || name.includes('chief executive'))
      multiplier = roleMultipliers.ceo ?? 3;
    else if (name.includes('cfo') || name.includes('chief financial'))
      multiplier = roleMultipliers.cfo ?? 3;
    else if (name.includes('director')) multiplier = roleMultipliers.director ?? 2;
    else if (name.includes('vp') || name.includes('vice president'))
      multiplier = roleMultipliers.vp ?? 1;

    if (tx.transactionCode === 'P') {
      insiderNetBuying += tx.change * multiplier;
    } else if (tx.transactionCode === 'S') {
      insiderNetBuying += tx.change * multiplier; // change is negative for sales
    }
  }

  // Cluster detection: bonus if 3+ buy transactions within N-day window
  let clusterBonusScore = 0;
  const buyTxs = input.insiderTransactions
    .filter((tx) => tx.transactionCode === 'P')
    .map((tx) => new Date(tx.filingDate).getTime())
    .sort((a, b) => a - b);

  for (let i = 0; i <= buyTxs.length - clusterMinCount; i++) {
    const windowEnd = buyTxs[i] + clusterWindowDays * 24 * 60 * 60 * 1000;
    const countInWindow = buyTxs.filter((t) => t >= buyTxs[i] && t <= windowEnd).length;
    if (countInWindow >= clusterMinCount) {
      clusterBonusScore = clusterBonus;
      break;
    }
  }

  let insiderScore = 50;
  if (input.insiderTransactions.length > 0) {
    if (insiderNetBuying > 0)
      insiderScore = Math.min(50 + insiderNetBuying / insiderDivisor + clusterBonusScore, 95);
    else if (insiderNetBuying < 0)
      insiderScore = Math.max(50 + insiderNetBuying / insiderDivisor, 10);
  }

  // Earnings proximity
  let daysToEarnings: number | null = null;
  if (input.earnings.length > 0) {
    const nextEarnings = input.earnings
      .map((e) => new Date(e.date).getTime())
      .filter((t) => t > now)
      .sort((a, b) => a - b)[0];
    if (nextEarnings) {
      daysToEarnings = Math.ceil((nextEarnings - now) / (1000 * 60 * 60 * 24));
    }
  }

  // FINRA short volume scoring
  let finraScore = 50; // neutral default
  const shortPct = input.finraShortVolumePct;
  if (shortPct != null && shortPct > 0) {
    if (shortPct > 50) {
      // Very high short volume — bearish pressure
      finraScore = 35;
    } else if (shortPct > 40 && newsScore > 55) {
      // High short % + bullish news = potential short squeeze
      finraScore = 70;
    } else if (shortPct > 40) {
      // High short % alone is mildly bearish
      finraScore = 40;
    }
  }

  // Combined score: configurable news/insider/finra split
  let newsWeight = 0.7;
  let insiderWeight = 0.3;
  let finraWeight = 0;
  try {
    newsWeight = configManager.get<number>('scoring.sentiment.newsWeight');
  } catch {
    /* use defaults */
  }
  try {
    insiderWeight = configManager.get<number>('scoring.sentiment.insiderWeight');
  } catch {
    /* use defaults */
  }
  try {
    finraWeight = configManager.get<number>('scoring.sentiment.finraWeight');
  } catch {
    /* use defaults */
  }

  // If FINRA data is present and has a weight, rebalance the weights
  let combinedScore: number;
  if (shortPct != null && finraWeight > 0) {
    const total = newsWeight + insiderWeight + finraWeight;
    combinedScore = Math.round(
      (newsScore * newsWeight + insiderScore * insiderWeight + finraScore * finraWeight) / total,
    );
  } else {
    combinedScore = Math.round(newsScore * newsWeight + insiderScore * insiderWeight);
  }
  const score = Math.max(0, Math.min(100, combinedScore));

  log.debug(
    { score, newsScore, insiderScore, articles: articles.length, insiderNetBuying, daysToEarnings },
    'Sentiment analysis complete',
  );

  return { articles, insiderNetBuying, daysToEarnings, score };
}

function computeRecencyWeight(ageMs: number): number {
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Exponential decay: recent articles matter more
  // 0 days = 1.0, 7 days = 0.5, 14 days = 0.25, 30 days = 0.1
  return Math.max(0.05, Math.exp(-0.1 * ageDays));
}

function keywordScore(text: string): number {
  let bullish = 0;
  let bearish = 0;

  for (const pattern of BULLISH_PATTERNS) {
    if (pattern.test(text)) bullish++;
  }
  for (const pattern of BEARISH_PATTERNS) {
    if (pattern.test(text)) bearish++;
  }

  const total = bullish + bearish;
  if (total === 0) return 0;

  // Return -1 to 1 scale to match Marketaux format
  return (bullish - bearish) / total;
}
