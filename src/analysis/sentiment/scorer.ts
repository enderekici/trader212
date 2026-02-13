import type { EarningsEvent, FinnhubNews, InsiderTx } from '../../data/finnhub.js';
import type { MarketauxArticle } from '../../data/marketaux.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('sentiment-scorer');

export interface SentimentInput {
  finnhubNews: FinnhubNews[];
  marketauxNews: MarketauxArticle[];
  insiderTransactions: InsiderTx[];
  earnings: EarningsEvent[];
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

  // Insider transaction sentiment
  let insiderNetBuying = 0;
  for (const tx of input.insiderTransactions) {
    // P = Purchase, S = Sale
    if (tx.transactionCode === 'P') {
      insiderNetBuying += tx.change;
    } else if (tx.transactionCode === 'S') {
      insiderNetBuying += tx.change; // change is negative for sales
    }
  }

  let insiderScore = 50;
  if (input.insiderTransactions.length > 0) {
    if (insiderNetBuying > 0) insiderScore = Math.min(50 + insiderNetBuying / 1000, 80);
    else if (insiderNetBuying < 0) insiderScore = Math.max(50 + insiderNetBuying / 1000, 20);
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

  // Combined score: news 70%, insider 30%
  const combinedScore = Math.round(newsScore * 0.7 + insiderScore * 0.3);
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
