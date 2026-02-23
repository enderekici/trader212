use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use anyhow::{Context, Result};
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub struct Candle {
    pub date: String,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

/// Load all cached symbol data from JSON files in the given directory.
///
/// Each file is expected to be named `SYMBOL.json` and contain a JSON array
/// of candle objects: `[{date, open, high, low, close, volume}, ...]`.
///
/// Returns a sorted Vec of (symbol_name, candles) where candles are sorted by date.
pub fn load_cached_symbols(cache_dir: &str) -> Result<Vec<(String, Vec<Candle>)>> {
    let dir_path = Path::new(cache_dir);
    if !dir_path.exists() {
        anyhow::bail!("Cache directory does not exist: {cache_dir}");
    }
    if !dir_path.is_dir() {
        anyhow::bail!("Cache path is not a directory: {cache_dir}");
    }

    let mut results: Vec<(String, Vec<Candle>)> = Vec::new();

    let entries = fs::read_dir(dir_path)
        .with_context(|| format!("Failed to read cache directory: {cache_dir}"))?;

    for entry in entries {
        let entry = entry.with_context(|| "Failed to read directory entry")?;
        let path = entry.path();

        // Only process .json files
        let extension = path.extension().and_then(|e| e.to_str());
        if extension != Some("json") {
            continue;
        }

        // Extract symbol name from filename (e.g., "AAPL.json" -> "AAPL")
        let symbol = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) if !s.starts_with('_') => s.to_string(),
            _ => continue,
        };

        let contents = fs::read_to_string(&path)
            .with_context(|| format!("Failed to read file: {}", path.display()))?;

        let mut candles: Vec<Candle> = serde_json::from_str(&contents)
            .with_context(|| format!("Failed to parse JSON for symbol {symbol}"))?;

        // Sort candles by date
        candles.sort_by(|a, b| a.date.cmp(&b.date));

        results.push((symbol, candles));
    }

    // Sort by symbol name
    results.sort_by(|a, b| a.0.cmp(&b.0));

    println!("Loaded {} symbols from {}", results.len(), cache_dir);

    Ok(results)
}

/// Find dates that are common to ALL symbols and within the given date range.
///
/// Uses string comparison on ISO-format dates (YYYY-MM-DD) for range filtering.
/// Returns a sorted Vec of date strings present in every symbol's data.
pub fn get_common_dates(
    data: &[(String, Vec<Candle>)],
    start_date: &str,
    end_date: &str,
) -> Vec<String> {
    if data.is_empty() {
        return Vec::new();
    }

    let mut common: Option<BTreeSet<String>> = None;

    for (_symbol, candles) in data {
        let dates: BTreeSet<String> = candles
            .iter()
            .filter(|c| c.date.as_str() >= start_date && c.date.as_str() <= end_date)
            .map(|c| c.date.clone())
            .collect();

        common = Some(match common {
            Some(existing) => existing.intersection(&dates).cloned().collect(),
            None => dates,
        });
    }

    // BTreeSet is already sorted; collect into Vec
    common.unwrap_or_default().into_iter().collect()
}
