import React, { useEffect, useRef, useState } from "react";
import { Check, Star } from "lucide-react";
import { apiPost } from "./api/backend";

export default function OrderReview({ orderId, token, status }) {
  const [eligible, setEligible] = useState(false);
  const [review, setReview] = useState(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const done = ["ready", "complete"].includes(status);

  useEffect(() => {
    let active = true;
    let loading = false;
    async function load() {
      if (loading || pending.current || !orderId || !token) return;
      loading = true;
      try {
        const data = await apiPost({ action: "orderReview", id: orderId, token });
        if (!active || pending.current) return;
        if (data.ok) {
          setEligible(data.eligible);
          setReview(current => data.review || current);
          setError("");
        } else if (done || !status) setError(data.error || "Could not load your review.");
      } catch { if (active && (done || !status)) setError("Could not load your review. Please try again later."); }
      finally { loading = false; }
    }
    load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [orderId, token, status]);

  async function submit(event) {
    event.preventDefault();
    if (pending.current) return;
    if (!rating) { setError("Please select a star rating."); return; }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await apiPost({ action: "orderReview", id: orderId, token, rating, comment });
      if (data.ok && data.review) setReview(data.review);
      else setError(data.error || "Could not send your review. Please try again.");
    } catch { setError("Connection error. Your review has not been confirmed. Please try again."); }
    finally { pending.current = false; setBusy(false); }
  }

  if (!token || (!eligible && !error && !review)) return null;
  return <section className="orderReview" aria-labelledby={`review-title-${orderId}`}>
    <h3 id={`review-title-${orderId}`}>{review ? "Thank you for your feedback" : "How was your coffee?"}</h3>
    {review ? <>
      <div className="reviewSaved" role="status"><Check size={18} />Review received</div>
      <div className="reviewStars reviewStarsStatic" aria-label={`${review.rating} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map(star => <Star key={star} size={24} aria-hidden="true" fill={star <= review.rating ? "currentColor" : "none"} />)}
      </div>
      {review.comment && <p className="reviewComment">{review.comment}</p>}
    </> : eligible && <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <legend>Your rating</legend>
        <div className="reviewStars">
          {[1, 2, 3, 4, 5].map(star => <label key={star} title={`${star} ${star === 1 ? "star" : "stars"}`}>
            <input type="radio" name={`review-rating-${orderId}`} value={star}
              aria-label={`${star} ${star === 1 ? "star" : "stars"}`} checked={rating === star}
              onChange={() => { setRating(star); setError(""); }} />
            <Star size={28} aria-hidden="true" fill={star <= rating ? "currentColor" : "none"} />
          </label>)}
        </div>
      </fieldset>
      <label className="reviewCommentLabel" htmlFor={`review-comment-${orderId}`}>Comment (optional)</label>
      <textarea id={`review-comment-${orderId}`} maxLength={1000} rows={3} value={comment}
        disabled={busy} onChange={event => setComment(event.target.value)} placeholder="Share your thoughts with the Arise team" />
      <button className="primaryBtn" disabled={busy} type="submit">{busy ? "Sending..." : "Send review"}</button>
    </form>}
    {error && <p className="errorText" role="alert">{error}</p>}
  </section>;
}
