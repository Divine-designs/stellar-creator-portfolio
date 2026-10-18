use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ReviewSubmission {
    #[serde(rename = "bountyId")]
    pub bounty_id: String,
    #[serde(rename = "creatorId")]
    pub creator_id: String,
    pub rating: u8,
    pub title: String,
    pub body: String,
    #[serde(rename = "reviewerName")]
    pub reviewer_name: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Review {
    pub id: String,
    pub bounty_id: String,
    pub creator_id: String,
    pub rating: u8,
    pub title: String,
    pub body: String,
    pub reviewer_name: String,
    pub created_at: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ReviewAggregation {
    pub total_reviews: u32,
    pub average_rating: f64,
    pub rating_distribution: [u32; 5], // 1-star, 2-star, 3-star, 4-star, 5-star counts
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CreatorReputationPayload {
    pub creator_id: String,
    pub aggregation: ReviewAggregation,
    pub recent_reviews: Vec<Review>,
}

/// Filters applied to a creator's review query. `None` means "no constraint".
#[derive(Clone, Debug, Default)]
pub struct ReviewFilters {
    pub min_rating: Option<u8>,
    pub max_rating: Option<u8>,
    /// Inclusive lower bound on `created_at` (ISO-8601 string).
    pub since: Option<String>,
    /// Inclusive upper bound on `created_at` (ISO-8601 string).
    pub until: Option<String>,
}

/// Pagination window for a review query.
#[derive(Clone, Debug)]
pub struct ReviewPagination {
    pub limit: i64,
    pub offset: i64,
}

impl Default for ReviewPagination {
    fn default() -> Self {
        Self {
            limit: 20,
            offset: 0,
        }
    }
}

/// In-memory seed reviews. Only compiled for tests so non-test builds never
/// serve fake reputation data.
#[cfg(test)]
pub fn get_mock_reviews() -> Vec<Review> {
    vec![
        Review {
            id: "rev-alex-studio-b-1".to_string(),
            bounty_id: "b-1".to_string(),
            creator_id: "alex-studio".to_string(),
            rating: 5,
            title: "Excellent design work".to_string(),
            body: "Alex delivered outstanding designs that exceeded our expectations. Very professional and responsive.".to_string(),
            reviewer_name: "John D.".to_string(),
            created_at: "2026-01-15T10:30:00Z".to_string(),
        },
        Review {
            id: "rev-alex-studio-b-2".to_string(),
            bounty_id: "b-2".to_string(),
            creator_id: "alex-studio".to_string(),
            rating: 4,
            title: "Great collaboration".to_string(),
            body: "Good communication and solid design work. Would work with again.".to_string(),
            reviewer_name: "Sarah M.".to_string(),
            created_at: "2026-01-10T14:20:00Z".to_string(),
        },
        Review {
            id: "rev-jordan-dev-b-1".to_string(),
            bounty_id: "b-3".to_string(),
            creator_id: "jordan-dev".to_string(),
            rating: 5,
            title: "Flawless implementation".to_string(),
            body: "Jordan implemented the API integration perfectly. Clean code and great documentation.".to_string(),
            reviewer_name: "Mike R.".to_string(),
            created_at: "2026-01-12T09:15:00Z".to_string(),
        },
    ]
}

/// Pure in-memory filter used by tests and as the reference implementation
/// for the SQL WHERE clause built in `get_filtered_creator_reviews_from_db`.
pub fn filter_reviews(reviews: Vec<Review>, filters: &ReviewFilters) -> Vec<Review> {
    reviews
        .into_iter()
        .filter(|review| {
            if let Some(min) = filters.min_rating {
                if review.rating < min {
                    return false;
                }
            }
            if let Some(max) = filters.max_rating {
                if review.rating > max {
                    return false;
                }
            }
            if let Some(ref since) = filters.since {
                if review.created_at.as_str() < since.as_str() {
                    return false;
                }
            }
            if let Some(ref until) = filters.until {
                if review.created_at.as_str() > until.as_str() {
                    return false;
                }
            }
            true
        })
        .collect()
}

/// Apply pagination to an already-sorted slice of reviews.
pub fn paginate_reviews(reviews: Vec<Review>, pagination: &ReviewPagination) -> Vec<Review> {
    let offset = pagination.offset.max(0) as usize;
    let limit = pagination.limit.max(0) as usize;
    reviews.into_iter().skip(offset).take(limit).collect()
}

/// Fetch every review from Postgres, newest first.
pub async fn fetch_all_reviews_from_db(
    pool: &sqlx::PgPool,
) -> Result<Vec<Review>, sqlx::Error> {
    sqlx::query_as::<_, ReviewRow>(
        "SELECT id::text, bounty_id, creator_id, rating, title, body, reviewer_name, \
         to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at \
         FROM reviews ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await
    .map(|rows| rows.into_iter().map(Review::from).collect())
}

/// Fetch a creator's reviews from Postgres with rating/date filters and
/// pagination applied in the database, newest first.
pub async fn get_filtered_creator_reviews_from_db(
    pool: &sqlx::PgPool,
    creator_id: &str,
    filters: &ReviewFilters,
    pagination: &ReviewPagination,
) -> Result<Vec<Review>, sqlx::Error> {
    sqlx::query_as::<_, ReviewRow>(
        "SELECT id::text, bounty_id, creator_id, rating, title, body, reviewer_name, \
         to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at \
         FROM reviews \
         WHERE creator_id = $1 \
           AND ($2::int IS NULL OR rating >= $2) \
           AND ($3::int IS NULL OR rating <= $3) \
           AND ($4::timestamptz IS NULL OR created_at >= $4) \
           AND ($5::timestamptz IS NULL OR created_at <= $5) \
         ORDER BY created_at DESC \
         LIMIT $6 OFFSET $7",
    )
    .bind(creator_id)
    .bind(filters.min_rating.map(|r| r as i32))
    .bind(filters.max_rating.map(|r| r as i32))
    .bind(filters.since.as_deref())
    .bind(filters.until.as_deref())
    .bind(pagination.limit.max(0))
    .bind(pagination.offset.max(0))
    .fetch_all(pool)
    .await
    .map(|rows| rows.into_iter().map(Review::from).collect())
}

/// Row shape returned by the sqlx queries above.
#[derive(sqlx::FromRow)]
struct ReviewRow {
    id: String,
    bounty_id: String,
    creator_id: String,
    rating: i32,
    title: String,
    body: String,
    reviewer_name: String,
    created_at: String,
}

impl From<ReviewRow> for Review {
    fn from(row: ReviewRow) -> Self {
        Review {
            id: row.id,
            bounty_id: row.bounty_id,
            creator_id: row.creator_id,
            rating: row.rating.clamp(0, 255) as u8,
            title: row.title,
            body: row.body,
            reviewer_name: row.reviewer_name,
            created_at: row.created_at,
        }
    }
}

pub fn aggregate_reviews(reviews: &[Review]) -> ReviewAggregation {
    let total_reviews = reviews.len() as u32;
    
    if total_reviews == 0 {
        return ReviewAggregation {
            total_reviews: 0,
            average_rating: 0.0,
            rating_distribution: [0, 0, 0, 0, 0],
        };
    }
    
    let sum_rating: f64 = reviews.iter().map(|r| r.rating as f64).sum();
    let average_rating = sum_rating / total_reviews as f64;
    
    let mut rating_distribution = [0u32; 5];
    for review in reviews {
        if review.rating >= 1 && review.rating <= 5 {
            rating_distribution[(review.rating - 1) as usize] += 1;
        }
    }
    
    ReviewAggregation {
        total_reviews,
        average_rating,
        rating_distribution,
    }
}

pub fn recent_reviews(reviews: &[Review], limit: usize) -> Vec<Review> {
    let mut sorted_reviews = reviews.to_vec();
    sorted_reviews.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    sorted_reviews.into_iter().take(limit).collect()
}

pub fn submit_review(submission: ReviewSubmission) -> Result<Review, String> {
    // Validate the submission
    if submission.bounty_id.trim().is_empty() {
        return Err("Bounty ID is required".to_string());
    }
    if submission.creator_id.trim().is_empty() {
        return Err("Creator ID is required".to_string());
    }
    if !(1..=5).contains(&submission.rating) {
        return Err("Rating must be between 1 and 5".to_string());
    }
    if submission.title.trim().is_empty() {
        return Err("Title is required".to_string());
    }
    if submission.body.trim().is_empty() {
        return Err("Feedback is required".to_string());
    }
    if submission.reviewer_name.trim().is_empty() {
        return Err("Your name is required".to_string());
    }
    
    // Create the review
    let review_id = format!("rev-{}-{}", submission.creator_id, submission.bounty_id);
    Ok(Review {
        id: review_id,
        bounty_id: submission.bounty_id,
        creator_id: submission.creator_id,
        rating: submission.rating,
        title: submission.title,
        body: submission.body,
        reviewer_name: submission.reviewer_name,
        created_at: chrono_now(),
    })
}

fn chrono_now() -> String {
    // Stable timestamp placeholder — real impl would use chrono or time crate
    "2026-01-01T00:00:00Z".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_submission() -> ReviewSubmission {
        ReviewSubmission {
            bounty_id: "b-9".to_string(),
            creator_id: "alex-studio".to_string(),
            rating: 5,
            title: "Great work".to_string(),
            body: "Excellent job!".to_string(),
            reviewer_name: "Test Reviewer".to_string(),
        }
    }

    #[test]
    fn reviews_for_creator_returns_empty_for_unknown_creator() {
        let reviews = get_mock_reviews();
        let filtered: Vec<_> = reviews
            .into_iter()
            .filter(|r| r.creator_id == "unknown-creator")
            .collect();
        assert!(filtered.is_empty());
    }

    #[test]
    fn aggregate_reviews_of_empty_slice_is_zeroed() {
        let aggregation = aggregate_reviews(&[]);
        assert_eq!(aggregation.total_reviews, 0);
        assert_eq!(aggregation.average_rating, 0.0);
        assert_eq!(aggregation.rating_distribution, [0, 0, 0, 0, 0]);
    }

    #[test]
    fn aggregate_reviews_computes_distribution_and_average() {
        let reviews: Vec<_> = get_mock_reviews()
            .into_iter()
            .filter(|r| r.creator_id == "alex-studio")
            .collect();
        let aggregation = aggregate_reviews(&reviews);
        assert_eq!(aggregation.total_reviews, 2);
        assert_eq!(aggregation.average_rating, 4.5);
        assert_eq!(aggregation.rating_distribution, [0, 0, 0, 1, 1]);
    }

    #[test]
    fn recent_reviews_respects_limit_and_sorts_newest_first() {
        let reviews = get_mock_reviews();
        let recent = recent_reviews(&reviews, 2);
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].id, "rev-alex-studio-b-1");
        assert_eq!(recent[1].id, "rev-jordan-dev-b-1");
    }

    #[test]
    fn filter_reviews_applies_rating_bounds() {
        let reviews = get_mock_reviews();
        let filters = ReviewFilters {
            min_rating: Some(5),
            ..Default::default()
        };
        let filtered = filter_reviews(reviews, &filters);
        assert_eq!(filtered.len(), 2);
        assert!(filtered.iter().all(|r| r.rating == 5));
    }

    #[test]
    fn filter_reviews_applies_date_bounds() {
        let reviews = get_mock_reviews();
        let filters = ReviewFilters {
            since: Some("2026-01-12T00:00:00Z".to_string()),
            until: Some("2026-01-15T23:59:59Z".to_string()),
            ..Default::default()
        };
        let filtered = filter_reviews(reviews, &filters);
        assert_eq!(filtered.len(), 2);
        assert!(filtered.iter().all(|r| r.created_at >= "2026-01-12T00:00:00Z".to_string()));
    }

    #[test]
    fn paginate_reviews_respects_limit_and_offset() {
        let reviews = get_mock_reviews();
        let pagination = ReviewPagination {
            limit: 1,
            offset: 1,
        };
        let page = paginate_reviews(reviews, &pagination);
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].id, "rev-alex-studio-b-2");
    }

    #[test]
    fn submit_review_rejects_empty_bounty_id() {
        let mut submission = valid_submission();
        submission.bounty_id = "  ".to_string();
        assert_eq!(submit_review(submission).unwrap_err(), "Bounty ID is required");
    }

    #[test]
    fn submit_review_rejects_empty_creator_id() {
        let mut submission = valid_submission();
        submission.creator_id = "".to_string();
        assert_eq!(submit_review(submission).unwrap_err(), "Creator ID is required");
    }

    #[test]
    fn submit_review_rejects_out_of_range_rating() {
        let mut too_low = valid_submission();
        too_low.rating = 0;
        assert_eq!(submit_review(too_low).unwrap_err(), "Rating must be between 1 and 5");

        let mut too_high = valid_submission();
        too_high.rating = 6;
        assert_eq!(submit_review(too_high).unwrap_err(), "Rating must be between 1 and 5");
    }

    #[test]
    fn submit_review_rejects_empty_title_body_or_reviewer_name() {
        let mut no_title = valid_submission();
        no_title.title = " ".to_string();
        assert_eq!(submit_review(no_title).unwrap_err(), "Title is required");

        let mut no_body = valid_submission();
        no_body.body = "".to_string();
        assert_eq!(submit_review(no_body).unwrap_err(), "Feedback is required");

        let mut no_reviewer = valid_submission();
        no_reviewer.reviewer_name = "".to_string();
        assert_eq!(submit_review(no_reviewer).unwrap_err(), "Your name is required");
    }
}
