import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RefreshCw, Star } from "lucide-react";
import { apiPost } from "./api/backend";

export default function ReviewsAdmin({ pin }) {
  const [data, setData] = useState(null);
  const [rating, setRating] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    const sequence = ++request.current;
    let active = true;
    setBusy(true);
    setError("");
    apiPost({ action: "reviewsAdmin", pin, page, rating: rating ? Number(rating) : null })
      .then(result => {
        if (!active || sequence !== request.current) return;
        if (result.ok) setData(result);
        else { setData(null); setError(result.error || "Could not load reviews."); }
      })
      .catch(() => { if (active) { setData(null); setError("Could not load reviews. Please try again."); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [pin, page, rating, refresh]);

  const pageCount = Math.max(1, Math.ceil((data?.filteredTotal || 0) / 25));
  return <section className="reviewsAdmin" aria-busy={busy}>
    <div className="reviewToolbar">
      <label htmlFor="review-rating-filter">Rating
        <select id="review-rating-filter" value={rating} disabled={busy} onChange={event => { setRating(event.target.value); setPage(0); }}>
          <option value="">All ratings</option>
          {[5, 4, 3, 2, 1].map(star => <option key={star} value={star}>{star} {star === 1 ? "star" : "stars"}</option>)}
        </select>
      </label>
      <button className="ghostBtn" disabled={busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} />Refresh</button>
    </div>
    {error && <p className="errorText" role="alert">{error}</p>}
    {busy && <p role="status">Loading reviews...</p>}
    {data && <>
      <div className="reviewStats">
        <div><span>Average rating</span><strong><Star size={22} fill="currentColor" />{data.averageRating == null ? "No ratings yet" : `${Number(data.averageRating).toFixed(1)} / 5`}</strong></div>
        <div><span>Total reviews</span><strong>{data.totalReviews}</strong></div>
        <div className="reviewDistribution">{[5, 4, 3, 2, 1].map(star => <div key={star}><span>{star} stars</span><strong>{data.ratingCounts?.[star] || 0}</strong></div>)}</div>
      </div>
      <div className="reviewsList">
        {data.reviews.length === 0 && !busy && <div className="empty">{rating ? "No reviews with this rating." : "No reviews yet."}</div>}
        {data.reviews.map(review => <article className="staffReview" key={review.id}>
          <div className="staffReviewHeader">
            <div><h3>{review.name || "Customer"}</h3><p>{review.drink}{review.source === "clergy" ? " · Clergy" : ""}</p></div>
            <div className="staffReviewMeta">
              <div className="reviewStars reviewStarsStatic" aria-label={`${review.rating} out of 5 stars`}>
                {[1, 2, 3, 4, 5].map(star => <Star key={star} size={18} aria-hidden="true" fill={star <= review.rating ? "currentColor" : "none"} />)}
              </div>
              <time dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleString()}</time>
            </div>
          </div>
          <p className="reviewComment">{review.comment || "No comment"}</p>
        </article>)}
      </div>
      <div className="reviewPagination">
        <button className="ghostBtn" disabled={busy || page === 0} onClick={() => setPage(value => value - 1)}><ArrowLeft size={16} />Previous</button>
        <span>Page {page + 1} of {pageCount}</span>
        <button className="ghostBtn" disabled={busy || page + 1 >= pageCount} onClick={() => setPage(value => value + 1)}>Next<ArrowRight size={16} /></button>
      </div>
    </>}
  </section>;
}
