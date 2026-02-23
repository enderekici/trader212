//! FOMC meeting date calendar and proximity detection.
//!
//! Used during simulation to detect when the market is near an FOMC decision day.

/// FOMC meeting dates 2024-2028 (last day of each 2-day meeting, YYYYMMDD as u32)
const FOMC_DATES: &[u32] = &[
    // 2024
    20240131, 20240320, 20240501, 20240612, 20240731, 20240918, 20241107, 20241218,
    // 2025
    20250129, 20250319, 20250507, 20250618, 20250730, 20250917, 20251105, 20251217,
    // 2026
    20260128, 20260318, 20260429, 20260617, 20260729, 20260916, 20261104, 20261216,
    // 2027
    20270127, 20270317, 20270428, 20270616, 20270728, 20270922, 20271103, 20271215,
    // 2028
    20280202, 20280322, 20280503, 20280614, 20280726, 20280920, 20281101, 20281213,
];

pub struct FomcProximity {
    #[allow(dead_code)]
    pub days_to_next: i32,
    pub is_pre_fomc: bool,
    pub is_fomc_day: bool,
}

/// Parse "YYYY-MM-DD" into YYYYMMDD u32 for fast comparison.
pub fn date_str_to_u32(date: &str) -> u32 {
    // date is always "YYYY-MM-DD"
    let y: u32 = date[0..4].parse().unwrap_or(0);
    let m: u32 = date[5..7].parse().unwrap_or(0);
    let d: u32 = date[8..10].parse().unwrap_or(0);
    y * 10000 + m * 100 + d
}

/// Rough day-of-year calculation for diff (doesn't need to be exact, just close).
fn approx_days_from_u32(ymd: u32) -> i64 {
    let y = (ymd / 10000) as i64;
    let m = ((ymd / 100) % 100) as i64;
    let d = (ymd % 100) as i64;
    y * 365 + (y / 4) + m * 30 + d
}

/// Get FOMC proximity for a given date string "YYYY-MM-DD".
pub fn get_fomc_proximity(date: &str) -> FomcProximity {
    let date_val = date_str_to_u32(date);
    let date_days = approx_days_from_u32(date_val);

    let is_fomc_day = FOMC_DATES.contains(&date_val);

    // Find next FOMC date on or after this date
    let mut days_to_next = i32::MAX;
    for &fomc in FOMC_DATES {
        if fomc >= date_val {
            days_to_next = (approx_days_from_u32(fomc) - date_days) as i32;
            break;
        }
    }

    // Check if within T-1/T/T+1 of any meeting
    let mut is_pre_fomc = false;
    for &fomc in FOMC_DATES {
        let diff = (approx_days_from_u32(fomc) - date_days).abs();
        if diff <= 1 {
            is_pre_fomc = true;
            break;
        }
    }

    FomcProximity {
        days_to_next,
        is_pre_fomc,
        is_fomc_day,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fomc_day_detection() {
        let p = get_fomc_proximity("2024-01-31");
        assert!(p.is_fomc_day);
        assert!(p.is_pre_fomc);
        assert_eq!(p.days_to_next, 0);
    }

    #[test]
    fn test_pre_fomc_window() {
        let p = get_fomc_proximity("2024-01-30");
        assert!(!p.is_fomc_day);
        assert!(p.is_pre_fomc); // T-1
    }

    #[test]
    fn test_normal_day() {
        let p = get_fomc_proximity("2024-02-15");
        assert!(!p.is_fomc_day);
        assert!(!p.is_pre_fomc);
        assert!(p.days_to_next > 0);
    }

    #[test]
    fn test_date_str_to_u32() {
        assert_eq!(date_str_to_u32("2024-01-31"), 20240131);
        assert_eq!(date_str_to_u32("2028-12-13"), 20281213);
    }
}
