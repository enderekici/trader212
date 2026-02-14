import { configManager } from '../config/manager.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('social-sentiment');

export interface SocialMention {
  source: 'reddit' | 'twitter' | 'stocktwits';
  text: string;
  timestamp: string;
  score?: number;
  engagement?: number;
}

export interface SocialSentimentResult {
  symbol: string;
  overallScore: number; // -1 to 1
  mentionCount: number;
  buzzScore: number; // 0-100, relative mention volume
  sentimentBreakdown: {
    positive: number;
    negative: number;
    neutral: number;
  };
  sources: Record<string, { count: number; avgScore: number }>;
  trendDirection: 'rising' | 'falling' | 'stable';
  keywords: string[];
  fetchedAt: string;
}

const POSITIVE_KEYWORDS = [
  'bullish',
  'buy',
  'moon',
  'breakout',
  'upgrade',
  'beat',
  'growth',
  'strong',
  'rally',
  'calls',
];

const NEGATIVE_KEYWORDS = [
  'bearish',
  'sell',
  'crash',
  'downgrade',
  'miss',
  'weak',
  'dump',
  'puts',
  'short',
  'fraud',
];

const FINANCE_KEYWORDS = [
  'earnings',
  'revenue',
  'profit',
  'ipo',
  'merger',
  'acquisition',
  'dividend',
  'guidance',
  'analyst',
  'rating',
  'target',
  'price',
  'stock',
  'market',
  'sector',
  'industry',
];

const SPAM_PATTERNS = [
  /^\s*$/,
  /^.{1,5}$/,
  /[A-Z]{10,}/,
  /(\w)\1{4,}/,
  /🚀.*🚀.*🚀/,
  /(buy now|click here|free money|guaranteed)/i,
];

export class SocialSentimentAnalyzer {
  /**
   * Analyze text sentiment using keyword matching
   * Returns score from -1 (very negative) to 1 (very positive)
   */
  analyzeSentiment(text: string): number {
    if (!text || text.trim().length === 0) {
      return 0;
    }

    const lowerText = text.toLowerCase();
    let score = 0;

    // Count positive keywords
    for (const keyword of POSITIVE_KEYWORDS) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = lowerText.match(regex);
      if (matches) {
        score += matches.length * 0.1;
      }
    }

    // Count negative keywords
    for (const keyword of NEGATIVE_KEYWORDS) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = lowerText.match(regex);
      if (matches) {
        score -= matches.length * 0.1;
      }
    }

    // Clamp to -1 to 1 range
    return Math.max(-1, Math.min(1, score));
  }

  /**
   * Filter out spam and low-quality mentions
   */
  filterSpam(mentions: SocialMention[]): SocialMention[] {
    return mentions.filter((mention) => {
      // Check against spam patterns
      for (const pattern of SPAM_PATTERNS) {
        if (pattern.test(mention.text)) {
          logger.debug({ text: mention.text }, 'Filtered spam mention');
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Calculate buzz score based on mention count relative to average
   * Returns 0-100 scale
   */
  calculateBuzzScore(mentionCount: number, avgMentionCount: number): number {
    if (avgMentionCount === 0) {
      return mentionCount > 0 ? 100 : 0;
    }

    const ratio = mentionCount / avgMentionCount;
    // Use logarithmic scale for better distribution
    const rawScore = Math.log10(ratio + 1) * 50;

    // Clamp to 0-100
    return Math.max(0, Math.min(100, rawScore));
  }

  /**
   * Detect sentiment trend using linear regression slope
   */
  detectTrend(recentScores: number[]): 'rising' | 'falling' | 'stable' {
    if (recentScores.length < 2) {
      return 'stable';
    }

    // Calculate linear regression slope
    const n = recentScores.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += recentScores[i];
      sumXY += i * recentScores[i];
      sumXX += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    // Classify based on slope threshold
    const threshold = 0.05;
    if (slope > threshold) {
      return 'rising';
    }
    if (slope < -threshold) {
      return 'falling';
    }
    return 'stable';
  }

  /**
   * Extract most frequent finance-related keywords from texts
   */
  extractKeywords(texts: string[]): string[] {
    const wordCount: Record<string, number> = {};

    for (const text of texts) {
      const lowerText = text.toLowerCase();
      for (const keyword of FINANCE_KEYWORDS) {
        const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
        const matches = lowerText.match(regex);
        if (matches) {
          wordCount[keyword] = (wordCount[keyword] || 0) + matches.length;
        }
      }
    }

    // Sort by frequency and return top 10
    return Object.entries(wordCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([word]) => word);
  }

  /**
   * Aggregate mentions for a symbol into SocialSentimentResult
   */
  analyzeSymbol(
    symbol: string,
    mentions: SocialMention[],
    avgMentionCount = 10,
  ): SocialSentimentResult {
    // Filter spam first
    const validMentions = this.filterSpam(mentions);

    if (validMentions.length === 0) {
      return {
        symbol,
        overallScore: 0,
        mentionCount: 0,
        buzzScore: 0,
        sentimentBreakdown: { positive: 0, negative: 0, neutral: 0 },
        sources: {},
        trendDirection: 'stable',
        keywords: [],
        fetchedAt: new Date().toISOString(),
      };
    }

    // Calculate sentiment for each mention
    const mentionsWithScores = validMentions.map((mention) => ({
      ...mention,
      score: mention.score ?? this.analyzeSentiment(mention.text),
    }));

    // Calculate overall score (weighted by engagement if available)
    let totalScore = 0;
    let totalWeight = 0;
    for (const mention of mentionsWithScores) {
      const weight = mention.engagement ?? 1;
      totalScore += mention.score * weight;
      totalWeight += weight;
    }
    const overallScore = totalWeight > 0 ? totalScore / totalWeight : 0;

    // Sentiment breakdown
    let positive = 0;
    let negative = 0;
    let neutral = 0;
    for (const mention of mentionsWithScores) {
      if (mention.score > 0.1) {
        positive++;
      } else if (mention.score < -0.1) {
        negative++;
      } else {
        neutral++;
      }
    }

    const total = mentionsWithScores.length;
    const sentimentBreakdown = {
      positive: total > 0 ? (positive / total) * 100 : 0,
      negative: total > 0 ? (negative / total) * 100 : 0,
      neutral: total > 0 ? (neutral / total) * 100 : 0,
    };

    // Aggregate by source
    const sources: Record<string, { count: number; avgScore: number }> = {};
    for (const mention of mentionsWithScores) {
      if (!sources[mention.source]) {
        sources[mention.source] = { count: 0, avgScore: 0 };
      }
      sources[mention.source].count++;
      sources[mention.source].avgScore += mention.score;
    }
    for (const source of Object.keys(sources)) {
      sources[source].avgScore /= sources[source].count;
    }

    // Calculate buzz score
    const buzzScore = this.calculateBuzzScore(validMentions.length, avgMentionCount);

    // Detect trend (use last 10 scores or all if less)
    const recentScores = mentionsWithScores.slice(-10).map((m) => m.score ?? 0);
    const trendDirection = this.detectTrend(recentScores);

    // Extract keywords
    const keywords = this.extractKeywords(validMentions.map((m) => m.text));

    return {
      symbol,
      overallScore,
      mentionCount: validMentions.length,
      buzzScore,
      sentimentBreakdown,
      sources,
      trendDirection,
      keywords,
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * Blend social sentiment into composite score
   */
  getCompositeScore(
    technicalScore: number,
    fundamentalScore: number,
    sentimentScore: number,
    socialScore: number | null,
  ): number {
    const weight = configManager.get<number>('socialSentiment.weight') ?? 0.1;

    // If social sentiment disabled or not available, use original formula
    if (socialScore === null) {
      return technicalScore * 0.4 + fundamentalScore * 0.3 + sentimentScore * 0.3;
    }

    // Rebalance weights to include social
    const techWeight = 0.4 * (1 - weight);
    const fundWeight = 0.3 * (1 - weight);
    const sentWeight = 0.3 * (1 - weight);

    return (
      technicalScore * techWeight +
      fundamentalScore * fundWeight +
      sentimentScore * sentWeight +
      socialScore * weight
    );
  }
}

let instance: SocialSentimentAnalyzer | null = null;

/**
 * Get singleton instance of SocialSentimentAnalyzer
 */
export function getSocialSentimentAnalyzer(): SocialSentimentAnalyzer {
  if (!instance) {
    instance = new SocialSentimentAnalyzer();
    logger.info('SocialSentimentAnalyzer initialized');
  }
  return instance;
}
