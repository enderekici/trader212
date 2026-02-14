import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocialMention } from '../../src/data/social-sentiment.js';
import { getSocialSentimentAnalyzer } from '../../src/data/social-sentiment.js';
import { configManager } from '../../src/config/manager.js';

vi.mock('../../src/config/manager.js', () => ({
	configManager: {
		get: vi.fn(),
	},
}));

vi.mock('../../src/utils/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

describe('SocialSentimentAnalyzer', () => {
	const analyzer = getSocialSentimentAnalyzer();

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(configManager.get).mockReturnValue(0.1);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('analyzeSentiment', () => {
		it('should return 0 for empty text', () => {
			expect(analyzer.analyzeSentiment('')).toBe(0);
			expect(analyzer.analyzeSentiment('   ')).toBe(0);
		});

		it('should return positive score for bullish text', () => {
			const score = analyzer.analyzeSentiment('This stock is bullish and ready to moon!');
			expect(score).toBeGreaterThan(0);
		});

		it('should return negative score for bearish text', () => {
			const score = analyzer.analyzeSentiment('Bearish outlook, expecting a crash');
			expect(score).toBeLessThan(0);
		});

		it('should return neutral score for neutral text', () => {
			const score = analyzer.analyzeSentiment('The company announced earnings today');
			expect(score).toBe(0);
		});

		it('should handle mixed sentiment', () => {
			const score = analyzer.analyzeSentiment('Strong growth but weak earnings');
			// "strong" (+0.1) and "weak" (-0.1) should roughly cancel out
			expect(Math.abs(score)).toBeLessThan(0.2);
		});

		it('should count multiple keyword occurrences', () => {
			const score1 = analyzer.analyzeSentiment('buy buy buy!');
			const score2 = analyzer.analyzeSentiment('buy');
			expect(score1).toBeGreaterThan(score2);
		});

		it('should use word boundaries for matching', () => {
			// "bull" in "bulletin" should not match "bullish"
			const score = analyzer.analyzeSentiment('company bulletin');
			expect(score).toBe(0);
		});

		it('should be case insensitive', () => {
			const score1 = analyzer.analyzeSentiment('BULLISH');
			const score2 = analyzer.analyzeSentiment('bullish');
			expect(score1).toBe(score2);
		});

		it('should clamp scores to -1 to 1 range', () => {
			const veryPositive = analyzer.analyzeSentiment('bullish buy moon breakout upgrade beat growth strong rally calls'.repeat(10));
			const veryNegative = analyzer.analyzeSentiment('bearish sell crash downgrade miss weak dump puts short fraud'.repeat(10));
			expect(veryPositive).toBe(1);
			expect(veryNegative).toBe(-1);
		});
	});

	describe('filterSpam', () => {
		it('should filter empty text', () => {
			const mentions: SocialMention[] = [
				{ source: 'reddit', text: '', timestamp: '2024-01-01T00:00:00Z' },
				{ source: 'twitter', text: '   ', timestamp: '2024-01-01T00:00:00Z' },
			];
			expect(analyzer.filterSpam(mentions)).toHaveLength(0);
		});

		it('should filter very short text', () => {
			const mentions: SocialMention[] = [
				{ source: 'reddit', text: 'abc', timestamp: '2024-01-01T00:00:00Z' },
				{ source: 'twitter', text: 'This is valid text', timestamp: '2024-01-01T00:00:00Z' },
			];
			const filtered = analyzer.filterSpam(mentions);
			expect(filtered).toHaveLength(1);
			expect(filtered[0].text).toBe('This is valid text');
		});

		it('should filter excessive caps', () => {
			const mentions: SocialMention[] = [
				{ source: 'reddit', text: 'AAAAAAAAAA BUY NOW', timestamp: '2024-01-01T00:00:00Z' },
				{ source: 'twitter', text: 'Normal text here', timestamp: '2024-01-01T00:00:00Z' },
			];
			const filtered = analyzer.filterSpam(mentions);
			expect(filtered).toHaveLength(1);
		});

		it('should filter repeated characters', () => {
			const mentions: SocialMention[] = [
				{ source: 'reddit', text: 'Wowwwww this is spam', timestamp: '2024-01-01T00:00:00Z' },
				{ source: 'twitter', text: 'Normal text', timestamp: '2024-01-01T00:00:00Z' },
			];
			const filtered = analyzer.filterSpam(mentions);
			expect(filtered).toHaveLength(1);
		});

		it('should filter excessive rocket emojis', () => {
			const mentions: SocialMention[] = [
				{ source: 'reddit', text: 'To the moon 🚀🚀🚀', timestamp: '2024-01-01T00:00:00Z' },
				{ source: 'twitter', text: 'Good analysis 🚀', timestamp: '2024-01-01T00:00:00Z' },
			];
			const filtered = analyzer.filterSpam(mentions);
			expect(filtered).toHaveLength(1);
			expect(filtered[0].text).toBe('Good analysis 🚀');
		});

		it('should filter common spam phrases', () => {
			const mentions: SocialMention[] = [
				{ source: 'reddit', text: 'BUY NOW guaranteed profits', timestamp: '2024-01-01T00:00:00Z' },
				{ source: 'twitter', text: 'Click here for free money', timestamp: '2024-01-01T00:00:00Z' },
				{ source: 'stocktwits', text: 'Legitimate analysis', timestamp: '2024-01-01T00:00:00Z' },
			];
			const filtered = analyzer.filterSpam(mentions);
			expect(filtered).toHaveLength(1);
		});

		it('should return empty array for all spam', () => {
			const mentions: SocialMention[] = [
				{ source: 'reddit', text: '', timestamp: '2024-01-01T00:00:00Z' },
				{ source: 'twitter', text: 'abc', timestamp: '2024-01-01T00:00:00Z' },
			];
			expect(analyzer.filterSpam(mentions)).toHaveLength(0);
		});
	});

	describe('calculateBuzzScore', () => {
		it('should return 0 for zero mentions', () => {
			expect(analyzer.calculateBuzzScore(0, 10)).toBe(0);
		});

		it('should return 100 for mentions when average is 0', () => {
			expect(analyzer.calculateBuzzScore(5, 0)).toBe(100);
		});

		it('should return 0 when both are 0', () => {
			expect(analyzer.calculateBuzzScore(0, 0)).toBe(0);
		});

		it('should return higher score for above-average mentions', () => {
			const score1 = analyzer.calculateBuzzScore(20, 10);
			const score2 = analyzer.calculateBuzzScore(10, 10);
			expect(score1).toBeGreaterThan(score2);
		});

		it('should clamp to 0-100 range', () => {
			const veryHigh = analyzer.calculateBuzzScore(10000, 10);
			expect(veryHigh).toBeLessThanOrEqual(100);
			expect(veryHigh).toBeGreaterThanOrEqual(0);
		});

		it('should use logarithmic scale', () => {
			// Difference between 10->20 should be larger than 100->110
			const score1 = analyzer.calculateBuzzScore(10, 10);
			const score2 = analyzer.calculateBuzzScore(20, 10);
			const score3 = analyzer.calculateBuzzScore(100, 10);
			const score4 = analyzer.calculateBuzzScore(110, 10);

			const diff1 = score2 - score1;
			const diff2 = score4 - score3;
			expect(diff1).toBeGreaterThan(diff2);
		});
	});

	describe('detectTrend', () => {
		it('should return stable for empty array', () => {
			expect(analyzer.detectTrend([])).toBe('stable');
		});

		it('should return stable for single score', () => {
			expect(analyzer.detectTrend([0.5])).toBe('stable');
		});

		it('should detect rising trend', () => {
			expect(analyzer.detectTrend([0.1, 0.2, 0.3, 0.4, 0.5])).toBe('rising');
		});

		it('should detect falling trend', () => {
			expect(analyzer.detectTrend([0.5, 0.4, 0.3, 0.2, 0.1])).toBe('falling');
		});

		it('should return stable for flat scores', () => {
			expect(analyzer.detectTrend([0.5, 0.5, 0.5, 0.5])).toBe('stable');
		});

		it('should return stable for minor fluctuations', () => {
			expect(analyzer.detectTrend([0.5, 0.51, 0.49, 0.5, 0.52])).toBe('stable');
		});

		it('should handle negative scores', () => {
			expect(analyzer.detectTrend([-0.5, -0.3, -0.1, 0.1, 0.3])).toBe('rising');
		});
	});

	describe('extractKeywords', () => {
		it('should return empty array for empty texts', () => {
			expect(analyzer.extractKeywords([])).toEqual([]);
		});

		it('should extract finance-related keywords', () => {
			const texts = [
				'The earnings report shows strong revenue growth',
				'Analysts raised price target after earnings beat',
			];
			const keywords = analyzer.extractKeywords(texts);
			expect(keywords).toContain('earnings');
			expect(keywords).toContain('revenue');
		});

		it('should count keyword frequency', () => {
			const texts = [
				'earnings earnings earnings',
				'revenue',
			];
			const keywords = analyzer.extractKeywords(texts);
			expect(keywords[0]).toBe('earnings'); // Most frequent
		});

		it('should return top 10 keywords only', () => {
			const texts = [
				'earnings revenue profit ipo merger acquisition dividend guidance analyst rating target price stock market sector industry',
			];
			const keywords = analyzer.extractKeywords(texts);
			expect(keywords.length).toBeLessThanOrEqual(10);
		});

		it('should be case insensitive', () => {
			const texts = ['EARNINGS earnings Earnings'];
			const keywords = analyzer.extractKeywords(texts);
			expect(keywords).toContain('earnings');
		});

		it('should use word boundaries', () => {
			const texts = ['stockmarket']; // "stock" and "market" should not match
			const keywords = analyzer.extractKeywords(texts);
			expect(keywords).toEqual([]);
		});
	});

	describe('analyzeSymbol', () => {
		it('should return default result for empty mentions', () => {
			const result = analyzer.analyzeSymbol('AAPL', []);
			expect(result.symbol).toBe('AAPL');
			expect(result.overallScore).toBe(0);
			expect(result.mentionCount).toBe(0);
			expect(result.buzzScore).toBe(0);
			expect(result.trendDirection).toBe('stable');
		});

		it('should filter spam mentions', () => {
			const mentions: SocialMention[] = [
				{ source: 'reddit', text: '', timestamp: '2024-01-01T00:00:00Z' },
				{ source: 'twitter', text: 'Valid bullish sentiment', timestamp: '2024-01-01T00:00:00Z' },
			];
			const result = analyzer.analyzeSymbol('AAPL', mentions);
			expect(result.mentionCount).toBe(1);
		});

		it('should calculate overall score from mentions', () => {
			const mentions: SocialMention[] = [
				{ source: 'reddit', text: 'Very bullish on this stock', timestamp: '2024-01-01T00:00:00Z' },
				{ source: 'twitter', text: 'Strong buy signal', timestamp: '2024-01-01T00:00:00Z' },
			];
			const result = analyzer.analyzeSymbol('AAPL', mentions);
			expect(result.overallScore).toBeGreaterThan(0);
		});

		it('should use provided scores when available', () => {
			const mentions: SocialMention[] = [
				{ source: 'reddit', text: 'Some text', timestamp: '2024-01-01T00:00:00Z', score: 0.8 },
				{ source: 'twitter', text: 'Other text', timestamp: '2024-01-01T00:00:00Z', score: 0.6 },
			];
			const result = analyzer.analyzeSymbol('AAPL', mentions);
			expect(result.overallScore).toBeCloseTo(0.7, 1);
		});

		it('should weight by engagement', () => {
			const mentions: SocialMention[] = [
				{ source: 'reddit', text: 'bullish', timestamp: '2024-01-01T00:00:00Z', score: 0.8, engagement: 100 },
				{ source: 'twitter', text: 'bearish', timestamp: '2024-01-01T00:00:00Z', score: -0.8, engagement: 10 },
			];
			const result = analyzer.analyzeSymbol('AAPL', mentions);
			// Should be weighted toward the high-engagement positive mention
			expect(result.overallScore).toBeGreaterThan(0);
		});

		it('should calculate sentiment breakdown percentages', () => {
			const mentions: SocialMention[] = [
				{ source: 'reddit', text: 'bullish', timestamp: '2024-01-01T00:00:00Z', score: 0.5 },
				{ source: 'twitter', text: 'bearish', timestamp: '2024-01-01T00:00:00Z', score: -0.5 },
				{ source: 'stocktwits', text: 'neutral text', timestamp: '2024-01-01T00:00:00Z', score: 0 },
			];
			const result = analyzer.analyzeSymbol('AAPL', mentions);
			expect(result.sentimentBreakdown.positive).toBeCloseTo(33.33, 1);
			expect(result.sentimentBreakdown.negative).toBeCloseTo(33.33, 1);
			expect(result.sentimentBreakdown.neutral).toBeCloseTo(33.33, 1);
		});

		it('should aggregate by source', () => {
			const mentions: SocialMention[] = [
				{ source: 'reddit', text: 'bullish', timestamp: '2024-01-01T00:00:00Z' },
				{ source: 'reddit', text: 'very bullish', timestamp: '2024-01-01T00:00:00Z' },
				{ source: 'twitter', text: 'bearish', timestamp: '2024-01-01T00:00:00Z' },
			];
			const result = analyzer.analyzeSymbol('AAPL', mentions);
			expect(result.sources.reddit.count).toBe(2);
			expect(result.sources.twitter.count).toBe(1);
			expect(result.sources.reddit.avgScore).toBeGreaterThan(0);
			expect(result.sources.twitter.avgScore).toBeLessThan(0);
		});

		it('should calculate buzz score', () => {
			const mentions: SocialMention[] = [
				{ source: 'reddit', text: 'mention 1', timestamp: '2024-01-01T00:00:00Z' },
				{ source: 'twitter', text: 'mention 2', timestamp: '2024-01-01T00:00:00Z' },
			];
			const result = analyzer.analyzeSymbol('AAPL', mentions, 1);
			expect(result.buzzScore).toBeGreaterThan(0);
		});

		it('should detect trend direction', () => {
			const mentions: SocialMention[] = [];
			// Create a clear rising trend from -0.5 to 0.4
			for (let i = 0; i < 10; i++) {
				mentions.push({
					source: 'reddit',
					text: 'valid text here',
					timestamp: new Date(Date.now() + i * 1000).toISOString(), // Different timestamps
					score: -0.5 + (i * 0.1),
				});
			}
			const result = analyzer.analyzeSymbol('AAPL', mentions);
			// The slope should be 0.1 which is > 0.05 threshold
			expect(result.trendDirection).toBe('rising');
		});

		it('should extract keywords', () => {
			const mentions: SocialMention[] = [
				{ source: 'reddit', text: 'Strong earnings beat expectations', timestamp: '2024-01-01T00:00:00Z' },
				{ source: 'twitter', text: 'Revenue growth is impressive', timestamp: '2024-01-01T00:00:00Z' },
			];
			const result = analyzer.analyzeSymbol('AAPL', mentions);
			expect(result.keywords.length).toBeGreaterThan(0);
		});

		it('should set fetchedAt timestamp', () => {
			const mentions: SocialMention[] = [
				{ source: 'reddit', text: 'Some text', timestamp: '2024-01-01T00:00:00Z' },
			];
			const result = analyzer.analyzeSymbol('AAPL', mentions);
			expect(result.fetchedAt).toBeDefined();
			expect(new Date(result.fetchedAt).getTime()).toBeGreaterThan(0);
		});

		it('should handle single mention', () => {
			const mentions: SocialMention[] = [
				{ source: 'reddit', text: 'bullish', timestamp: '2024-01-01T00:00:00Z' },
			];
			const result = analyzer.analyzeSymbol('AAPL', mentions);
			expect(result.mentionCount).toBe(1);
			expect(result.overallScore).toBeGreaterThan(0);
		});

		it('should handle all spam mentions', () => {
			const mentions: SocialMention[] = [
				{ source: 'reddit', text: '', timestamp: '2024-01-01T00:00:00Z' },
				{ source: 'twitter', text: 'abc', timestamp: '2024-01-01T00:00:00Z' },
			];
			const result = analyzer.analyzeSymbol('AAPL', mentions);
			expect(result.mentionCount).toBe(0);
			expect(result.overallScore).toBe(0);
		});
	});

	describe('getCompositeScore', () => {
		it('should use original formula when social score is null', () => {
			const score = analyzer.getCompositeScore(0.8, 0.6, 0.4, null);
			const expected = 0.8 * 0.4 + 0.6 * 0.3 + 0.4 * 0.3;
			expect(score).toBeCloseTo(expected, 5);
		});

		it('should blend social score when available', () => {
			vi.mocked(configManager.get).mockReturnValue(0.1);
			const score = analyzer.getCompositeScore(0.8, 0.6, 0.4, 0.5);
			// With 10% social weight, other weights are reduced proportionally
			const techWeight = 0.4 * 0.9;
			const fundWeight = 0.3 * 0.9;
			const sentWeight = 0.3 * 0.9;
			const socialWeight = 0.1;
			const expected =
				0.8 * techWeight +
				0.6 * fundWeight +
				0.4 * sentWeight +
				0.5 * socialWeight;
			expect(score).toBeCloseTo(expected, 5);
		});

		it('should respect configured weight', () => {
			vi.mocked(configManager.get).mockReturnValue(0.2);
			const score = analyzer.getCompositeScore(0.8, 0.6, 0.4, 0.5);
			const techWeight = 0.4 * 0.8;
			const fundWeight = 0.3 * 0.8;
			const sentWeight = 0.3 * 0.8;
			const socialWeight = 0.2;
			const expected =
				0.8 * techWeight +
				0.6 * fundWeight +
				0.4 * sentWeight +
				0.5 * socialWeight;
			expect(score).toBeCloseTo(expected, 5);
		});

		it('should handle zero social weight', () => {
			vi.mocked(configManager.get).mockReturnValue(0);
			const score = analyzer.getCompositeScore(0.8, 0.6, 0.4, 0.5);
			const expected = 0.8 * 0.4 + 0.6 * 0.3 + 0.4 * 0.3;
			expect(score).toBeCloseTo(expected, 5);
		});

		it('should handle negative social score', () => {
			vi.mocked(configManager.get).mockReturnValue(0.1);
			const score = analyzer.getCompositeScore(0.8, 0.6, 0.4, -0.5);
			expect(score).toBeLessThan(analyzer.getCompositeScore(0.8, 0.6, 0.4, 0.5));
		});
	});

	describe('getSocialSentimentAnalyzer', () => {
		it('should return singleton instance', () => {
			const instance1 = getSocialSentimentAnalyzer();
			const instance2 = getSocialSentimentAnalyzer();
			expect(instance1).toBe(instance2);
		});
	});
});
